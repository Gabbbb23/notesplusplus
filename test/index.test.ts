import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createIndex, type Embedder, type IndexOptions } from "../src/core/index/index.ts";
import { chunkBody } from "../src/core/index/embeddings.ts";
import {
  buildMatchExpression,
  cosineTopK,
  reciprocalRankFusion,
} from "../src/core/index/search.ts";
import type {
  FileEntry,
  InvalidNote,
  Note,
  NoteStore,
  SearchIndex,
} from "../src/core/types.ts";

// ---- helpers ---------------------------------------------------------------

const tempDirs: string[] = [];
const openIndexes: SearchIndex[] = [];

afterEach(async () => {
  for (const idx of openIndexes.splice(0)) await idx.close();
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "npp-index-"));
  tempDirs.push(dir);
  return dir;
}

async function makeIndex(extra: Partial<IndexOptions> = {}): Promise<{ idx: SearchIndex; dir: string; opts: IndexOptions }> {
  const dir = await tempDir();
  const opts: IndexOptions = {
    dbPath: path.join(dir, "cache", "index.sqlite"),
    modelCachePath: path.join(dir, "models"),
    embeddings: false,
    ...extra,
  };
  const idx = createIndex(opts);
  await idx.open();
  openIndexes.push(idx);
  return { idx, dir, opts };
}

function note(partial: Partial<Note> & { slug: string }): Note {
  const title = partial.title ?? partial.slug;
  const type = partial.type ?? "note";
  const summary = partial.summary ?? `Summary of ${title}`;
  const tags = partial.tags ?? [];
  const body = partial.body ?? "";
  const dir = type === "source" ? "sources" : "notes";
  return {
    slug: partial.slug,
    path: partial.path ?? `${dir}/${partial.slug}.md`,
    title,
    type,
    summary,
    tags,
    created: "2026-09-13",
    updated: "2026-09-13",
    frontmatter: { title, type, summary, tags, created: "2026-09-13", updated: "2026-09-13" },
    body,
    raw: `---\ntitle: ${title}\n---\n${body}`,
    links: partial.links ?? [],
    mtimeMs: partial.mtimeMs ?? 1,
  };
}

/** A store double with only what `rebuild` uses. */
function fakeStore(root: string, items: Array<Note | InvalidNote>, files: FileEntry[]): NoteStore {
  const store = {
    root,
    async *readAll() {
      for (const item of items) yield item;
    },
    files: async () => files,
    resolve: (rel: string) => path.join(root, rel),
  };
  return store as unknown as NoteStore;
}

/**
 * Deterministic offline embedder: hashed bag of words, normalized. Enough to
 * exercise the KNN paths without the real model.
 */
function fakeEmbedder(dims = 32): Embedder {
  return {
    model: "fake-bow",
    dims,
    async embed(texts) {
      return texts.map((t) => {
        const v = new Float32Array(dims);
        for (const word of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          let h = 7;
          for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % 1_000_003;
          const bucket = h % dims;
          v[bucket] = (v[bucket] ?? 0) + 1;
        }
        let norm = 0;
        for (const x of v) norm += x * x;
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < dims; i++) v[i] = (v[i] ?? 0) / norm;
        return v;
      });
    },
  };
}

// ---- schema and lifecycle -------------------------------------------------

describe("open and schema", () => {
  test("creates the db file and its directory, reopens with data intact", async () => {
    const { idx, opts } = await makeIndex();
    await expect(fs.stat(opts.dbPath)).resolves.toBeTruthy();
    expect(await idx.stats()).toEqual({ notes: 0, files: 0, invalid: 0 });

    await idx.upsertNote(note({ slug: "alpha", body: "first" }));
    await idx.close();

    const again = createIndex(opts);
    await again.open();
    openIndexes.push(again);
    expect(await again.stats()).toEqual({ notes: 1, files: 0, invalid: 0 });
    expect((await again.search("first", { mode: "keyword" }))[0]?.id).toBe("alpha");
  });

  test("methods throw a clear error before open()", async () => {
    const dir = await tempDir();
    const idx = createIndex({ dbPath: path.join(dir, "i.sqlite"), modelCachePath: dir, embeddings: false });
    await expect(idx.stats()).rejects.toThrow(/not open/);
  });
});

// ---- notes and keyword search ---------------------------------------------

