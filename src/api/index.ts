import fs from "node:fs";
import path from "node:path";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import {
  MARKDOWN_EXPORT_TYPE,
  PDF_EXPORT_TYPE,
  createTagInputSchema,
  inboxAddInputSchema,
  inboxTakeInputSchema,
  noteListQuerySchema,
  pathInputSchema,
  pdfExportFileName,
  renameInputSchema,
  reorderPinsInputSchema,
  searchQuerySchema,
  setPinInputSchema,
  writeNoteInputSchema,
} from "../core/contract/index.ts";
import {
  BrainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  sortSummaries,
  type Brain,
  type NotePage,
  type NoteSummary,
  type SearchPage,
  type Tag,
  type TagWithCount,
  type WriteMeta,
} from "../core/types.ts";
import { config } from "../config.ts";
import { contentDisposition, fileResponse } from "./file-response.ts";
import { createLauncher, type Launcher } from "./launcher.ts";
import { isOpenable, resolveAllowedPath } from "./local-paths.ts";
import { createEdgeBrowser, createPdfExporter, type PrintBrowser } from "./pdf-export.ts";

export interface ApiOptions {
  /** Folder holding conventions.md, file.md, and garden.md. */
  conventionsDir: string;
  /** Starts programs for /api/open and /api/reveal. Defaults to the real one for this platform. */
  launcher?: Launcher;
  /** Starts the browser that prints notes for /api/notes/:slug/export.pdf. Defaults to installed Microsoft Edge. */
  printBrowser?: PrintBrowser;
  /**
   * The port this server listens on, read when a PDF export starts, so Edge opens this server's own print page.
   * Defaults to config.port.
   */
  listenPort?: () => number;
}

const CONVENTION_NAMES = new Set(["conventions", "file", "garden"]);

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Hostname of a Host header (`name[:port]` or `[v6][:port]`), lower-cased, or null when it is not that shape. */
function hostHeaderName(value: string): string | null {
  const m = /^(\[[0-9a-f:.]+\]|[^\s:[\]/@]+)(?::\d*)?$/i.exec(value.trim());
  return m ? m[1]!.toLowerCase() : null;
}

function originHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null; // includes the literal "null" origin
  }
}

/**
 * Any web page can make the browser send requests to localhost, and DNS rebinding can point another
 * hostname at 127.0.0.1. Only accept requests addressed to a loopback name and not sent from another site.
 * Hono's app.request sends no Host header, so tests fall back to the URL's hostname.
 */
const requestGuard: MiddlewareHandler = async (c, next) => {
  const host = c.req.header("host");
  const hostname = host === undefined ? new URL(c.req.url).hostname : hostHeaderName(host);
  if (hostname === null || !LOCAL_HOSTNAMES.has(hostname)) {
    throw new ForbiddenError("requests must be addressed to localhost");
  }
  if (c.req.header("sec-fetch-site")?.trim().toLowerCase() === "cross-site") {
    throw new ForbiddenError("cross-site requests are not allowed");
  }
  const origin = c.req.header("origin");
  if (origin !== undefined && !LOCAL_HOSTNAMES.has(originHostname(origin) ?? "")) {
    throw new ForbiddenError(`origin ${origin} is not allowed`);
  }
  // A JSON content type forces a CORS preflight, which a plain form post from another page cannot pass.
  if (needsJsonBody(c.req.method, c.req.path)) {
    const mediaType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (mediaType !== "application/json") {
      throw new BrainError("Content-Type must be application/json", 415, "unsupported_media_type");
    }
  }
  await next();
};

/** Requests that launch programs or that the web UI sends to write the brain: POST open and reveal, PUT pins. */
function needsJsonBody(method: string, path: string): boolean {
  if (method === "POST") return path === "/api/open" || path === "/api/reveal";
  return method === "PUT" && path.startsWith("/api/pins/");
}

/**
 * One message for every problem, each once. A contract rule's message names its field ("limit must be ...") and is
 * used as it is; any other message gets the field's path in front ("frontmatter.type: Invalid option ...").
 */
function issuesToMessage(err: z.ZodError): string {
  const messages = err.issues.map((i) => {
    const field = i.path.at(-1);
    if (i.path.length === 0 || (typeof field === "string" && i.message.startsWith(`${field} `))) return i.message;
    return `${i.path.map(String).join(".")}: ${i.message}`;
  });
  return [...new Set(messages)].join("; ");
}

/** A request value read with a contract schema. 400 validation, naming every problem, when it does not fit. */
function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(issuesToMessage(result.error));
  return result.data;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError("invalid JSON body");
  }
}

async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  return parseWith(schema, await readJson(c));
}

