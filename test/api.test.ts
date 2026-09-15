import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { contentTypeFor } from "../src/api/file-response.ts";
import { createApi } from "../src/api/index.ts";
import type { Launcher } from "../src/api/launcher.ts";
import type { Brain, NotePage, SearchPage } from "../src/core/types.ts";
import { TempBrain, type NoteFixture } from "./helpers/temp-brain.ts";

// The REST app runs on a real brain: file store, git repo, and SQLite index (embeddings off) in temp folders.

const meta = { tool: "test" };

/**
 * Built once through the real brain; every group works on a copy.
 *   tags: hardware, laptop
 *   index (hub) -> links [[ryzen-laptop-specs]]
 *   ryzen-laptop-specs (note) -> links [[laptop-transcript]], [[index]], sources [laptop-transcript], files [files/invoice.pdf]
 *   laptop-transcript (source)
 *   files/invoice.pdf
 */
let seeded: TempBrain;
let conventionsDir: string;

/** The brain the current test runs against, its repo root, and the REST app over it. */
let tb: TempBrain;
let brain: Brain;
let root: string;
let app: Hono;
/** What the fake launcher was asked to do. No test starts a real program. */
let launched: Array<{ action: "open" | "reveal"; path: string; isDirectory?: boolean }>;

const launcher: Launcher = {
  open: async (p) => void launched.push({ action: "open", path: p }),
  reveal: async (p, isDirectory) => void launched.push({ action: "reveal", path: p, isDirectory }),
};

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/**
 * A one-page PDF showing `text`, with a correct xref table. The index extracts real PDFs, and a malformed one makes
 * pdf.js print a warning on every reindex.
 */
function minimalPdf(text: string): string {
  const content = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const INVOICE_PDF = minimalPdf("Invoice total 62000 PHP");

function writeConventions(): void {
  fs.writeFileSync(path.join(conventionsDir, "conventions.md"), "# Conventions\n\nstub\n");
  fs.writeFileSync(path.join(conventionsDir, "file.md"), "# File skill\n");
  fs.writeFileSync(path.join(conventionsDir, "garden.md"), "# Garden skill\n");
}

beforeAll(async () => {
  conventionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "npp-conventions-"));
  writeConventions();

  seeded = await TempBrain.create();
  const b = seeded.brain;
  await b.createTag({ name: "hardware", description: "Physical machines and parts" }, meta);
  await b.createTag({ name: "laptop", description: "Portable computers" }, meta);
  await b.write(
    {
      slug: "index",
      frontmatter: { title: "Index", type: "hub", summary: "Root hub of the brain.", tags: [] },
      body: "# Hubs\n\n- [[ryzen-laptop-specs|Laptop specs]]\n",
    },
    meta,
  );
  await b.write(
    {
      slug: "ryzen-laptop-specs",
      frontmatter: {
        title: "Ryzen laptop specs",
        type: "note",
        summary: "The laptop has a Ryzen 7 7735HS and an RTX 4050.",
        tags: ["hardware", "laptop"],
        sources: ["laptop-transcript"],
        files: ["files/invoice.pdf"],
      },
      body: "The CPU is a **Ryzen 7 7735HS**. See [[laptop-transcript]] and [[index|home]].\n\n`[[not-a-link]]` stays code.\n",
    },
    meta,
  );
  await b.write(
    {
      slug: "laptop-transcript",
      frontmatter: { title: "Laptop transcript", type: "source", summary: "Raw transcript about the laptop.", tags: ["laptop"] },
      body: "Speaker 1: the laptop has 16 GB RAM <b>bold</b> and a Ryzen chip.\n",
    },
    meta,
  );
  await seeded.addFile("files/invoice.pdf", INVOICE_PDF);
});

afterAll(async () => {
  await seeded.dispose();
  fs.rmSync(conventionsDir, { recursive: true, force: true });
});