describe("keyword search", () => {
  test("finds a note by body and by title", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "ryzen", title: "Ryzen laptop specs", body: "It has an RTX 4050 and 16 GB of memory." }));
    await idx.upsertNote(note({ slug: "cooking", title: "Weeknight pasta", body: "Boil water, add salt." }));

    const byBody = await idx.search("memory", { mode: "keyword" });
    expect(byBody.map((r) => r.id)).toEqual(["ryzen"]);
    expect(byBody[0]).toMatchObject({ kind: "note", title: "Ryzen laptop specs", type: "note", path: "notes/ryzen.md" });

    const byTitle = await idx.search("pasta", { mode: "keyword" });
    expect(byTitle.map((r) => r.id)).toEqual(["cooking"]);
  });

  test("snippet wraps the match in the markers", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "n", body: "Long intro sentence. The warranty expires in March. Trailing text." }));
    const [hit] = await idx.search("warranty", { mode: "keyword" });
    expect(hit?.snippet).toContain("«warranty»");
  });

  test("stems with porter: 'running' matches 'run'", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "n", body: "I went running yesterday." }));
    expect((await idx.search("run", { mode: "keyword" })).length).toBe(1);
  });

  test("tag and type filters narrow results", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "a", tags: ["hardware"], type: "note", body: "shared word" }));
    await idx.upsertNote(note({ slug: "b", tags: ["food"], type: "note", body: "shared word" }));
    await idx.upsertNote(note({ slug: "c", tags: ["hardware"], type: "hub", body: "shared word" }));

    expect((await idx.search("shared", { tag: "hardware" })).map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect((await idx.search("shared", { type: "hub" })).map((r) => r.id)).toEqual(["c"]);
    expect((await idx.search("shared", { tag: "hardware", type: "note" })).map((r) => r.id)).toEqual(["a"]);
    expect(await idx.search("shared", { tag: "nope" })).toEqual([]);
  });

  test("falls back to OR when the AND query has no hits", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "a", body: "apples only" }));
    await idx.upsertNote(note({ slug: "b", body: "bananas only" }));
    const hits = await idx.search("apples bananas");
    expect(hits.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  test("respects limit and sorts by descending score", async () => {
    const { idx } = await makeIndex();
    for (let i = 0; i < 5; i++) {
      await idx.upsertNote(note({ slug: `n${i}`, body: `${"target ".repeat(i + 1)} filler` }));
    }
    const hits = await idx.search("target", { limit: 3 });
    expect(hits).toHaveLength(3);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
  });

  test("a query with quotes, stars, and operators does not throw", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "n", body: 'he said "hello" there' }));
    await expect(idx.search('"hello" * AND (x OR', { mode: "keyword" })).resolves.toBeInstanceOf(Array);
    await expect(idx.search('say "hi"', { mode: "hybrid" })).resolves.toBeInstanceOf(Array);
    expect((await idx.search('"hello"')).map((r) => r.id)).toEqual(["n"]);
  });

  test("empty or whitespace query returns []", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "n", body: "text" }));
    expect(await idx.search("")).toEqual([]);
    expect(await idx.search("   \t ")).toEqual([]);
  });

  test("source notes are indexed like any other", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "transcript", type: "source", body: "verbatim raw material" }));
    const [hit] = await idx.search("verbatim");
    expect(hit).toMatchObject({ id: "transcript", type: "source", path: "sources/transcript.md" });
  });

  test("upsert replaces the earlier version", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "n", body: "old words" }));
    await idx.upsertNote(note({ slug: "n", body: "new words", links: ["x"] }));
    expect(await idx.search("old")).toEqual([]);
    expect((await idx.search("new")).map((r) => r.id)).toEqual(["n"]);
    expect(await idx.stats()).toMatchObject({ notes: 1 });
  });
});

// ---- links -----------------------------------------------------------------

