import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  BrainError,
  NotFoundError,
  ValidationError,
  type Brain,
  type NoteType,
  type SearchMode,
  type SearchOptions,
  type WriteMeta,
} from "../core/types.ts";

export interface ApiOptions {
  /** Folder holding conventions.md, file.md, and garden.md. */
  conventionsDir: string;
}

const CONVENTION_NAMES = new Set(["conventions", "file", "garden"]);

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json",
  csv: "text/csv; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

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

function parseSearchOptions(c: Context): { q: string; opts: SearchOptions } {
  const q = c.req.query("q");
  if (q === undefined || q.trim() === "") throw new ValidationError("q is required");
  const opts: SearchOptions = {};

  const limitRaw = c.req.query("limit");
  if (limitRaw !== undefined && limitRaw !== "") {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new ValidationError("limit must be an integer from 1 to 100");
    opts.limit = n;
  } else {
    opts.limit = 20;
  }

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

  return { q, opts };
}

export function createApi(brain: Brain, opts: ApiOptions): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof BrainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
    }
    return c.json({ error: { code: "internal", message: err.message } }, 500);
  });

  // ---- notes ----

  app.get("/api/notes", async (c) => {
    const tag = c.req.query("tag") || undefined;
    const type = parseNoteType(c.req.query("type"), "type");
    return c.json(await brain.list({ tag, type }));
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

  // ---- search ----

  app.get("/api/search", async (c) => {
    const { q, opts: searchOpts } = parseSearchOptions(c);
    return c.json(await brain.search(q, searchOpts));
  });

  // ---- tags ----

  app.get("/api/tags", async (c) => c.json(await brain.tags()));

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
    const abs = brain.store.resolve(rel);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(abs);
    } catch {
      throw new NotFoundError(`file ${rel}`);
    }
    if (!stat.isFile()) throw new NotFoundError(`file ${rel}`);
    const stream = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(abs),
        "Content-Length": String(stat.size),
        "Cache-Control": "no-cache",
      },
    });
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

  app.get("/api/health", (c) => c.json({ ok: true, brainPath: brain.store.root }));

  // Anything else under /api is a JSON 404, even when this app is mounted next to the web UI.
  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: `no route for ${c.req.method} ${c.req.path}` } }, 404));

  return app;
}