beforeEach(() => {
  launched = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function use(t: TempBrain): void {
  tb = t;
  brain = t.brain;
  root = t.root;
  app = createApi(brain, { conventionsDir, launcher });
}

/** Every test in the enclosing describe gets its own copy of the seeded brain. For groups whose tests change it. */
function freshBrainPerTest(): void {
  beforeEach(async () => use(await seeded.copy()));
  afterEach(async () => tb.dispose());
}

/** One copy of the seeded brain for the whole describe, after `setup`. For groups whose tests do not disturb each other. */
function sharedBrain(setup?: (t: TempBrain) => Promise<void>): void {
  let shared: TempBrain;
  beforeAll(async () => {
    shared = await seeded.copy();
    await setup?.(shared);
  });
  beforeEach(() => use(shared));
  afterAll(async () => shared.dispose());
}

describe("notes", () => {
  sharedBrain();

  it("GET /api/notes lists summaries and filters by tag and type", async () => {
    const res = await app.request("/api/notes");
    expect(res.status).toBe(200);
    const all = (await res.json()) as NotePage;
    expect(all.items.map((n) => n.slug).sort()).toEqual(["index", "laptop-transcript", "ryzen-laptop-specs"]);
    expect(all.items[0]).not.toHaveProperty("body");

    const byTag = (await (await app.request("/api/notes?tag=hardware")).json()) as NotePage;
    expect(byTag.items.map((n) => n.slug)).toEqual(["ryzen-laptop-specs"]);

    const byType = (await (await app.request("/api/notes?type=source")).json()) as NotePage;
    expect(byType.items.map((n) => n.slug)).toEqual(["laptop-transcript"]);

    expect((await app.request("/api/notes?type=bogus")).status).toBe(400);
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
    expect(await res.json()).toEqual({ error: { code: "validation", message: "unknown tags: nope. Create them with createTag first." } });
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

  it("GET /api/notes/:slug/backlinks lists linking notes", async () => {
    const res = await app.request("/api/notes/laptop-transcript/backlinks");
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ slug: string }>).map((n) => n.slug)).toEqual(["ryzen-laptop-specs"]);
  });
});

describe("note writes", () => {
  freshBrainPerTest();

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

  it("PUT /api/notes/:slug replaces and enforces expectedMtimeMs with 409", async () => {
    const put = (expectedMtimeMs?: number) =>
      app.request("/api/notes/ryzen-laptop-specs", {
        ...json({ frontmatter: { title: "Ryzen laptop specs", type: "note", summary: "new", tags: ["laptop"] }, body: "replaced", expectedMtimeMs }),
        method: "PUT",
      });
    const conflict = await put(1);
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe("conflict");

    const current = (await brain.get("ryzen-laptop-specs"))!.mtimeMs;
    const ok = await put(current);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { body: string }).body).toBe("replaced");

    const created = await app.request("/api/notes/brand-new", {
      ...json({ frontmatter: { title: "Brand new", type: "note", summary: "s", tags: [] }, body: "b" }),
      method: "PUT",
    });
    expect(created.status).toBe(200);
    expect(await brain.get("brand-new")).not.toBeNull();
  });

  it("DELETE /api/notes/:slug returns 204 and 404 afterwards", async () => {
    const res = await app.request("/api/notes/laptop-transcript", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await app.request("/api/notes/laptop-transcript", { method: "DELETE" })).status).toBe(404);
  });

  it("POST /api/notes/:slug/rename returns RenameResult, rewrites links, and refuses a taken slug with 400", async () => {
    const taken = await app.request("/api/notes/laptop-transcript/rename", json({ newSlug: "ryzen-laptop-specs" }));
    expect(taken.status).toBe(400);
    expect(await taken.json()).toEqual({ error: { code: "validation", message: "slug ryzen-laptop-specs already exists" } });

    const res = await app.request("/api/notes/laptop-transcript/rename", json({ newSlug: "laptop-source" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { note: { slug: string }; rewritten: string[] };
    expect(body.note.slug).toBe("laptop-source");
    expect(body.rewritten).toEqual(["ryzen-laptop-specs"]);
    expect((await brain.get("ryzen-laptop-specs"))!.body).toContain("[[laptop-source]]");
  });
});

describe("notes paging", () => {
  // Twelve notes: the three seeded ones plus nine more. Two share a title, so their slugs decide the order.
  // laptop: laptop-transcript (source), ryzen-laptop-specs, note-1, note-3, note-5, note-7.
  sharedBrain((t) =>
    t.writeNotes([
      ...Array.from({ length: 7 }, (_, n): NoteFixture => {
        const i = n + 1;
        return { slug: `note-${i}`, frontmatter: { title: `Note ${i}`, type: "note", summary: "s", tags: i % 2 ? ["laptop"] : [] }, body: "" };
      }),
      { slug: "twin-b", frontmatter: { title: "Twin", type: "note", summary: "s", tags: [] }, body: "" },
      { slug: "twin-a", frontmatter: { title: "Twin", type: "note", summary: "s", tags: [] }, body: "" },
    ]),
  );

  const allSlugs = [
    "index",
    "laptop-transcript",
    "note-1",
    "note-2",
    "note-3",
    "note-4",
    "note-5",
    "note-6",
    "note-7",
    "ryzen-laptop-specs",
    "twin-a",
    "twin-b",
  ];

  const page = async (query: string) => {
    const res = await app.request(`/api/notes${query}`);
    expect(res.status, query).toBe(200);
    return (await res.json()) as NotePage;
  };

  it("GET /api/notes defaults to limit 100 and offset 0, sorted by title then slug", async () => {
    const body = await page("");
    expect(Object.keys(body).sort()).toEqual(["items", "limit", "offset", "total"]);
    expect(body).toMatchObject({ total: 12, limit: 100, offset: 0 });
    expect(body.items.map((n) => n.slug)).toEqual(allSlugs);
    expect(await page("?limit=&offset=")).toEqual(body);
  });

  it("GET /api/notes pages through the whole set without gaps or repeats", async () => {
    for (const limit of [1, 5, 12, 500]) {
      const seen: string[] = [];
      let requests = 0;
      for (let offset = 0; offset < 12; offset += limit) {
        const body = await page(`?limit=${limit}&offset=${offset}`);
        expect(body, `limit ${limit} offset ${offset}`).toMatchObject({ total: 12, limit, offset });
        expect(body.items.length).toBe(Math.min(limit, 12 - offset));
        seen.push(...body.items.map((n) => n.slug));
        requests++;
      }
      expect(seen, `limit ${limit}`).toEqual(allSlugs);
      expect(requests).toBe(Math.ceil(12 / limit));
    }
  });

  it("GET /api/notes counts every match in total when filtered", async () => {
    const byTag = await page("?tag=laptop&limit=2");
    expect(byTag).toMatchObject({ total: 6, limit: 2, offset: 0 });
    expect(byTag.items.map((n) => n.slug)).toEqual(["laptop-transcript", "note-1"]);

    const byTagAndType = await page("?tag=laptop&type=note&limit=2&offset=4");
    expect(byTagAndType).toMatchObject({ total: 5, limit: 2, offset: 4 });
    expect(byTagAndType.items.map((n) => n.slug)).toEqual(["ryzen-laptop-specs"]);
  });

  it("GET /api/notes returns no items but the real total for an offset past the end", async () => {
    expect(await page("?offset=12")).toEqual({ items: [], total: 12, limit: 100, offset: 12 });
    expect(await page("?tag=laptop&offset=1000")).toEqual({ items: [], total: 6, limit: 100, offset: 1000 });
  });

  it("GET /api/notes rejects a limit outside 1 to 500 and a negative or non-numeric offset", async () => {
    const limitMessage = "limit must be an integer from 1 to 500";
    const offsetMessage = "offset must be an integer of 0 or more";
    const cases: Array<[string, string]> = [
      ["limit=0", limitMessage],
      ["limit=501", limitMessage],
      ["limit=abc", limitMessage],
      ["limit=2.5", limitMessage],
      ["offset=-1", offsetMessage],
      ["offset=abc", offsetMessage],
    ];
    for (const [query, message] of cases) {
      const res = await app.request(`/api/notes?${query}`);
      expect(res.status, query).toBe(400);
      expect(await res.json(), query).toEqual({ error: { code: "validation", message } });
    }
  });
});

describe("note trail", () => {
  // index -> college -> ge09-life-and-works-of-rizal -> rizal-day note and a source. ge09 links back to college.
  // laptop-transcript stays linked only from ryzen-laptop-specs, a plain note.
  const hub = (slug: string, title: string, body: string): NoteFixture => ({ slug, frontmatter: { title, type: "hub", summary: "s", tags: [] }, body });
  sharedBrain((t) =>
    t.writeNotes([
      hub("index", "Index", "- [[ryzen-laptop-specs]]\n- [[college]]\n- [[gone]]\n"),
      hub("college", "College", "- [[ge09-life-and-works-of-rizal]]\n"),
      hub("ge09-life-and-works-of-rizal", "GE09 Life and Works of Rizal", "- [[rizal-day-is-rizals-death-anniversary]]\n- [[ge09-video-1-transcript]]\n- [[college]] hub\n"),
      {
        slug: "rizal-day-is-rizals-death-anniversary",
        frontmatter: { title: "Rizal Day is Rizal's death anniversary", type: "note", summary: "s", tags: [] },
        body: "December 30.",
      },
      {
        slug: "ge09-video-1-transcript",
        frontmatter: { title: "GE09 video 1 transcript", type: "source", summary: "s", tags: [] },
        body: "Transcript.",
      },
    ]),
  );

  const trailOf = async (slug: string) => {
    const res = await app.request(`/api/notes/${slug}/trail`);
    return { status: res.status, body: await res.json() };
  };

  const nested = [
    { slug: "index", title: "Index" },
    { slug: "college", title: "College" },
    { slug: "ge09-life-and-works-of-rizal", title: "GE09 Life and Works of Rizal" },
  ];

  it("GET /api/notes/:slug/trail lists the hubs above a nested note or source, not the note itself", async () => {
    // A full match on the trail shape also proves /api/notes/:slug did not answer with the note.
    expect(await trailOf("rizal-day-is-rizals-death-anniversary")).toEqual({ status: 200, body: { trail: nested, inHub: true } });
    expect(await trailOf("ge09-video-1-transcript")).toEqual({ status: 200, body: { trail: nested, inHub: true } });
    expect(await trailOf("college")).toEqual({ status: 200, body: { trail: [{ slug: "index", title: "Index" }], inHub: true } });
  });

  it("GET /api/notes/index/trail is empty and in the hub tree", async () => {
    expect(await trailOf("index")).toEqual({ status: 200, body: { trail: [], inHub: true } });
  });

  it("GET /api/notes/:slug/trail reports a note no hub chain reaches, and every note once index is gone", async () => {
    expect(await trailOf("laptop-transcript")).toEqual({ status: 200, body: { trail: [], inHub: false } });
    // The store refuses to delete the root hub, but the file can still go missing on disk.
    const indexFile = path.join(root, "notes", "index.md");
    const saved = fs.readFileSync(indexFile);
    fs.rmSync(indexFile);
    try {
      expect(await trailOf("rizal-day-is-rizals-death-anniversary")).toEqual({ status: 200, body: { trail: [], inHub: false } });
    } finally {
      fs.writeFileSync(indexFile, saved);
    }
  });

  it("GET /api/notes/:slug/trail returns 404 for an unknown slug, including one a hub links to", async () => {
    for (const slug of ["nope", "gone"]) {
      expect(await trailOf(slug), slug).toEqual({ status: 404, body: { error: { code: "not_found", message: `note ${slug} not found` } } });
    }
  });
});

describe("X-Brain-Tool", () => {
  freshBrainPerTest();

  it("defaults to api and puts a trimmed, capped header in the commit message", async () => {
    const lastCommitAfter = async (res: Response | Promise<Response>) => {
      expect((await res).ok).toBe(true);
      return (await tb.commits())[0];
    };
    const note = (title: string) => ({ frontmatter: { title, type: "note", summary: "s", tags: [] }, body: "" });

    expect(await lastCommitAfter(app.request("/api/notes", json(note("A"))))).toBe("api: write a");
    expect(await lastCommitAfter(app.request("/api/notes", json(note("B"), { "X-Brain-Tool": "  claude-code  " })))).toBe("claude-code: write b");
    expect(await lastCommitAfter(app.request("/api/notes/a", { method: "DELETE", headers: { "X-Brain-Tool": "x".repeat(100) } }))).toBe(
      `${"x".repeat(64)}: delete a`,
    );
    expect(await lastCommitAfter(app.request("/api/tags", json({ name: "new-tag", description: "d" }, { "X-Brain-Tool": "codex" })))).toBe(
      "codex: create tag new-tag",
    );
  });
});

describe("search", () => {
  sharedBrain();

  it("GET /api/search returns results and honours limit, files, tag, type", async () => {
    const search = async (query: string) => ((await (await app.request(`/api/search?${query}`)).json()) as SearchPage).results;
    const res = await app.request("/api/search?q=ryzen");
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as SearchPage;
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]!.snippet).toContain("«");

    expect(await search("q=ryzen&limit=1")).toHaveLength(1);

    expect((await search("q=invoice")).some((r) => r.kind === "file")).toBe(true);
    expect((await search("q=invoice&files=false")).some((r) => r.kind === "file")).toBe(false);

    expect((await search("q=laptop&type=source&mode=keyword")).map((r) => r.id)).toEqual(["laptop-transcript"]);
    expect((await search("q=laptop&tag=hardware&files=false")).map((r) => r.id)).toEqual(["ryzen-laptop-specs"]);
  });

  it("GET /api/search sets hasMore by asking the brain for one result past the limit", async () => {
    // "ryzen" matches three notes (index links to ryzen-laptop-specs, the transcript mentions the chip) and no files.
    const searchSpy = vi.spyOn(brain, "search");
    const at = async (query: string) => (await (await app.request(`/api/search?q=ryzen${query}`)).json()) as SearchPage;

    const two = await at("&limit=2");
    expect(Object.keys(two).sort()).toEqual(["hasMore", "results"]);
    expect(two.results).toHaveLength(2);
    expect(two.hasMore).toBe(true);

    const three = await at("&limit=3");
    expect(three.results).toHaveLength(3);
    expect(three.hasMore).toBe(false);

    expect(await at("")).toEqual({ results: three.results, hasMore: false });
    expect((await at("&limit=100")).hasMore).toBe(false);
    expect(searchSpy.mock.calls.map(([, opts]) => opts?.limit)).toEqual([3, 4, 21, 101]);
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
  freshBrainPerTest();

  it("GET /api/tags and POST /api/tags", async () => {
    const list = await app.request("/api/tags");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([
      { name: "hardware", description: "Physical machines and parts", count: 1 },
      { name: "laptop", description: "Portable computers", count: 2 },
    ]);

    const created = await app.request("/api/tags", json({ name: "gpu", description: "Graphics cards" }));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ name: "gpu", description: "Graphics cards" });
    expect(await (await app.request("/api/tags")).json()).toContainEqual({ name: "gpu", description: "Graphics cards", count: 0 });

    const dup = await app.request("/api/tags", json({ name: "gpu", description: "again" }));
    expect(dup.status).toBe(400);
    expect(await dup.json()).toEqual({ error: { code: "validation", message: "tag gpu already exists" } });

    const bad = await app.request("/api/tags", json({ name: "gpu" }));
    expect(bad.status).toBe(400);
  });

  it("GET /api/tags counts notes of every type per tag from a single list call", async () => {
    await brain.createTag({ name: "unused", description: "Nothing carries this" }, meta);
    // ryzen-laptop-specs (note) carries hardware and laptop, laptop-transcript (source) carries laptop, the hub carries hardware.
    await tb.writeNotes([{ slug: "hardware", frontmatter: { title: "Hardware", type: "hub", summary: "s", tags: ["hardware"] }, body: "" }]);
    const listSpy = vi.spyOn(brain, "list");
    const res = await app.request("/api/tags");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { name: "hardware", description: "Physical machines and parts", count: 2 },
      { name: "laptop", description: "Portable computers", count: 2 },
      { name: "unused", description: "Nothing carries this", count: 0 },
    ]);
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith();
  });
});