describe("backlinks", () => {
  test("lists linking notes sorted by title", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "target", title: "Target" }));
    await idx.upsertNote(note({ slug: "z", title: "Zebra note", links: ["target", "other"] }));
    await idx.upsertNote(note({ slug: "a", title: "Apple note", links: ["target"] }));
    await idx.upsertNote(note({ slug: "u", title: "Unrelated", links: ["other"] }));

    const back = await idx.backlinks("target");
    expect(back.map((n) => n.slug)).toEqual(["a", "z"]);
    expect(back[0]).toMatchObject({ title: "Apple note", path: "notes/a.md", type: "note", tags: [] });
  });

  test("removeNote clears links, fts, and chunks", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "target" }));
    await idx.upsertNote(note({ slug: "linker", body: "unique needle", links: ["target"] }));
    expect((await idx.backlinks("target")).length).toBe(1);

    await idx.removeNote("linker");
    expect(await idx.backlinks("target")).toEqual([]);
    expect(await idx.search("needle")).toEqual([]);
    expect(await idx.stats()).toMatchObject({ notes: 1 });
    await expect(idx.removeNote("never-existed")).resolves.toBeUndefined();
  });
});

// ---- invalid ---------------------------------------------------------------

describe("invalid files", () => {
  test("recordInvalid upserts and drops a stale note at the same path", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "n", body: "was valid" }));
    await idx.recordInvalid({ path: "notes/n.md", error: "missing title" });
    await idx.recordInvalid({ path: "notes/n.md", error: "still missing title" });

    expect(await idx.invalid()).toEqual([{ path: "notes/n.md", error: "still missing title" }]);
    expect(await idx.search("valid")).toEqual([]);
    expect(await idx.stats()).toEqual({ notes: 0, files: 0, invalid: 1 });

    await idx.upsertNote(note({ slug: "n", body: "valid again" }));
    expect(await idx.invalid()).toEqual([]);
  });
});

// ---- files and rebuild -----------------------------------------------------

describe("rebuild and files", () => {
  test("rebuilds from a store with notes, an invalid file, a txt, and a garbage pdf", async () => {
    const { idx } = await makeIndex();
    const root = await tempDir();
    await fs.mkdir(path.join(root, "files"), { recursive: true });
    await fs.writeFile(path.join(root, "files", "warranty.txt"), "Warranty covers the keyboard until 2028.");
    await fs.writeFile(path.join(root, "files", "broken.pdf"), Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x42, 0x42]));

    const files: FileEntry[] = [
      { path: "files/warranty.txt", ext: "txt", sizeBytes: 40, mtimeMs: 1 },
      { path: "files/broken.pdf", ext: "pdf", sizeBytes: 6, mtimeMs: 1 },
    ];
    const store = fakeStore(
      root,
      [
        note({ slug: "one", body: "first note", links: ["two"] }),
        note({ slug: "two", body: "second note" }),
        { path: "notes/bad.md", error: "no frontmatter" },
      ],
      files,
    );

    // Pre-existing junk must be wiped by rebuild.
    await idx.upsertNote(note({ slug: "stale", body: "gone after rebuild" }));

    const stats = await idx.rebuild(store);
    expect(stats).toMatchObject({ notes: 2, files: 2, invalid: 1 });
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    expect(await idx.stats()).toEqual({ notes: 2, files: 2, invalid: 1 });
    expect(await idx.search("gone")).toEqual([]);
    expect((await idx.backlinks("two")).map((n) => n.slug)).toEqual(["one"]);
    expect(await idx.invalid()).toEqual([{ path: "notes/bad.md", error: "no frontmatter" }]);

    // txt content is searchable; the file result shape is right.
    const [txt] = await idx.search("keyboard");
    expect(txt).toMatchObject({ kind: "file", id: "files/warranty.txt", path: "files/warranty.txt", title: "warranty.txt", summary: "", tags: [] });
    expect(txt?.snippet).toContain("«keyboard»");

    // The garbage pdf did not throw and is findable by name.
    const [pdf] = await idx.search("broken");
    expect(pdf).toMatchObject({ kind: "file", id: "files/broken.pdf" });

    // includeFiles: false hides both.
    expect(await idx.search("keyboard", { includeFiles: false })).toEqual([]);
  });

  test("upsertFile replaces and removeFile deletes", async () => {
    const { idx } = await makeIndex();
    const root = await tempDir();
    const abs = path.join(root, "notes.md");
    await fs.writeFile(abs, "alpha content");
    const entry: FileEntry = { path: "files/notes.md", ext: "md", sizeBytes: 13, mtimeMs: 1 };

    await idx.upsertFile(entry, abs);
    expect((await idx.search("alpha")).map((r) => r.id)).toEqual(["files/notes.md"]);

    await fs.writeFile(abs, "beta content");
    await idx.upsertFile(entry, abs);
    expect(await idx.search("alpha")).toEqual([]);
    expect((await idx.search("beta")).map((r) => r.id)).toEqual(["files/notes.md"]);
    expect(await idx.stats()).toMatchObject({ files: 1 });

    await idx.removeFile(entry.path);
    expect(await idx.search("beta")).toEqual([]);
    expect(await idx.stats()).toMatchObject({ files: 0 });
  });

  test("unknown extensions and missing files are indexed by name only", async () => {
    const { idx } = await makeIndex();
    await idx.upsertFile({ path: "files/photo.jpg", ext: "jpg", sizeBytes: 1, mtimeMs: 1 }, "C:/does/not/exist/photo.jpg");
    await idx.upsertFile({ path: "files/missing.txt", ext: "txt", sizeBytes: 1, mtimeMs: 1 }, "C:/does/not/exist/missing.txt");
    expect((await idx.search("photo")).map((r) => r.id)).toEqual(["files/photo.jpg"]);
    expect((await idx.search("missing")).map((r) => r.id)).toEqual(["files/missing.txt"]);
  });
});

