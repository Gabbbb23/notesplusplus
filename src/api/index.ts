import fs from "node:fs";
import path from "node:path";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  BrainError,
  ForbiddenError,
  NOTE_LIST_LIMIT,
  NotFoundError,
  SEARCH_LIMIT,
  ValidationError,
  type Brain,
  type NotePage,
  type NoteSummary,
  type NoteType,
  type SearchMode,
  type SearchOptions,
  type SearchPage,
  type Tag,
  type TagWithCount,
  type WriteMeta,
} from "../core/types.ts";
import { fileResponse } from "./file-response.ts";
import { createLauncher, type Launcher } from "./launcher.ts";
import { isOpenable, resolveAllowedPath } from "./local-paths.ts";
import { noteTrail } from "./trail.ts";

export interface ApiOptions {
  /** Folder holding conventions.md, file.md, and garden.md. */
  conventionsDir: string;
  /** Starts programs for /api/open and /api/reveal. Defaults to the real one for this platform. */
  launcher?: Launcher;
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
  if (c.req.method === "POST" && (c.req.path === "/api/open" || c.req.path === "/api/reveal")) {
    const mediaType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (mediaType !== "application/json") {
      throw new BrainError("Content-Type must be application/json", 415, "unsupported_media_type");
    }
  }
  await next();
};

const noteType = z.enum(["note", "hub", "source"]);

const frontmatterInput = z
  .object({
    title: z.string(),
    type: noteType,
    summary: z.string(),
    tags: z.array(z.string()),
    created: z.string().optional(),
    updated: z.string().optional(),
    sources: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
  })
  .strict();

const writeNoteInput = z.object({
  slug: z.string().optional(),
  frontmatter: frontmatterInput,
  body: z.string(),
  expectedMtimeMs: z.number().optional(),
});

const putNoteInput = z.object({
  frontmatter: frontmatterInput,
  body: z.string(),
  expectedMtimeMs: z.number().optional(),
});

const renameInput = z.object({ newSlug: z.string() });
const tagInput = z.object({ name: z.string(), description: z.string() });
const inboxAddInput = z.object({ name: z.string(), content: z.string() });
const inboxTakeInput = z.object({
  name: z.string(),
  title: z.string().optional(),
  slug: z.string().optional(),
  summary: z.string().optional(),
});
const pathInput = z.object({ path: z.string() });

function issuesToMessage(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message))
    .join("; ");
}

async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ValidationError("invalid JSON body");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new ValidationError(issuesToMessage(result.error));
  return result.data;
}

function metaFrom(c: Context): WriteMeta {
  const header = (c.req.header("x-brain-tool") ?? "").trim().slice(0, 64);
  return { tool: header === "" ? "api" : header };
}

function parseNoteType(value: string | undefined, what: string): NoteType | undefined {
  if (value === undefined || value === "") return undefined;
  const r = noteType.safeParse(value);
  if (!r.success) throw new ValidationError(`${what} must be one of note, hub, source`);
  return r.data;
}

/** An integer query parameter, or `fallback` when it is absent or empty. 400 when it is not an integer in range. */
function parseIntQuery(c: Context, name: string, fallback: number, min: number, max?: number): number {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || (max !== undefined && n > max)) {
    throw new ValidationError(
      max === undefined ? `${name} must be an integer of ${min} or more` : `${name} must be an integer from ${min} to ${max}`,
    );
  }
  return n;
}