/**
 * The JSON body with the path parameters laid over it, read with one contract schema, so every problem with either
 * comes back in one message. A field the path sets is taken from the path, never the body.
 */
async function parseBodyAndPath<S extends z.ZodType>(c: Context, schema: S, fromPath: Record<string, string>): Promise<z.output<S>> {
  const body = await readJson(c);
  const isObject = typeof body === "object" && body !== null && !Array.isArray(body);
  return parseWith(schema, isObject ? { ...body, ...fromPath } : body);
}

/** The query string read with a contract schema, which also turns numbers and flags into values and fills defaults. */
function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  return parseWith(schema, c.req.query());
}

function metaFrom(c: Context): WriteMeta {
  const header = (c.req.header("x-brain-tool") ?? "").trim().slice(0, 64);
  return { tool: header === "" ? "api" : header };
}

/** Each tag with the number of notes carrying it, counted in one pass over the list. */
function withCounts(tags: Tag[], notes: NoteSummary[]): TagWithCount[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const name of new Set(note.tags)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return tags.map((t) => ({ ...t, count: counts.get(t.name) ?? 0 }));
}

export function createApi(brain: Brain, opts: ApiOptions): Hono {
  const app = new Hono();
  const launcher = opts.launcher ?? createLauncher();
  const pdfExporter = createPdfExporter({
    browser: opts.printBrowser ?? createEdgeBrowser(),
    listenPort: opts.listenPort ?? (() => config.port),
  });

  app.onError((err, c) => {
    if (err instanceof BrainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
    }
    return c.json({ error: { code: "internal", message: err.message } }, 500);
  });

  app.use("/api/*", requestGuard);

  // ---- notes ----

  app.get("/api/notes", async (c) => {
    const { tag, type, sort, limit, offset } = parseQuery(c, noteListQuerySchema);
    // The store still reads every note; sorting and paging trim the response, not the scan.
    const notes = sortSummaries(await brain.list({ tag, type }), sort);
    const page: NotePage = { items: notes.slice(offset, offset + limit), total: notes.length, limit, offset };
    return c.json(page);
  });

  app.post("/api/notes", async (c) => {
    const input = await parseBody(c, writeNoteInputSchema);
    return c.json(await brain.write(input, metaFrom(c)), 201);
  });

  app.get("/api/notes/:slug", async (c) => {
    const slug = c.req.param("slug");
    const note = await brain.get(slug);
    if (!note) throw new NotFoundError(`note ${slug}`);
    return c.json(note);
  });

  app.put("/api/notes/:slug", async (c) => {
    // The slug comes from the path, never the body, and follows the same rule as a slug in the body of POST.
    const input = await parseBodyAndPath(c, writeNoteInputSchema, { slug: c.req.param("slug") });
    return c.json(await brain.write(input, metaFrom(c)));
  });

  app.delete("/api/notes/:slug", async (c) => {
    await brain.delete(c.req.param("slug"), metaFrom(c));
    return c.body(null, 204);
  });

  app.post("/api/notes/:slug/rename", async (c) => {
    const { newSlug } = await parseBody(c, renameInputSchema);
    return c.json(await brain.rename(c.req.param("slug"), newSlug, metaFrom(c)));
  });

  app.get("/api/notes/:slug/backlinks", async (c) => {
    return c.json(await brain.backlinks(c.req.param("slug")));
  });

  // `:slug` matches one path segment, so /api/notes/:slug above never captures this route.
  app.get("/api/notes/:slug/trail", async (c) => {
    const slug = c.req.param("slug");
    const trail = await brain.trail(slug);
    if (!trail) throw new NotFoundError(`note ${slug}`);
    return c.json(trail);
  });

  app.get("/api/notes/:slug/export.md", async (c) => {
    const slug = c.req.param("slug");
    const note = await brain.get(slug);
    if (!note) throw new NotFoundError(`note ${slug}`);
    // The bytes on disk, not note.raw, so the export is the file exactly as stored.
    const bytes = await fs.promises.readFile(brain.resolve(note.path));
    return c.body(bytes, 200, { "Content-Type": MARKDOWN_EXPORT_TYPE, "Content-Disposition": `attachment; filename="${note.slug}.md"` });
  });

  app.get("/api/notes/:slug/export.pdf", async (c) => {
    const slug = c.req.param("slug");
    const note = await brain.get(slug);
    if (!note) throw new NotFoundError(`note ${slug}`);
    const pdf = await pdfExporter.print({ slug: note.slug, title: note.title });
    return c.body(pdf, 200, {
      "Content-Type": PDF_EXPORT_TYPE,
      "Content-Disposition": contentDisposition(pdfExportFileName(note.title, note.slug), "attachment"),
    });
  });

  // ---- search ----

  app.get("/api/search", async (c) => {
    const { q, limit, options } = parseQuery(c, searchQuerySchema);
    // One extra result answers whether more exist without a second query.
    const hits = await brain.search(q, { ...options, limit: limit + 1 });
    const page: SearchPage = { results: hits.slice(0, limit), hasMore: hits.length > limit };
    return c.json(page);
  });

  // ---- tags ----

  app.get("/api/tags", async (c) => {
    const [tags, notes] = await Promise.all([brain.tags(), brain.list()]);
    return c.json(withCounts(tags, notes));
  });

  app.post("/api/tags", async (c) => {
    const tag = await parseBody(c, createTagInputSchema);
    return c.json(await brain.createTag(tag, metaFrom(c)), 201);
  });

  // ---- pins ----

  app.get("/api/pins", async (c) => c.json(await brain.pins()));

  app.put("/api/pins/:target", async (c) => {
    const { target, slug, pinned } = await parseBodyAndPath(c, setPinInputSchema, { target: c.req.param("target") });
    return c.json(await brain.setPin(slug, target, pinned, metaFrom(c)));
  });

  app.put("/api/pins/:target/order", async (c) => {
    const { target, slugs } = await parseBodyAndPath(c, reorderPinsInputSchema, { target: c.req.param("target") });
    return c.json(await brain.reorderPins(target, slugs, metaFrom(c)));
  });

  // ---- inbox ----

  app.get("/api/inbox", async (c) => c.json(await brain.inboxList()));

  app.post("/api/inbox", async (c) => {
    const { name, content } = await parseBody(c, inboxAddInputSchema);
    return c.json(await brain.inboxAdd(name, content), 201);
  });

  app.post("/api/inbox/take", async (c) => {
    const { name, ...takeOpts } = await parseBody(c, inboxTakeInputSchema);
    return c.json(await brain.inboxTake(name, takeOpts, metaFrom(c)));
  });

  // ---- files ----

  app.get("/api/files", async (c) => c.json(await brain.files()));

  app.get("/api/files/*", async (c) => {
    // c.req.path is already URI-decoded by Hono (reserved characters such as %2F stay encoded).
    const rel = c.req.path.replace(/^\/api\//, "");
    if (rel.split(/[\\/]/).some((seg) => seg === "..")) throw new ValidationError("path traversal rejected");
    const abs = brain.resolve(rel);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(abs);
    } catch {
      throw new NotFoundError(`file ${rel}`);
    }
    if (!stat.isFile()) throw new NotFoundError(`file ${rel}`);
    return fileResponse(c, abs, stat.size);
  });

  // Files outside the brain are allowed when a note mentions them (Brain.isMentioned). See local-paths.ts.
  app.post("/api/open", async (c) => {
    const { path: requested } = await parseBody(c, pathInputSchema);
    const { abs, stat } = await resolveAllowedPath(brain, requested);
    if (stat.isFile() && !isOpenable(abs)) {
      throw new ForbiddenError(`${path.win32.basename(abs)} is not a type that can be opened; reveal it instead`);
    }
    await launcher.open(abs);
    return c.json({ opened: abs });
  });

  app.post("/api/reveal", async (c) => {
    const { path: requested } = await parseBody(c, pathInputSchema);
    const { abs, stat } = await resolveAllowedPath(brain, requested);
    await launcher.reveal(abs, stat.isDirectory());
    return c.json({ revealed: abs });
  });

  // ---- maintenance ----

  app.get("/api/check-links", async (c) => c.json(await brain.checkLinks()));
  app.get("/api/stats", async (c) => c.json(await brain.stats()));
  app.post("/api/reindex", async (c) => c.json(await brain.reindex()));

  // ---- conventions ----

  const serveConvention = async (c: Context, name: string) => {
    if (!CONVENTION_NAMES.has(name)) throw new NotFoundError(`convention ${name}`);
    const file = path.join(opts.conventionsDir, `${name}.md`);
    let text: string;
    try {
      text = await fs.promises.readFile(file, "utf8");
    } catch {
      throw new NotFoundError(`convention ${name}`);
    }
    return c.text(text, 200, { "Content-Type": "text/markdown; charset=utf-8" });
  };

  app.get("/api/conventions", (c) => serveConvention(c, "conventions"));
  app.get("/api/conventions/:name", (c) => serveConvention(c, c.req.param("name")));

  // ---- health ----

  app.get("/api/health", (c) => c.json({ ok: true, brainPath: brain.root }));

  // Anything else under /api is a JSON 404, even when this app is mounted next to the web UI.
  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: `no route for ${c.req.method} ${c.req.path}` } }, 404));

  return app;
}
