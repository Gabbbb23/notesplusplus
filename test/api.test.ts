import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApi } from "../src/api/index.ts";
import { seededBrain, type FakeBrain } from "./helpers/fake-brain.ts";

let root: string;
let conventionsDir: string;
let brain: FakeBrain;
let app: Hono;

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "npp-api-"));
  conventionsDir = path.join(root, "conventions");
  fs.mkdirSync(conventionsDir);
  fs.writeFileSync(path.join(conventionsDir, "conventions.md"), "# Conventions\n\nstub\n");
  fs.writeFileSync(path.join(conventionsDir, "file.md"), "# File skill\n");
  fs.writeFileSync(path.join(conventionsDir, "garden.md"), "# Garden skill\n");
  brain = seededBrain(root);
  app = createApi(brain, { conventionsDir });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("notes", () => {
  it("GET /api/notes lists summaries and filters by tag and type", async () => {
    const res = await app.request("/api/notes");
    expect(res.status).toBe(200);
    const all = (await res.json()) as Array<{ slug: string; body?: string }>;
    expect(all.map((n) => n.slug).sort()).toEqual(["index", "laptop-transcript", "ryzen-laptop-specs"]);
    expect(all[0]).not.toHaveProperty("body");

    const byTag = (await (await app.request("/api/notes?tag=hardware")).json()) as Array<{ slug: string }>;
    expect(byTag.map((n) => n.slug)).toEqual(["ryzen-laptop-specs"]);

    const byType = (await (await app.request("/api/notes?type=source")).json()) as Array<{ slug: string }>;
    expect(byType.map((n) => n.slug)).toEqual(["laptop-transcript"]);

    expect((await app.request("/api/notes?type=bogus")).status).toBe(400);
  });

  it("POST /api/notes creates with a derived slug and returns 201", async () => {
    const res = await app.request(
      "/api/notes",
      json({ frontmatter: { title: "New Note Here", type: "note", summary: "s", tags: ["laptop"] }, body: "hi" }),
    );
    expect(res.status).toBe(201);
    const note = (await res.json()) as { slug: string; path: string; frontmatter: { created: string } };
    expect(note.slug).toBe("new-note-here");
    expect(note.path).toBe("notes/new-note-here.md");
    expect(note.frontmatter.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("POST /api/notes rejects invalid JSON and schema failures with 400", async () => {
    const bad = await app.request("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: "validation", message: "invalid JSON body" } });

    const missing = await app.request("/api/notes", json({ frontmatter: { title: "x" }, body: "b" }));
    expect(missing.status).toBe(400);
    const body = (await missing.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation");
    expect(body.error.message).toContain("frontmatter.type");
  });

  it("POST /api/notes maps store validation errors (unknown tags) to 400", async () => {
    const res = await app.request(
      "/api/notes",
      json({ frontmatter: { title: "T", type: "note", summary: "s", tags: ["nope"] }, body: "" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "validation", message: "unknown tags: nope" } });
  });

  it("GET /api/notes/:slug returns the note or 404", async () => {
    const res = await app.request("/api/notes/ryzen-laptop-specs");
    expect(res.status).toBe(200);
    const note = (await res.json()) as { slug: string; body: string; links: string[]; mtimeMs: number };
    expect(note.slug).toBe("ryzen-laptop-specs");
    expect(note.links).toEqual(["laptop-transcript", "index"]);
    expect(typeof note.mtimeMs).toBe("number");

    const missing = await app.request("/api/notes/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "not_found", message: "note nope not found" } });
  });

  it("PUT /api/notes/:slug replaces and enforces expectedMtimeMs with 409", async () => {
    const put = (expectedMtimeMs?: number) =>
      app.request("/api/notes/ryzen-laptop-specs", {
        ...json({ frontmatter: { title: "Ryzen laptop specs", type: "note", summary: "new", tags: ["laptop"] }, body: "replaced", expectedMtimeMs }),
        method: "PUT",
      });
    const conflict = await put(1);
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe("conflict");

    const current = brain.notes.get("ryzen-laptop-specs")!.mtimeMs;
    const ok = await put(current);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { body: string }).body).toBe("replaced");

    const created = await app.request("/api/notes/brand-new", {
      ...json({ frontmatter: { title: "Brand new", type: "note", summary: "s", tags: [] }, body: "b" }),
      method: "PUT",
    });
    expect(created.status).toBe(200);
    expect(brain.notes.has("brand-new")).toBe(true);
  });

  it("DELETE /api/notes/:slug returns 204 and 404 afterwards", async () => {
    const res = await app.request("/api/notes/laptop-transcript", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await app.request("/api/notes/laptop-transcript", { method: "DELETE" })).status).toBe(404);
  });

  it("POST /api/notes/:slug/rename returns RenameResult and rewrites links", async () => {
    const res = await app.request("/api/notes/laptop-transcript/rename", json({ newSlug: "laptop-source" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { note: { slug: string }; rewritten: string[] };
    expect(body.note.slug).toBe("laptop-source");
    expect(body.rewritten).toEqual(["ryzen-laptop-specs"]);
    expect(brain.notes.get("ryzen-laptop-specs")!.body).toContain("[[laptop-source]]");
  });

  it("GET /api/notes/:slug/backlinks lists linking notes", async () => {
    const res = await app.request("/api/notes/laptop-transcript/backlinks");
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ slug: string }>).map((n) => n.slug)).toEqual(["ryzen-laptop-specs"]);
  });
});

describe("X-Brain-Tool", () => {
  it("defaults to api and propagates a trimmed, capped header into WriteMeta", async () => {
    await app.request("/api/notes", json({ frontmatter: { title: "A", type: "note", summary: "s", tags: [] }, body: "" }));
    expect(brain.writes.at(-1)!.meta).toEqual({ tool: "api" });

    await app.request("/api/notes", json({ frontmatter: { title: "B", type: "note", summary: "s", tags: [] }, body: "" }, { "X-Brain-Tool": "  claude-code  " }));
    expect(brain.writes.at(-1)!.meta).toEqual({ tool: "claude-code" });

    await app.request("/api/notes/a", { method: "DELETE", headers: { "X-Brain-Tool": "x".repeat(100) } });
    expect(brain.writes.at(-1)!.meta.tool).toHaveLength(64);

    await app.request("/api/tags", json({ name: "new-tag", description: "d" }, { "X-Brain-Tool": "codex" }));
    expect(brain.writes.at(-1)).toMatchObject({ action: "createTag", meta: { tool: "codex" } });
  });
});

describe("search", () => {
  it("GET /api/search returns results and honours limit, files, tag, type", async () => {
    const res = await app.request("/api/search?q=ryzen");
    expect(res.status).toBe(200);
    const results = (await res.json()) as Array<{ kind: string; id: string; snippet: string }>;
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]!.snippet).toContain("«");

    const limited = (await (await app.request("/api/search?q=ryzen&limit=1")).json()) as unknown[];
    expect(limited).toHaveLength(1);

    const files = (await (await app.request("/api/search?q=invoice")).json()) as Array<{ kind: string }>;
    expect(files.some((r) => r.kind === "file")).toBe(true);
    const noFiles = (await (await app.request("/api/search?q=invoice&files=false")).json()) as Array<{ kind: string }>;
    expect(noFiles.some((r) => r.kind === "file")).toBe(false);

    const typed = (await (await app.request("/api/search?q=laptop&type=source&mode=keyword")).json()) as Array<{ id: string }>;
    expect(typed.map((r) => r.id)).toEqual(["laptop-transcript"]);

    const tagged = (await (await app.request("/api/search?q=laptop&tag=hardware&files=false")).json()) as Array<{ id: string }>;
    expect(tagged.map((r) => r.id)).toEqual(["ryzen-laptop-specs"]);
  });

  it("GET /api/search validates q, limit, and mode", async () => {
    expect((await app.request("/api/search")).status).toBe(400);
    expect((await app.request("/api/search?q=x&limit=0")).status).toBe(400);
    expect((await app.request("/api/search?q=x&limit=101")).status).toBe(400);
    expect((await app.request("/api/search?q=x&limit=abc")).status).toBe(400);
    expect((await app.request("/api/search?q=x&mode=psychic")).status).toBe(400);
  });
});

describe("tags", () => {
  it("GET /api/tags and POST /api/tags", async () => {
    const list = await app.request("/api/tags");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([
      { name: "hardware", description: "Physical machines and parts" },
      { name: "laptop", description: "Portable computers" },
    ]);

    const created = await app.request("/api/tags", json({ name: "gpu", description: "Graphics cards" }));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ name: "gpu", description: "Graphics cards" });

    const dup = await app.request("/api/tags", json({ name: "gpu", description: "again" }));
    expect(dup.status).toBe(409);

    const bad = await app.request("/api/tags", json({ name: "gpu" }));
    expect(bad.status).toBe(400);
  });
});