function parseSearchOptions(c: Context): { q: string; limit: number; opts: SearchOptions } {
  const q = c.req.query("q");
  if (q === undefined || q.trim() === "") throw new ValidationError("q is required");
  const limit = parseIntQuery(c, "limit", SEARCH_LIMIT.default, 1, SEARCH_LIMIT.max);
  const opts: SearchOptions = {};

  const modeRaw = c.req.query("mode");
  if (modeRaw !== undefined && modeRaw !== "") {
    if (!["hybrid", "keyword", "semantic"].includes(modeRaw)) {
      throw new ValidationError("mode must be one of hybrid, keyword, semantic");
    }
    opts.mode = modeRaw as SearchMode;
  }

  const files = c.req.query("files");
  if (files === "false") opts.includeFiles = false;

  const tag = c.req.query("tag");
  if (tag) opts.tag = tag;

  const type = parseNoteType(c.req.query("type"), "type");
  if (type) opts.type = type;

  return { q, limit, opts };
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

  app.onError((err, c) => {
    if (err instanceof BrainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
    }
    return c.json({ error: { code: "internal", message: err.message } }, 500);
  });

  app.use("/api/*", requestGuard);

  // ---- notes ----

  app.get("/api/notes", async (c) => {
    const tag = c.req.query("tag") || undefined;
    const type = parseNoteType(c.req.query("type"), "type");
    const limit = parseIntQuery(c, "limit", NOTE_LIST_LIMIT.default, 1, NOTE_LIST_LIMIT.max);
    const offset = parseIntQuery(c, "offset", 0, 0);
    // The store still reads every note; paging trims the response, not the scan.
    const notes = await brain.list({ tag, type });
    const page: NotePage = { items: notes.slice(offset, offset + limit), total: notes.length, limit, offset };
    return c.json(page);
  });

  app.post("/api/notes", async (c) => {
    const input = await parseBody(c, writeNoteInput);
    return c.json(await brain.write(input, metaFrom(c)), 201);
  });

  app.get("/api/notes/:slug", async (c) => {
    const slug = c.req.param("slug");
    const note = await brain.get(slug);
    if (!note) throw new NotFoundError(`note ${slug}`);
    return c.json(note);
  });

  app.put("/api/notes/:slug", async (c) => {
    const slug = c.req.param("slug");
    const input = await parseBody(c, putNoteInput);
    return c.json(await brain.write({ slug, ...input }, metaFrom(c)));
  });

  app.delete("/api/notes/:slug", async (c) => {
    await brain.delete(c.req.param("slug"), metaFrom(c));
    return c.body(null, 204);
  });

  app.post("/api/notes/:slug/rename", async (c) => {
    const { newSlug } = await parseBody(c, renameInput);
    return c.json(await brain.rename(c.req.param("slug"), newSlug, metaFrom(c)));
  });

  app.get("/api/notes/:slug/backlinks", async (c) => {
    return c.json(await brain.backlinks(c.req.param("slug")));
  });

  // `:slug` matches one path segment, so /api/notes/:slug above never captures this route.
  app.get("/api/notes/:slug/trail", async (c) => c.json(await noteTrail(brain, c.req.param("slug"))));

  // ---- search ----

  app.get("/api/search", async (c) => {
    const { q, limit, opts: searchOpts } = parseSearchOptions(c);
    // One extra result answers whether more exist without a second query.
    const hits = await brain.search(q, { ...searchOpts, limit: limit + 1 });
    const page: SearchPage = { results: hits.slice(0, limit), hasMore: hits.length > limit };
    return c.json(page);
  });

  // ---- tags ----

  app.get("/api/tags", async (c) => {
    const [tags, notes] = await Promise.all([brain.tags(), brain.list()]);
    return c.json(withCounts(tags, notes));
  });

  app.post("/api/tags", async (c) => {
    const tag = await parseBody(c, tagInput);
    return c.json(await brain.createTag(tag, metaFrom(c)), 201);
  });

  // ---- inbox ----

  app.get("/api/inbox", async (c) => c.json(await brain.inboxList()));

  app.post("/api/inbox", async (c) => {
    const { name, content } = await parseBody(c, inboxAddInput);
    return c.json(await brain.inboxAdd(name, content), 201);
  });

  app.post("/api/inbox/take", async (c) => {
    const { name, ...takeOpts } = await parseBody(c, inboxTakeInput);
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

  // Files outside the brain, allowed when a note mentions them. See local-paths.ts for the rules.
  app.get("/api/local-file", async (c) => {
    const requested = c.req.query("path");
    if (requested === undefined) throw new ValidationError("path is required");
    const { abs, stat } = await resolveAllowedPath(brain, requested);
    if (!stat.isFile()) throw new NotFoundError(`file ${requested}`);
    return fileResponse(c, abs, stat.size);
  });

  app.post("/api/open", async (c) => {
    const { path: requested } = await parseBody(c, pathInput);
    const { abs, stat } = await resolveAllowedPath(brain, requested);
    if (stat.isFile() && !isOpenable(abs)) {
      throw new ForbiddenError(`${path.win32.basename(abs)} is not a type that can be opened; reveal it instead`);
    }
    await launcher.open(abs);
    return c.json({ opened: abs });
  });

  app.post("/api/reveal", async (c) => {
    const { path: requested } = await parseBody(c, pathInput);
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