// ---- semantic and hybrid with a fake embedder -----------------------------

async function seedSemantic(idx: SearchIndex): Promise<void> {
  await idx.upsertNote(note({ slug: "fox", title: "The fox", body: "A quick brown fox jumps over the lazy dog. The fox is fast." }));
  await idx.upsertNote(note({ slug: "db", title: "SQLite notes", body: "SQLite stores an index in a single file. Vacuum reclaims space." }));
  await idx.upsertNote(note({ slug: "empty", title: "Nothing here" }));
}

for (const vec of [undefined, false] as const) {
  const label = vec === false ? "forced JS cosine path" : "default path (sqlite-vec when available)";

  describe(`semantic and hybrid search, ${label}`, () => {
    test("semantic mode ranks by best chunk similarity and uses chunk text as snippet", async () => {
      const { idx } = await makeIndex({ embeddings: true, embedder: fakeEmbedder(), vec });
      await seedSemantic(idx);
      const hits = await idx.search("fox", { mode: "semantic" });
      expect(hits[0]).toMatchObject({ kind: "note", id: "fox" });
      expect(hits[0]!.score).toBeGreaterThan(hits[1]?.score ?? -1);
      expect(hits[0]!.snippet).toContain("fox");
      for (let i = 1; i < hits.length; i++) expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    });

    test("semantic mode applies tag and type filters", async () => {
      const { idx } = await makeIndex({ embeddings: true, embedder: fakeEmbedder(), vec });
      await seedSemantic(idx);
      await idx.upsertNote(note({ slug: "fox-hub", type: "hub", tags: ["animals"], title: "Fox hub", body: "fox fox fox" }));
      expect((await idx.search("fox", { mode: "semantic", type: "hub" })).map((r) => r.id)).toEqual(["fox-hub"]);
      expect((await idx.search("fox", { mode: "semantic", tag: "animals" })).map((r) => r.id)).toEqual(["fox-hub"]);
    });

    test("hybrid fuses keyword and semantic lists; keyword snippet wins when both hit", async () => {
      const { idx } = await makeIndex({ embeddings: true, embedder: fakeEmbedder(), vec });
      await seedSemantic(idx);
      const hits = await idx.search("fox");
      expect(hits[0]).toMatchObject({ id: "fox" });
      expect(hits[0]!.snippet).toContain("«fox»");
      // RRF: an item present in both lists at rank 1 scores 2/(60+1).
      expect(hits[0]!.score).toBeCloseTo(2 / 61, 6);
    });

    test("removeNote also drops the note's vectors", async () => {
      const { idx } = await makeIndex({ embeddings: true, embedder: fakeEmbedder(), vec });
      await seedSemantic(idx);
      await idx.removeNote("fox");
      const hits = await idx.search("fox", { mode: "semantic" });
      expect(hits.map((r) => r.id)).not.toContain("fox");
    });
  });
}