describe("inbox", () => {
  it("GET /api/inbox, POST /api/inbox, POST /api/inbox/take", async () => {
    expect(await (await app.request("/api/inbox")).json()).toEqual([]);

    const added = await app.request("/api/inbox", json({ name: "talk.md", content: "hello world" }));
    expect(added.status).toBe(201);
    const item = (await added.json()) as { name: string; path: string; sizeBytes: number; isText: boolean };
    expect(item).toMatchObject({ name: "talk.md", path: "inbox/talk.md", sizeBytes: 11, isText: true });

    const listed = (await (await app.request("/api/inbox")).json()) as Array<{ name: string }>;
    expect(listed.map((i) => i.name)).toEqual(["talk.md"]);

    const taken = await app.request("/api/inbox/take", json({ name: "talk.md", title: "A talk", summary: "About things" }, { "X-Brain-Tool": "claude" }));
    expect(taken.status).toBe(200);
    const result = (await taken.json()) as { kind: string; note: { slug: string; type: string; body: string } };
    expect(result.kind).toBe("source");
    expect(result.note).toMatchObject({ slug: "a-talk", type: "source", body: "hello world" });
    expect(brain.writes.at(-1)).toMatchObject({ action: "inboxTake", meta: { tool: "claude" } });

    expect((await app.request("/api/inbox/take", json({ name: "talk.md" }))).status).toBe(404);
    expect((await app.request("/api/inbox/take", json({}))).status).toBe(400);
  });
});

