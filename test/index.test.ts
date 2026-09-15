import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { createIndex, type Embedder, type IndexOptions, type LocalSearchIndex } from "../src/core/index/index.ts";
import { chunkBody, chunkEmbeddingText } from "../src/core/index/embeddings.ts";
import { extractFileText } from "../src/core/index/extract.ts";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  buildMatchExpression,
  cosine,
  cosineTopK,
  isStopWord,
  keywordTerms,
  reciprocalRankFusion,
  SEMANTIC_FLOOR,
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

async function makeIndex(extra: Partial<IndexOptions> = {}): Promise<{ idx: LocalSearchIndex; dir: string; opts: IndexOptions }> {
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
    mentions: partial.mentions ?? [],
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

/** Cosine similarity between a query and a single-chunk note, as the index embeds them. */
async function similarity(embedder: Embedder, query: string, n: Note): Promise<number> {
  const [q, d] = (await embedder.embed([query, chunkEmbeddingText(n.title, n.body)])) ?? [];
  return cosine(q!, d!);
}

/** Run a COUNT(*) query against the index file through a second connection. */
function countRows(dbPath: string, sql: string, ...params: string[]): number {
  const db = new DatabaseSync(dbPath);
  try {
    return Number(db.prepare(sql).get(...params)?.c);
  } finally {
    db.close();
  }
}

/** A minimal but real pptx: the parts PowerPoint needs, plus the given slide/notes bodies. */
async function buildPptx(parts: { slides: Record<number, string[]>; notes: Record<number, string> }): Promise<Buffer> {
  const zip = new JSZip();
  const ns =
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const shape = (body: string): string => `<p:sp><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>`;
  const overrides: string[] = [];
  const slideIds: string[] = [];
  const presRels: string[] = [];

  for (const [key, bodies] of Object.entries(parts.slides)) {
    const n = Number(key);
    zip.file(
      `ppt/slides/slide${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${ns}><p:cSld><p:spTree>${bodies.map(shape).join("")}</p:spTree></p:cSld></p:sld>`,
    );
    overrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    slideIds.push(`<p:sldId id="${255 + n}" r:id="rId${n}"/>`);
    presRels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`);
    const notesBody = parts.notes[n];
    if (notesBody !== undefined) {
      zip.file(
        `ppt/notesSlides/notesSlide${n}.xml`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${ns}><p:cSld><p:spTree>${shape(notesBody)}</p:spTree></p:cSld></p:notes>`,
      );
      zip.file(
        `ppt/slides/_rels/slide${n}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/></Relationships>`,
      );
      overrides.push(`<Override PartName="/ppt/notesSlides/notesSlide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`);
    }
  }

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${overrides.join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${ns}><p:sldIdLst>${slideIds.join("")}</p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join("")}</Relationships>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Two sheets: a header row, a formula with a cached result, a blank row, a date; then a single sentence. */
async function buildXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const budget = wb.addWorksheet("Budget");
  budget.addRow(["Item", "Qty", "Price", "Total"]);
  budget.addRow(["Widget", 2, 3.5]);
  budget.getCell("D2").value = { formula: "B2*C2", result: 7 };
  budget.getCell("A4").value = "Ordered";
  budget.getCell("B4").value = new Date(Date.UTC(2026, 8, 14));
  wb.addWorksheet("Notes").addRow(["Remember the platypus invoice"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
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

  test("stop words are not required by AND and do not widen the OR fallback", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "prelim", title: "ITP221 schedule", body: "Prelim exams run September 22 to 26 for the first semester." }));
    await idx.upsertNote(note({ slug: "gym", title: "Gym", body: "The gym is open when it is not raining this week." }));
    await idx.upsertNote(note({ slug: "sauce", title: "Sauce", body: "Stir the sauce until it is thick." }));

    // With "when", "is", "the", and "this" kept, AND missed the right note and OR matched all three.
    expect((await idx.search("when is the prelim exam this semester", { mode: "keyword" })).map((r) => r.id)).toEqual(["prelim"]);
    expect((await idx.search("the prelim or the gym", { mode: "keyword" })).map((r) => r.id).sort()).toEqual(["gym", "prelim"]);
  });

  test("a query of only stop words searches for those words", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "riddle", title: "Riddle", body: "What is this, and who made it?" }));
    await idx.upsertNote(note({ slug: "plain", title: "Plain", body: "Nothing in common." }));
    expect((await idx.search("what is this", { mode: "keyword" })).map((r) => r.id)).toEqual(["riddle"]);
  });

  test("Tagalog stop words are dropped too", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note({ slug: "rizal-law", title: "Rizal Law", body: "Republic Act 1425 was signed by President Magsaysay in 1956." }));
    await idx.upsertNote(note({ slug: "bahay", title: "Bahay", body: "Ang bata ay kumain sa bahay kung umaga." }));
    const hits = await idx.search("sino pumirma ang Rizal Law sa", { mode: "keyword" });
    expect(hits.map((r) => r.id)).toEqual(["rizal-law"]);
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