test("semantic and hybrid degrade to keyword when the model is unavailable", async () => {
  const failing: Embedder = { model: "broken", dims: 8, embed: async () => null };
  const { idx } = await makeIndex({ embeddings: true, embedder: failing });
  await idx.upsertNote(note({ slug: "n", body: "keyword only content" }));
  expect((await idx.search("keyword", { mode: "semantic" })).map((r) => r.id)).toEqual(["n"]);
  expect((await idx.search("keyword", { mode: "hybrid" })).map((r) => r.id)).toEqual(["n"]);
});

// ---- pure units ------------------------------------------------------------

describe("units", () => {
  test("buildMatchExpression quotes every term and escapes inner quotes", () => {
    expect(buildMatchExpression('  foo  "bar" baz* ')).toBe('"foo" """bar""" "baz*"');
    expect(buildMatchExpression("a b", " OR ")).toBe('"a" OR "b"');
    expect(buildMatchExpression("   ")).toBe("");
  });

  test("cosineTopK ranks hand-made vectors by cosine similarity", () => {
    const rows = [
      { id: 1, vector: new Float32Array([1, 0, 0]) },
      { id: 2, vector: new Float32Array([0, 1, 0]) },
      { id: 3, vector: new Float32Array([0.7, 0.7, 0]) },
      { id: 4, vector: new Float32Array([0, 0, 0]) },
    ];
    const top = cosineTopK(new Float32Array([1, 0.1, 0]), rows, 3);
    expect(top.map((t) => t.id)).toEqual([1, 3, 2]);
    expect(top[0]!.similarity).toBeCloseTo(1 / Math.sqrt(1.01), 5);
    expect(cosineTopK(new Float32Array([1, 0, 0]), rows, 10)).toHaveLength(4);
    expect(cosineTopK(new Float32Array([1, 0, 0]), rows, 10).at(-1)).toEqual({ id: 4, similarity: 0 });
  });

  test("reciprocalRankFusion merges ranked lists with k=60", () => {
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["b", "d"],
    ]);
    expect(fused.get("a")).toBeCloseTo(1 / 61, 10);
    expect(fused.get("b")).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused.get("c")).toBeCloseTo(1 / 63, 10);
    expect(fused.get("d")).toBeCloseTo(1 / 62, 10);
    const order = [...fused.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(order).toEqual(["b", "a", "d", "c"]);
  });

  test("chunkBody merges small paragraphs and never splits inside a line", () => {
    expect(chunkBody("")).toEqual([]);
    expect(chunkBody("one\n\ntwo\n\n\n\nthree")).toEqual(["one\n\ntwo\n\nthree"]);

    const para = (n: number) => `${"p".repeat(500)}${n}`;
    const chunks = chunkBody([para(1), para(2), para(3), para(4)].join("\n\n"));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${para(1)}\n\n${para(2)}`);

    const longLine = "x".repeat(3000);
    const lines = chunkBody(`${longLine}\nshort\n${longLine}`);
    expect(lines.every((c) => c.split("\n").every((l) => l === longLine || l === "short"))).toBe(true);
    expect(lines.length).toBeGreaterThan(1);
  });
});

// ---- real model (opt-in) ---------------------------------------------------

test.skipIf(process.env.BRAIN_TEST_EMBEDDINGS !== "1")(
  "real embeddings: loads bge-small and ranks by meaning",
  async () => {
    const logs: string[] = [];
    const { idx } = await makeIndex({
      embeddings: true,
      modelCachePath: path.join(process.cwd(), ".cache", "models"),
      log: (m) => logs.push(m),
    });
    const t0 = performance.now();
    await idx.upsertNote(note({ slug: "laptop", title: "Ryzen laptop", body: "The notebook has a Ryzen 7 CPU, an RTX 4050 GPU, and 16 GB of RAM." }));
    await idx.upsertNote(note({ slug: "pasta", title: "Weeknight pasta", body: "Boil water, salt it well, cook the spaghetti for nine minutes." }));
    const indexed = performance.now() - t0;

    const t1 = performance.now();
    const hits = await idx.search("computer hardware graphics card", { mode: "semantic" });
    const searched = performance.now() - t1;

    console.log(`[real embeddings] index 2 notes: ${Math.round(indexed)} ms, semantic search: ${Math.round(searched)} ms`);
    console.log(logs.join("\n"));
    expect(hits[0]?.id).toBe("laptop");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]?.score ?? -1);
    expect(logs.some((l) => l.includes("embedding model") && l.includes("ready"))).toBe(true);
  },
  300_000,
);