describe("inbox", () => {
  freshBrainPerTest();

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
    expect((await tb.commits())[0]).toBe("claude: take inbox talk.md -> a-talk");

    expect((await app.request("/api/inbox/take", json({ name: "talk.md" }))).status).toBe(404);
    expect((await app.request("/api/inbox/take", json({}))).status).toBe(400);
  });
});

describe("files", () => {
  sharedBrain();

  it("GET /api/files lists entries", async () => {
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);
    const files = (await res.json()) as Array<{ path: string; ext: string; sizeBytes: number }>;
    // Other tests in this group add files, so check the seeded one and that the route returns the brain's listing.
    expect(files).toContainEqual(expect.objectContaining({ path: "files/invoice.pdf", ext: "pdf", sizeBytes: INVOICE_PDF.length }));
    expect(files).toEqual(await brain.files());
  });

  it("GET /api/files/* streams bytes with a content type", async () => {
    const res = await app.request("/api/files/invoice.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe(INVOICE_PDF);

    await tb.addFile("files/sub dir/notes.md", "# hi");
    const md = await app.request("/api/files/sub%20dir/notes.md");
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toBe("text/plain; charset=utf-8");

    await tb.addFile("files/blob.xyz", "?");
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

describe("file responses", () => {
  sharedBrain();

  it("sends the file inline with its name, nosniff, and Accept-Ranges", async () => {
    const res = await app.request("/api/files/invoice.pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="invoice.pdf"; filename*=UTF-8''invoice.pdf`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-security-policy")).toBeNull();

    await tb.addFile("files/Résumé (final).pdf", "x");
    const named = await app.request(`/api/files/${encodeURIComponent("Résumé (final).pdf")}`);
    expect(named.status).toBe(200);
    expect(named.headers.get("content-disposition")).toBe(
      `inline; filename="R_sum_ (final).pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%28final%29.pdf`,
    );
  });

  it("answers a single Range with 206 and an unsatisfiable one with 416", async () => {
    await tb.addFile("files/clip.mp4", "0123456789");
    const get = (range?: string) => app.request("/api/files/clip.mp4", { headers: range ? { range } : {} });

    const full = await get();
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(full.headers.get("content-length")).toBe("10");
    expect(full.headers.get("content-range")).toBeNull();

    const partial: Array<[string, string, string]> = [
      ["bytes=2-5", "2345", "bytes 2-5/10"],
      ["bytes=7-", "789", "bytes 7-9/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
      ["bytes=8-100", "89", "bytes 8-9/10"],
    ];
    for (const [range, body, contentRange] of partial) {
      const res = await get(range);
      expect(res.status, range).toBe(206);
      expect(res.headers.get("content-range"), range).toBe(contentRange);
      expect(res.headers.get("content-length"), range).toBe(String(body.length));
      expect(await res.text(), range).toBe(body);
    }

    for (const range of ["bytes=10-", "bytes=-0"]) {
      const res = await get(range);
      expect(res.status, range).toBe(416);
      expect(res.headers.get("content-range"), range).toBe("bytes */10");
    }

    // Ranges this server does not handle get the whole file.
    for (const range of ["bytes=0-1,4-5", "bytes=5-2", "items=0-1"]) {
      const res = await get(range);
      expect(res.status, range).toBe(200);
      expect(await res.text(), range).toBe("0123456789");
    }
  });

  it("serves text and markup as text/plain", async () => {
    for (const name of ["page.html", "page.htm", "page.xhtml", "feed.xml", "notes.md", "data.json", "run.log", "table.csv", "a.txt"]) {
      await tb.addFile(`files/${name}`, "<script>alert(1)</script>");
      const res = await app.request(`/api/files/${name}`);
      expect(res.headers.get("content-type"), name).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("x-content-type-options"), name).toBe("nosniff");
    }
  });

  it("keeps svg as an image but sandboxes it", async () => {
    await tb.addFile("files/logo.svg", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
    const res = await app.request("/api/files/logo.svg");
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("maps video, audio, and image types", () => {
    const names = ["a.mp4", "a.m4v", "a.webm", "a.mov", "a.mkv", "a.mp3", "a.wav", "a.m4a", "a.ogg", "a.oga", "a.flac", "a.webp", "a.bmp", "a.JFIF", "a.exe"];
    expect(Object.fromEntries(names.map((n) => [n, contentTypeFor(n)]))).toEqual({
      "a.mp4": "video/mp4",
      "a.m4v": "video/mp4",
      "a.webm": "video/webm",
      "a.mov": "video/quicktime",
      "a.mkv": "video/x-matroska",
      "a.mp3": "audio/mpeg",
      "a.wav": "audio/wav",
      "a.m4a": "audio/mp4",
      "a.ogg": "audio/ogg",
      "a.oga": "audio/ogg",
      "a.flac": "audio/flac",
      "a.webp": "image/webp",
      "a.bmp": "image/bmp",
      "a.JFIF": "image/jpeg",
      "a.exe": "application/octet-stream",
    });
  });
});

describe("request guard", () => {
  sharedBrain();

  const status = async (url: string, init?: RequestInit) => (await app.request(url, init)).status;

  it("refuses a foreign Host header", async () => {
    for (const host of ["evil.com", "evil.com:3777", "localhost.evil.com", "127.0.0.1.nip.io:3777", "user@localhost", ""]) {
      const res = await app.request("/api/health", { headers: { host } });
      expect(res.status, host).toBe(403);
      expect(await errorCode(res), host).toBe("forbidden");
    }
  });

  it("refuses Sec-Fetch-Site: cross-site and a foreign Origin, before any route runs", async () => {
    expect(await status("/api/health", { headers: { "sec-fetch-site": "cross-site" } })).toBe(403);
    for (const origin of ["http://evil.com", "http://localhost.evil.com:3777", "null"]) {
      expect(await status("/api/health", { headers: { origin } }), origin).toBe(403);
    }
    expect(await status("/api/open", json({ path: "files/invoice.pdf" }, { origin: "http://evil.com" }))).toBe(403);
    expect(await status("/api/reveal", json({ path: "files/invoice.pdf" }, { "sec-fetch-site": "cross-site" }))).toBe(403);
    expect(await status("/api/nothing-here", { headers: { host: "evil.com" } })).toBe(403);
    expect(launched).toEqual([]);
  });

  it("returns 415 for open and reveal without a JSON content type", async () => {
    const body = JSON.stringify({ path: "files/invoice.pdf" });
    for (const route of ["/api/open", "/api/reveal"]) {
      for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
        const res = await app.request(route, { method: "POST", headers: { "content-type": type }, body });
        expect(res.status, `${route} ${type}`).toBe(415);
        expect(await errorCode(res)).toBe("unsupported_media_type");
      }
    }
    expect(launched).toEqual([]);
  });

  it("lets the built UI, the MCP client, and the Vite dev proxy through", async () => {
    const allowed: Array<Record<string, string>> = [
      { host: "localhost:3777", origin: "http://localhost:3777", "sec-fetch-site": "same-origin" }, // built UI
      { host: "localhost:3777", "x-brain-tool": "mcp", accept: "application/json" }, // MCP client, Node fetch, no Origin
      { host: "localhost:5173", origin: "http://localhost:5173", "sec-fetch-site": "same-origin" }, // Vite dev proxy
      { host: "127.0.0.1:3777", "sec-fetch-site": "none" }, // typed into the address bar
      { host: "[::1]:3777" },
      {}, // app.request sends no Host header
    ];
    for (const headers of allowed) {
      expect(await status("/api/health", { headers }), JSON.stringify(headers)).toBe(200);
    }
    const viaVite = await app.request(
      "/api/open",
      json({ path: "files/invoice.pdf" }, { "content-type": "application/json; charset=utf-8", host: "localhost:5173", origin: "http://localhost:5173" }),
    );
    expect(viaVite.status).toBe(200);
  });
});

describe("open and reveal (brain files)", () => {
  sharedBrain();

  it("POST /api/open opens a brain file or folder and reports the absolute path", async () => {
    const res = await app.request("/api/open", json({ path: "files/invoice.pdf" }));
    expect(res.status).toBe(200);
    const invoice = path.join(root, "files", "invoice.pdf");
    expect(await res.json()).toEqual({ opened: invoice });

    fs.mkdirSync(path.join(root, "files", "college"));
    expect((await app.request("/api/open", json({ path: "files/college" }))).status).toBe(200);
    expect(launched).toEqual([
      { action: "open", path: invoice },
      { action: "open", path: path.join(root, "files", "college") },
    ]);
  });

  it("POST /api/reveal reveals a brain file", async () => {
    const res = await app.request("/api/reveal", json({ path: "files/invoice.pdf" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revealed: path.join(root, "files", "invoice.pdf") });
    expect(launched).toEqual([{ action: "reveal", path: path.join(root, "files", "invoice.pdf"), isDirectory: false }]);
  });

  it("refuses programs for open but still reveals them", async () => {
    await tb.addFile("files/setup.exe", "MZ");
    await tb.addFile("files/shortcut.lnk", "L");
    for (const p of ["files/setup.exe", "files/shortcut.lnk"]) {
      const res = await app.request("/api/open", json({ path: p }));
      expect(res.status, p).toBe(403);
      expect(await errorCode(res)).toBe("forbidden");
    }
    expect(launched).toEqual([]);
    expect((await app.request("/api/reveal", json({ path: "files/setup.exe" }))).status).toBe(200);
    expect(launched).toEqual([{ action: "reveal", path: path.join(root, "files", "setup.exe"), isDirectory: false }]);
  });

  it("refuses a link that reaches .git without naming it", async () => {
    // The brain's real .git holds a config file.
    fs.symlinkSync(path.join(root, ".git"), path.join(root, "files", "gitlink"), "junction");
    const res = await app.request("/api/reveal", json({ path: "files/gitlink/config" }));
    expect(res.status).toBe(403);
    expect(launched).toEqual([]);
  });

  it("returns 400 for malformed input and 404 for missing files", async () => {
    for (const body of [{}, { path: 5 }, { path: "" }, { path: "notes/index.md" }, { path: "files/../secret.txt" }, { path: "\\\\server\\share\\x.pdf" }]) {
      const res = await app.request("/api/open", json(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await errorCode(res)).toBe("validation");
    }
    expect((await app.request("/api/open", json({ path: "files/nope.pdf" }))).status).toBe(404);
    expect((await app.request("/api/reveal", json({ path: "files/nope.pdf" }))).status).toBe(404);
    expect(launched).toEqual([]);
  });
});

// Absolute drive-letter paths only exist on Windows, which is the only place this app runs.
describe.runIf(process.platform === "win32")("files outside the brain", () => {
  let outside: string;
  let pdf: string;

  sharedBrain(async (t) => {
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "npp-outside-"));
    pdf = path.join(outside, "Module 1.pdf");
    fs.writeFileSync(pdf, "%PDF module one");
    fs.writeFileSync(path.join(outside, "Unmentioned.pdf"), "%PDF secret");
    fs.writeFileSync(path.join(outside, "Fenced.pdf"), "%PDF fenced");
    fs.writeFileSync(path.join(outside, "setup.exe"), "MZ");
    fs.writeFileSync(path.join(outside, "Desktop.lnk"), "L");
    await t.writeNotes([
      {
        slug: "ethics",
        frontmatter: { title: "Ethics", type: "note", summary: "s", tags: [] },
        body: [
          `Module 1 is at \`${pdf}\`.`,
          `Folder: \`${outside}\`. Installer \`${path.join(outside, "setup.exe")}\`, shortcut \`${path.join(outside, "Desktop.lnk")}\`.`,
          `Gone: \`${path.join(outside, "Missing.pdf")}\``,
          "```",
          `\`${path.join(outside, "Fenced.pdf")}\``,
          "```",
        ].join("\n"),
      },
    ]);
  });

  afterAll(() => {
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const localFile = (p: string, headers: Record<string, string> = {}) =>
    app.request(`/api/local-file?path=${encodeURIComponent(p)}`, { headers });

  it("GET /api/local-file serves a mentioned path given in another case and slash style", async () => {
    const res = await localFile(pdf.toUpperCase().replace(/\\/g, "/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(`filename*=UTF-8''MODULE%201.PDF`);
    expect(await res.text()).toBe("%PDF module one");

    const ranged = await localFile(pdf, { range: "bytes=0-3" });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe("%PDF");
  });

  it("GET /api/local-file refuses unmentioned paths and paths mentioned only in a fenced block", async () => {
    for (const name of ["Unmentioned.pdf", "Fenced.pdf"]) {
      const res = await localFile(path.join(outside, name));
      expect(res.status, name).toBe(403);
      expect(await errorCode(res)).toBe("forbidden");
    }
  });

  it("GET /api/local-file allows absolute paths inside the brain, except .git", async () => {
    expect(await (await localFile(path.join(root, "files", "invoice.pdf"))).text()).toBe(INVOICE_PDF);
    expect((await localFile(path.join(root, ".git", "config"))).status).toBe(403);
    expect((await localFile(path.join(root, ".GIT", "config").replace(/\\/g, "/"))).status).toBe(403);
  });

  it("GET /api/local-file returns 404 for missing files and folders, 400 for malformed paths", async () => {
    expect((await localFile(path.join(outside, "Missing.pdf"))).status).toBe(404);
    expect((await localFile(outside)).status).toBe(404);
    expect((await app.request("/api/local-file")).status).toBe(400);
    for (const p of ["\\\\server\\share\\Module 1.pdf", `${pdf}:hidden`, "Module 1.pdf"]) {
      expect((await localFile(p)).status, p).toBe(400);
    }
  });

  it("POST /api/open opens mentioned pdfs and folders but refuses programs and shortcuts", async () => {
    const opened = await app.request("/api/open", json({ path: pdf }));
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ opened: pdf });
    expect((await app.request("/api/open", json({ path: outside }))).status).toBe(200);

    for (const name of ["setup.exe", "Desktop.lnk"]) {
      const res = await app.request("/api/open", json({ path: path.join(outside, name) }));
      expect(res.status, name).toBe(403);
    }
    expect((await app.request("/api/open", json({ path: path.join(outside, "Unmentioned.pdf") }))).status).toBe(403);
    expect((await app.request("/api/open", json({ path: path.join(outside, "Missing.pdf") }))).status).toBe(404);
    expect(launched).toEqual([
      { action: "open", path: pdf },
      { action: "open", path: outside },
    ]);
  });

  it("POST /api/reveal reveals a mentioned exe and folder", async () => {
    const exe = path.join(outside, "setup.exe");
    const res = await app.request("/api/reveal", json({ path: exe }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revealed: exe });
    expect((await app.request("/api/reveal", json({ path: outside }))).status).toBe(200);
    expect((await app.request("/api/reveal", json({ path: path.join(outside, "Fenced.pdf") }))).status).toBe(403);
    expect(launched).toEqual([
      { action: "reveal", path: exe, isDirectory: false },
      { action: "reveal", path: outside, isDirectory: true },
    ]);
  });
});

describe("maintenance", () => {
  sharedBrain();

  it("GET /api/check-links returns a LinkReport", async () => {
    await tb.writeNotes([
      {
        slug: "dangling",
        frontmatter: { title: "Dangling", type: "note", summary: "s", tags: [], sources: ["gone"], files: ["files/missing.pdf"] },
        body: "[[nowhere]]",
      },
    ]);
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
    const stats = async () => (await (await app.request("/api/stats")).json()) as { notes: number; files: number; invalid: number };
    // The check-links test may already have added a note to this brain.
    const before = await stats();
    expect(before).toEqual({ notes: expect.any(Number), files: 1, invalid: 0 });
    expect(before.notes).toBeGreaterThanOrEqual(3);

    // A note put on disk behind the brain's back reaches the index only through a reindex.
    await tb.addFile("notes/stray.md", "---\ntitle: Stray\ntype: note\nsummary: s\ntags: []\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\nStray.\n");
    expect(await stats()).toEqual(before);

    const res = await app.request("/api/reindex", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...before, notes: before.notes + 1, durationMs: expect.any(Number) });
    expect(await stats()).toEqual({ ...before, notes: before.notes + 1 });
  });

  it("GET /api/health reports the brain path", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, brainPath: root });
  });
});

describe("conventions", () => {
  sharedBrain();
  beforeEach(writeConventions);

  it("serves the three convention files as markdown", async () => {
    const res = await app.request("/api/conventions");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await res.text()).toContain("# Conventions");

    for (const [name, heading] of [["conventions", "# Conventions"], ["file", "# File skill"], ["garden", "# Garden skill"]]) {
      const named = await app.request(`/api/conventions/${name}`);
      expect(named.status).toBe(200);
      expect(await named.text()).toContain(heading);
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
  sharedBrain();

  it("maps unknown errors to 500 with code internal", async () => {
    vi.spyOn(brain, "stats").mockRejectedValueOnce(new Error("disk on fire"));
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