describe("files", () => {
  it("GET /api/files lists entries", async () => {
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);
    const files = (await res.json()) as Array<{ path: string; ext: string; sizeBytes: number }>;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "files/invoice.pdf", ext: "pdf" });
  });

  it("GET /api/files/* streams bytes with a content type", async () => {
    const res = await app.request("/api/files/invoice.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.4 fake invoice");

    brain.addFile("files/sub dir/notes.md", "# hi");
    const md = await app.request("/api/files/sub%20dir/notes.md");
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");

    brain.addFile("files/blob.xyz", "?");
    expect((await app.request("/api/files/blob.xyz")).headers.get("content-type")).toBe("application/octet-stream");
  });

  it("GET /api/files/* 404s on missing files and directories", async () => {
    expect((await app.request("/api/files/nope.pdf")).status).toBe(404);
    fs.mkdirSync(path.join(root, "files", "dir"));
    expect((await app.request("/api/files/dir")).status).toBe(404);
  });

  it("GET /api/files/* rejects path traversal", async () => {
    fs.writeFileSync(path.join(root, "secret.txt"), "top secret");
    // `new Request()` collapses "../" (and "%2e%2e/") before Hono sees the path, but
    // @hono/node-server passes the raw request line through untouched, so in production a
    // dotted path does reach the route. Mimic that by overriding the Request's url.
    const raw = (p: string) => {
      const req = new Request("http://localhost/");
      Object.defineProperty(req, "url", { value: `http://localhost${p}` });
      return app.fetch(req);
    };
    for (const p of ["/api/files/../secret.txt", "/api/files/%2e%2e/secret.txt", "/api/files/x/../../secret.txt"]) {
      const res = await raw(p);
      expect(res.status, p).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation");
    }
    // Through a normalising client the same paths fold away from files/ and simply miss.
    for (const p of ["/api/files/../secret.txt", "/api/files/..%2Fsecret.txt"]) {
      const res = await app.request(p);
      expect(res.status, p).toBe(404);
      expect(await res.text()).not.toContain("top secret");
    }
  });

  it("GET /api/files/* is read-only", async () => {
    expect((await app.request("/api/files/invoice.pdf", { method: "DELETE" })).status).toBe(404);
    expect((await app.request("/api/files/invoice.pdf", { method: "PUT", body: "x" })).status).toBe(404);
  });
});

describe("maintenance", () => {
  it("GET /api/check-links returns a LinkReport", async () => {
    brain.seed({
      slug: "dangling",
      frontmatter: { title: "Dangling", type: "note", summary: "s", tags: [], sources: ["gone"], files: ["files/missing.pdf"] },
      body: "[[nowhere]]",
    });
    const res = await app.request("/api/check-links");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      brokenLinks: [{ from: "dangling", to: "nowhere" }],
      missingFiles: [{ from: "dangling", file: "files/missing.pdf" }],
      missingSources: [{ from: "dangling", source: "gone" }],
      invalidNotes: [],
    });
  });

  it("GET /api/stats and POST /api/reindex", async () => {
    expect(await (await app.request("/api/stats")).json()).toEqual({ notes: 3, files: 1, invalid: 0 });
    const res = await app.request("/api/reindex", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notes: 3, files: 1, invalid: 0, durationMs: 3 });
    expect(brain.reindexCalls).toBe(1);
  });

  it("GET /api/health reports the brain path", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, brainPath: root });
  });
});

describe("conventions", () => {
  it("serves the three convention files as markdown", async () => {
    const root = await app.request("/api/conventions");
    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await root.text()).toContain("# Conventions");

    for (const [name, heading] of [["conventions", "# Conventions"], ["file", "# File skill"], ["garden", "# Garden skill"]]) {
      const res = await app.request(`/api/conventions/${name}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(heading);
    }
  });

  it("404s on unknown names and missing files", async () => {
    const bad = await app.request("/api/conventions/secrets");
    expect(bad.status).toBe(404);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("not_found");

    fs.rmSync(path.join(conventionsDir, "garden.md"));
    expect((await app.request("/api/conventions/garden")).status).toBe(404);
  });
});

describe("errors", () => {
  it("maps unknown errors to 500 with code internal", async () => {
    brain.failures.set("stats", new Error("disk on fire"));
    const res = await app.request("/api/stats");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "internal", message: "disk on fire" } });
    // The failure is one-shot; the route recovers.
    expect((await app.request("/api/stats")).status).toBe(200);
  });

  it("returns a JSON 404 for unknown API routes", async () => {
    const res = await app.request("/api/nothing-here");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
});