// ---- bm25 column weights -----------------------------------------------------

/**
 * What FTS5's bm25 gives a term found once, in a column of weight `w`, in a row of average length: the term's idf
 * times w·(k1 + 1) / (w + k1), with k1 = 1.2. Dividing a score by the idf leaves this.
 */
const bm25OnceOverIdf = (w: number): number => (w * 2.2) / (w + 1.2);
const idf = (rows: number, rowsWithTerm: number): number => Math.log((rows - rowsWithTerm + 0.5) / (rowsWithTerm + 0.5));

describe("bm25 column weights", () => {
  test("a word in the title outranks the same word in the summary, tags, or body, weighted 4, 3, 2, 1", async () => {
    const { idx } = await makeIndex();
    // Every note has the same number of words in each column (title 2, summary 2, tags 1, body 2), so the only
    // difference between the four matches is the column that holds "quokka". Six notes without it keep the idf positive.
    const same = { title: "filler filler", summary: "filler filler", tags: ["filler"], body: "filler filler" };
    await idx.upsertNote(note({ slug: "in-body", ...same, body: "quokka filler" }));
    await idx.upsertNote(note({ slug: "in-tags", ...same, tags: ["quokka"] }));
    await idx.upsertNote(note({ slug: "in-summary", ...same, summary: "quokka filler" }));
    await idx.upsertNote(note({ slug: "in-title", ...same, title: "quokka filler" }));
    for (let i = 0; i < 6; i++) await idx.upsertNote(note({ slug: `other-${i}`, ...same }));

    const hits = await idx.search("quokka", { mode: "keyword" });
    expect(hits.map((h) => h.id)).toEqual(["in-title", "in-summary", "in-tags", "in-body"]);
    expect(hits.map((h) => h.score / idf(10, 4))).toEqual([4, 3, 2, 1].map((w) => expect.closeTo(bm25OnceOverIdf(w), 6)));
  });

  test("a file whose name holds the word outranks one whose text holds it, weighted 3 and 1", async () => {
    const { idx } = await makeIndex();
    const root = await tempDir();
    // Every file has two title words (name and extension) and two words of text.
    const put = async (name: string, text: string): Promise<void> => {
      const abs = path.join(root, name);
      await fs.writeFile(abs, text);
      await idx.upsertFile({ path: `files/${name}`, ext: "txt", sizeBytes: text.length, mtimeMs: 1 }, abs);
    };
    await put("filler.txt", "quokka filler");
    await put("quokka.txt", "filler filler");
    for (let i = 0; i < 6; i++) await put(`other${i}.txt`, "filler filler");

    const hits = await idx.search("quokka", { mode: "keyword" });
    expect(hits.map((h) => h.id)).toEqual(["files/quokka.txt", "files/filler.txt"]);
    expect(hits.map((h) => h.score / idf(8, 2))).toEqual([3, 1].map((w) => expect.closeTo(bm25OnceOverIdf(w), 6)));
  });
});

// ---- FTS rows ----------------------------------------------------------------

describe("FTS rows follow their note or file by rowid", () => {
  test("rewriting a note leaves one FTS row, deleting it leaves none", async () => {
    const { idx, opts } = await makeIndex();
    const ftsFor = (slug: string) => countRows(opts.dbPath, "SELECT COUNT(*) AS c FROM notes_fts WHERE slug = ?", slug);
    const aligned = () =>
      countRows(opts.dbPath, "SELECT COUNT(*) AS c FROM notes_fts f JOIN notes n ON n.id = f.rowid AND n.slug = f.slug");

    await idx.upsertNote(note({ slug: "n", body: "first draft" }));
    await idx.upsertNote(note({ slug: "other", body: "unrelated text" }));
    await idx.upsertNote(note({ slug: "n", body: "second draft" }));
    await idx.upsertNote(note({ slug: "n", body: "third draft" }));
    expect(ftsFor("n")).toBe(1);
    expect(countRows(opts.dbPath, "SELECT COUNT(*) AS c FROM notes_fts")).toBe(2);
    expect(aligned()).toBe(2);
    expect((await idx.search("draft")).map((r) => r.snippet)).toEqual(["third «draft»"]);

    await idx.removeNote("n");
    expect(ftsFor("n")).toBe(0);
    expect(aligned()).toBe(1);
    expect((await idx.search("unrelated")).map((r) => r.id)).toEqual(["other"]);

    await idx.upsertNote(note({ slug: "n", body: "back again" }));
    await idx.recordInvalid({ path: "notes/n.md", error: "broken frontmatter" });
    expect(ftsFor("n")).toBe(0);
    expect(aligned()).toBe(1);
  });

  test("rewriting a file leaves one FTS row, removing it leaves none", async () => {
    const { idx, opts } = await makeIndex();
    const root = await tempDir();
    const abs = path.join(root, "memo.txt");
    const entry: FileEntry = { path: "files/memo.txt", ext: "txt", sizeBytes: 1, mtimeMs: 1 };
    const ftsFor = (p: string) => countRows(opts.dbPath, "SELECT COUNT(*) AS c FROM files_fts WHERE path = ?", p);

    await fs.writeFile(abs, "first memo");
    await idx.upsertFile(entry, abs);
    await idx.upsertFile({ ...entry, path: "files/other.txt" }, abs);
    await fs.writeFile(abs, "second memo");
    await idx.upsertFile(entry, abs);
    expect(ftsFor("files/memo.txt")).toBe(1);
    expect(countRows(opts.dbPath, "SELECT COUNT(*) AS c FROM files_fts f JOIN files x ON x.id = f.rowid AND x.path = f.path")).toBe(2);

    await idx.removeFile(entry.path);
    expect(ftsFor("files/memo.txt")).toBe(0);
    expect((await idx.search("memo")).map((r) => r.id)).toEqual(["files/other.txt"]);
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
  test("pptx: slide text in numeric order, entities decoded, notes attached", async () => {
    const root = await tempDir();
    const abs = path.join(root, "deck.pptx");
    await fs.writeFile(abs, await buildPptx({
      slides: {
        1: ["<a:p><a:r><a:t>Quarterly </a:t></a:r><a:r><a:t>roadmap</a:t></a:r></a:p><a:p><a:r><a:t>R&amp;D &lt;budget&gt; &#8364;5k &quot;final&quot;</a:t></a:r></a:p>"],
        2: ["<a:p><a:r><a:t>Hire a zookeeper</a:t></a:r></a:p><a:p></a:p>"],
      },
      notes: {
        1: '<a:p><a:r><a:t>Speaker reminder: mention lemurs</a:t></a:r></a:p><a:p><a:fld id="{X}" type="slidenum"><a:t>1</a:t></a:fld></a:p>',
      },
    }));

    const text = await extractFileText(abs, "pptx");
    expect(text).toBe(
      [
        "## Slide 1",
        "Quarterly roadmap",
        'R&D <budget> €5k "final"',
        "Notes:",
        "Speaker reminder: mention lemurs",
        "",
        "## Slide 2",
        "Hire a zookeeper",
      ].join("\n"),
    );
  });

  test("pptx: slides sort numerically, not lexically", async () => {
    const root = await tempDir();
    const abs = path.join(root, "long.pptx");
    const slides: Record<number, string[]> = {};
    for (let n = 1; n <= 11; n++) slides[n] = [`<a:p><a:r><a:t>Page ${n}</a:t></a:r></a:p>`];
    await fs.writeFile(abs, await buildPptx({ slides, notes: {} }));

    const text = await extractFileText(abs, "pptx");
    const pages = [...text.matchAll(/^Page (\d+)$/gm)].map((m) => Number(m[1]));
    expect(pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(text).toContain("## Slide 11\nPage 11");
  });

  test("xlsx: one block per sheet, rows joined with pipes, formulas and dates rendered", async () => {
    const root = await tempDir();
    const abs = path.join(root, "book.xlsx");
    await fs.writeFile(abs, await buildXlsx());

    const text = await extractFileText(abs, "xlsx");
    expect(text).toBe(
      [
        "## Sheet: Budget",
        "Item | Qty | Price | Total",
        "Widget | 2 | 3.5 | 7",
        "Ordered | 2026-09-14",
        "",
        "## Sheet: Notes",
        "Remember the platypus invoice",
      ].join("\n"),
    );

    // Same bytes under the macro-enabled extension take the same path.
    const xlsm = path.join(root, "book.xlsm");
    await fs.copyFile(abs, xlsm);
    expect(await extractFileText(xlsm, "xlsm")).toBe(text);
  });

  test("garbage pptx and xlsx yield empty text without throwing", async () => {
    const root = await tempDir();
    const junk = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x42, 0x42, 0x50, 0x4b]);
    for (const name of ["junk.pptx", "junk.xlsx", "junk.xlsm"]) {
      const abs = path.join(root, name);
      await fs.writeFile(abs, junk);
      await expect(extractFileText(abs, path.extname(name).slice(1))).resolves.toBe("");
    }
  });

  test("slide and cell content is findable through the index", async () => {
    const { idx } = await makeIndex();
    const root = await tempDir();
    const deck = path.join(root, "deck.pptx");
    const book = path.join(root, "book.xlsx");
    await fs.writeFile(deck, await buildPptx({ slides: { 1: ["<a:p><a:r><a:t>Hire a zookeeper</a:t></a:r></a:p>"] }, notes: {} }));
    await fs.writeFile(book, await buildXlsx());

    await idx.upsertFile({ path: "files/deck.pptx", ext: "pptx", sizeBytes: 1, mtimeMs: 1 }, deck);
    await idx.upsertFile({ path: "files/book.xlsx", ext: "xlsx", sizeBytes: 1, mtimeMs: 1 }, book);

    expect((await idx.search("zookeeper")).map((r) => r.id)).toEqual(["files/deck.pptx"]);
    expect((await idx.search("platypus")).map((r) => r.id)).toEqual(["files/book.xlsx"]);
    expect(await idx.stats()).toMatchObject({ files: 2 });
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

    test("semantic mode drops notes below the similarity floor and keeps those above", async () => {
      const embedder = fakeEmbedder();
      const { idx } = await makeIndex({ embeddings: true, embedder, vec });
      const near = note({ slug: "near", title: "Fox den", body: "fox fox fox" });
      const far = note({ slug: "far", title: "Garden log", body: "A fox walked past the garden gate with seven hungry geese and one tired farmer." });
      await idx.upsertNote(near);
      await idx.upsertNote(far);
      expect(await similarity(embedder, "fox", near)).toBeGreaterThanOrEqual(SEMANTIC_FLOOR);
      expect(await similarity(embedder, "fox", far)).toBeLessThan(SEMANTIC_FLOOR);

      const hits = await idx.search("fox", { mode: "semantic" });
      expect(hits.map((r) => r.id)).toEqual(["near"]);
      expect(hits[0]!.score).toBeGreaterThanOrEqual(SEMANTIC_FLOOR);
    });

    test("hybrid leaves semantic candidates below the floor out of fusion", async () => {
      const embedder = fakeEmbedder();
      const { idx } = await makeIndex({ embeddings: true, embedder, vec });
      // "both" matches every keyword. "close" and "far" miss "zebra", so they can only arrive through semantic search.
      const both = note({ slug: "both", title: "Both", body: "The fox chased a zebra." });
      const close = note({ slug: "close", title: "Fox", body: "fox fox fox" });
      const far = note({ slug: "far", title: "Garden log", body: "A fox walked past the garden gate with seven hungry geese and one tired farmer." });
      for (const n of [both, close, far]) await idx.upsertNote(n);
      expect(await similarity(embedder, "fox zebra", close)).toBeGreaterThanOrEqual(SEMANTIC_FLOOR);
      expect(await similarity(embedder, "fox zebra", far)).toBeLessThan(SEMANTIC_FLOOR);

      const hits = await idx.search("fox zebra", { mode: "hybrid" });
      expect(hits.map((r) => r.id).sort()).toEqual(["both", "close"]);
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

// Checked against labelled queries on the owner's brain on 2026-09-15: halving an OR fallback list and cutting
// candidates to 20 did not clear the bar on held-out queries, so fusion stays as below.
describe("hybrid fusion", () => {
  test("a keyword list that fell back to OR counts in full", async () => {
    const embedder = fakeEmbedder();
    const { idx } = await makeIndex({ embeddings: true, embedder });
    const orchard = note({ slug: "orchard", title: "Apples", body: "apples kiwis kiwis apples" });
    const mango = note({ slug: "mango", title: "Mango", body: "mangoes" });
    await idx.upsertNote(orchard);
    await idx.upsertNote(mango);
    const query = "apples kiwis mangoes";

    // No note holds all three words, so only the OR step can return both; only "orchard" is a semantic match.
    expect((await idx.search(query, { mode: "keyword" })).map((r) => r.id)).toEqual(["orchard", "mango"]);
    expect(await similarity(embedder, query, orchard)).toBeGreaterThanOrEqual(SEMANTIC_FLOOR);
    expect(await similarity(embedder, query, mango)).toBeLessThan(SEMANTIC_FLOOR);

    const hits = await idx.search(query, { mode: "hybrid" });
    expect(hits.map((r) => r.id)).toEqual(["orchard", "mango"]);
    // Each list adds 1/(60 + rank): orchard is first in both, mango second in the OR list.
    expect(hits[0]!.score).toBeCloseTo(1 / 61 + 1 / 61, 10);
    expect(hits[1]!.score).toBeCloseTo(1 / 62, 10);
  });

  test("each list brings up to 50 candidates into fusion", async () => {
    const embedder = fakeEmbedder();
    const { idx } = await makeIndex({ embeddings: true, embedder });
    await idx.upsertNote(note({ slug: "zebra-den", title: "Zebra", body: "zebra zebra" }));
    for (let i = 0; i < 60; i++) {
      await idx.upsertNote(note({ slug: `zebra-${i}`, title: `Sighting ${i}`, body: "zebra stripes savanna herd grass water dust heat shade trees" }));
    }
    expect((await idx.search("zebra", { mode: "semantic", limit: 100 })).map((r) => r.id)).toEqual(["zebra-den"]);

    // 61 notes hold the word; the keyword list stops at 50, and the one semantic match is already among them.
    const hits = await idx.search("zebra", { mode: "hybrid", limit: 100 });
    expect(hits).toHaveLength(50);
    expect(hits[0]).toMatchObject({ id: "zebra-den", score: expect.closeTo(2 / 61, 10) });
  });
});

test("semantic and hybrid degrade to keyword when the model is unavailable", async () => {
  const failing: Embedder = { model: "broken", dims: 8, embed: async () => null };
  const { idx } = await makeIndex({ embeddings: true, embedder: failing });
  await idx.upsertNote(note({ slug: "n", body: "keyword only content" }));
  expect((await idx.search("keyword", { mode: "semantic" })).map((r) => r.id)).toEqual(["n"]);
  expect((await idx.search("keyword", { mode: "hybrid" })).map((r) => r.id)).toEqual(["n"]);
});

describe("warm", () => {
  test("a model that throws is swallowed and logged", async () => {
    const logs: string[] = [];
    const throwing: Embedder = {
      model: "throws",
      dims: 8,
      embed: async () => {
        throw new Error("onnxruntime binding missing");
      },
    };
    const { idx } = await makeIndex({ embeddings: true, embedder: throwing, log: (m) => logs.push(m) });
    logs.length = 0;

    await expect(idx.warm()).resolves.toBeUndefined();
    expect(logs).toEqual(["embedding warm-up failed: onnxruntime binding missing"]);
  });

  test("an unavailable model is logged", async () => {
    const logs: string[] = [];
    const { idx } = await makeIndex({ embeddings: true, embedder: { model: "none", dims: 8, embed: async () => null }, log: (m) => logs.push(m) });
    await expect(idx.warm()).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("model unavailable"))).toBe(true);
  });

  test("runs one embedding, and does nothing when embeddings are off", async () => {
    const seen: string[][] = [];
    const counting: Embedder = { ...fakeEmbedder(), embed: async (texts) => (seen.push(texts), fakeEmbedder().embed(texts)) };
    const { idx } = await makeIndex({ embeddings: true, embedder: counting });
    await idx.warm();
    expect(seen).toHaveLength(1);

    const off = await makeIndex({ embeddings: false, embedder: counting });
    await off.idx.warm();
    expect(seen).toHaveLength(1);
  });
});

// ---- pure units ------------------------------------------------------------

describe("units", () => {
  test("buildMatchExpression quotes every term and escapes inner quotes", () => {
    expect(buildMatchExpression('  foo  "bar" baz* ')).toBe('"foo" """bar""" "baz*"');
    expect(buildMatchExpression("x y", " OR ")).toBe('"x" OR "y"');
    expect(buildMatchExpression("   ")).toBe("");
  });

  test("keywordTerms drops English and Tagalog stop words, keeping all terms when nothing else is left", () => {
    expect(keywordTerms("when is the prelim exam this semester")).toEqual(["prelim", "exam", "semester"]);
    expect(keywordTerms("sino pumirma sa Rizal Law")).toEqual(["pumirma", "Rizal", "Law"]);
    expect(keywordTerms("kailan ang prelim ng ITP221")).toEqual(["prelim", "ITP221"]);
    expect(keywordTerms("what is this")).toEqual(["what", "is", "this"]);
    expect(buildMatchExpression("who is the", " OR ")).toBe('"who" OR "is" OR "the"');
    expect(buildMatchExpression("apples the bananas", " OR ")).toBe('"apples" OR "bananas"');
  });

  test("isStopWord ignores case and punctuation but keeps capitalized acronyms", () => {
    expect(isStopWord("The")).toBe(true);
    expect(isStopWord('"the"')).toBe(true);
    expect(isStopWord("this?")).toBe(true);
    expect(isStopWord("What’s")).toBe(true);
    expect(isStopWord("IT")).toBe(false);
    expect(isStopWord("US")).toBe(false);
    expect(isStopWord("it")).toBe(true);
    expect(isStopWord("prelim")).toBe(false);
    expect(isStopWord("Law")).toBe(false);
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
