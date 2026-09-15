import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore, slugify, today } from "../src/core/store/index.ts";
import { parseFrontmatter, serializeNote, SUMMARY_MAX_CHARS, validateFrontmatter } from "../src/core/store/frontmatter.ts";
import { createIndex } from "../src/core/index/index.ts";
import { BrainError, ConflictError, NotFoundError, ValidationError, type Note, type NoteStore } from "../src/core/types.ts";

const meta = { tool: "test" };

let root: string;
let store: NoteStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), `npp-store-${Math.random().toString(36).slice(2)}-`));
  store = createStore(root);
  await store.init();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
});

async function commitMessages(): Promise<string[]> {
  const log = await simpleGit({ baseDir: root }).log();
  return log.all.map((e) => e.message);
}

async function readFile(rel: string): Promise<string> {
  return fs.readFile(path.join(root, ...rel.split("/")), "utf8");
}

async function writeFile(rel: string, content: string): Promise<void> {
  const abs = path.join(root, ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

async function fileExists(rel: string): Promise<boolean> {
  return fs
    .stat(path.join(root, ...rel.split("/")))
    .then(() => true)
    .catch(() => false);
}

async function seedTags(...names: string[]): Promise<void> {
  for (const name of names) await store.createTag({ name, description: `about ${name}` }, meta);
}

describe("init", () => {
  it("works when the root folder does not exist yet", async () => {
    const fresh = path.join(root, "nested", "brain");
    const s = createStore(fresh);
    await s.init();
    expect((await fs.stat(path.join(fresh, ".git"))).isDirectory()).toBe(true);
    expect(await s.get("index")).not.toBeNull();
  });

  it("creates the layout, tags.yml, root hub and an initial commit", async () => {
    for (const d of ["notes", "sources", "files", "inbox"]) {
      expect((await fs.stat(path.join(root, d))).isDirectory()).toBe(true);
    }
    expect(await fileExists(".git")).toBe(true);
    const tags = await readFile("tags.yml");
    expect(tags.startsWith("#")).toBe(true);
    expect(tags.trimEnd().endsWith("[]")).toBe(true);
    const index = await store.get("index");
    expect(index?.type).toBe("hub");
    expect(index?.title).toBe("Index");
    expect(index?.summary).toBe("Root hub. Lists every domain hub.");
    expect(index?.tags).toEqual([]);
    expect(await commitMessages()).toEqual(["init: brain layout"]);
  });

  it("is idempotent", async () => {
    await store.write({ frontmatter: { title: "Kept", type: "note", summary: "s", tags: [] }, body: "x" }, meta);
    const before = await readFile("notes/index.md");
    await store.init();
    await store.init();
    expect(await readFile("notes/index.md")).toBe(before);
    expect(await store.get("kept")).not.toBeNull();
    expect((await commitMessages()).filter((m) => m === "init: brain layout")).toHaveLength(1);
  });
});

describe("slug helpers", () => {
  it("slugify normalizes titles", () => {
    expect(slugify("Ryzen Laptop Specs")).toBe("ryzen-laptop-specs");
    expect(slugify("  Café -- crème brûlée!  ")).toBe("cafe-creme-brulee");
    expect(slugify("C++ & Rust: 2 notes")).toBe("c-rust-2-notes");
    expect(() => slugify("!!!")).toThrow(ValidationError);
  });
});

describe("frontmatter helpers", () => {
  it("round-trips dates as strings and orders fields", () => {
    const text = serializeNote(
      {
        title: "T",
        type: "note",
        summary: "S: with colon",
        tags: ["a", "b"],
        created: "2026-09-13",
        updated: "2026-09-14",
        files: ["files/x.pdf"],
        sources: [],
      },
      "body\n",
    );
    expect(text).toMatch(/^---\ntitle: T\ntype: note\nsummary: .*\ntags: \[ ?a, b ?\]\ncreated: 2026-09-13\nupdated: 2026-09-14\nfiles: \[ ?files\/x\.pdf ?\]\n---\nbody\n$/);
    const parsed = parseFrontmatter(text);
    expect(parsed.data.created).toBe("2026-09-13");
    expect(parsed.data.updated).toBe("2026-09-14");
    expect(parsed.body).toBe("body\n");
    const fm = validateFrontmatter(parsed.data, { requireDates: true });
    expect(fm.files).toEqual(["files/x.pdf"]);
    expect(fm.sources).toBeUndefined();
  });

  it("lists every validation problem at once", () => {
    expect(() => validateFrontmatter({ title: "", type: "blog", tags: "x", created: "yesterday" })).toThrow(
      /title.*type.*summary.*tags.*created/s,
    );
  });
});

describe("write", () => {
  it("derives the slug, sets created and updated, commits", async () => {
    await seedTags("hardware");
    const note = await store.write(
      { frontmatter: { title: "Ryzen Laptop Specs", type: "note", summary: "One line.", tags: ["hardware"] }, body: "Body [[index]]\n" },
      meta,
    );
    expect(note.slug).toBe("ryzen-laptop-specs");
    expect(note.path).toBe("notes/ryzen-laptop-specs.md");
    expect(note.created).toBe(today());
    expect(note.updated).toBe(today());
    expect(note.links).toEqual(["index"]);
    expect(note.body).toBe("Body [[index]]\n");
    expect(note.mtimeMs).toBeGreaterThan(0);
    expect(await readFile("notes/ryzen-laptop-specs.md")).toBe(note.raw);
    expect((await commitMessages())[0]).toBe("test: write ryzen-laptop-specs");
  });

  it("rejects unknown tags with a clear message", async () => {
    await seedTags("known");
    await expect(
      store.write({ frontmatter: { title: "X", type: "note", summary: "s", tags: ["known", "nope", "also"] }, body: "" }, meta),
    ).rejects.toThrow("unknown tags: nope, also. Create them with createTag first.");
  });

  it("reports every problem in one error", async () => {
    let err: unknown;
    try {
      await store.write({ slug: "Bad Slug", frontmatter: { title: "", type: "note", summary: "", tags: [] }, body: "" }, meta);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    const msg = (err as Error).message;
    expect(msg).toContain("title");
    expect(msg).toContain("summary");
    expect(msg).toContain("slug");
  });

  it(`accepts a ${SUMMARY_MAX_CHARS}-character summary and rejects one character more`, async () => {
    const fits = "a".repeat(SUMMARY_MAX_CHARS);
    const note = await store.write({ slug: "fits", frontmatter: { title: "Fits", type: "note", summary: fits, tags: [] }, body: "" }, meta);
    expect(note.summary).toBe(fits);

    // Surrounding whitespace does not count.
    const padded = `  ${fits}\n`;
    await expect(
      store.write({ slug: "padded", frontmatter: { title: "Padded", type: "note", summary: padded, tags: [] }, body: "" }, meta),
    ).resolves.toMatchObject({ slug: "padded" });

    let err: unknown;
    try {
      await store.write(
        { slug: "too-long", frontmatter: { title: "Too long", type: "note", summary: `${fits}a`, tags: [] }, body: "" },
        meta,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toBe(
      `summary must be at most ${SUMMARY_MAX_CHARS} characters (got ${SUMMARY_MAX_CHARS + 1}). Name the one or two facts the note is about and leave lists of values to the body.`,
    );
    expect(await fileExists("notes/too-long.md")).toBe(false);
  });

  it("counts summary characters as code points, so an emoji is one character", async () => {
    // Each "🚀a" is 2 code points but 3 UTF-16 units.
    const fits = "🚀a".repeat(SUMMARY_MAX_CHARS / 2);
    expect(fits.length).toBe(SUMMARY_MAX_CHARS * 1.5);
    const note = await store.write({ slug: "rockets", frontmatter: { title: "Rockets", type: "note", summary: fits, tags: [] }, body: "" }, meta);
    expect(note.summary).toBe(fits);
    expect((await store.get("rockets"))?.summary).toBe(fits);

    await expect(
      store.write({ slug: "rockets", frontmatter: { title: "Rockets", type: "note", summary: `${fits}🚀`, tags: [] }, body: "" }, meta),
    ).rejects.toThrow(`summary must be at most ${SUMMARY_MAX_CHARS} characters (got ${SUMMARY_MAX_CHARS + 1})`);
  });

  it("preserves created on rewrite and always sets updated to today", async () => {
    await writeFile(
      "notes/old.md",
      "---\ntitle: Old\ntype: note\nsummary: s\ntags: []\ncreated: 2020-01-02\nupdated: 2020-01-03\n---\nold body\n",
    );
    const note = await store.write(
      { slug: "old", frontmatter: { title: "Old", type: "note", summary: "s", tags: [], updated: "1999-01-01" }, body: "new body\n" },
      meta,
    );
    expect(note.created).toBe("2020-01-02");
    expect(note.updated).toBe(today());
    expect(note.body).toBe("new body\n");
    const explicit = await store.write(
      { slug: "old", frontmatter: { title: "Old", type: "note", summary: "s", tags: [], created: "2021-05-06" }, body: "x" },
      meta,
    );
    expect(explicit.created).toBe("2021-05-06");
  });

  it("allows note <-> hub but not note <-> source for the same slug", async () => {
    await store.write({ slug: "thing", frontmatter: { title: "Thing", type: "note", summary: "s", tags: [] }, body: "" }, meta);
    const hub = await store.write({ slug: "thing", frontmatter: { title: "Thing", type: "hub", summary: "s", tags: [] }, body: "" }, meta);
    expect(hub.type).toBe("hub");
    await expect(
      store.write({ slug: "thing", frontmatter: { title: "Thing", type: "source", summary: "s", tags: [] }, body: "" }, meta),
    ).rejects.toThrow("slug thing already exists as a note; a note cannot change to/from source");
  });

  it("reserves the index slug for the root hub", async () => {
    await expect(
      store.write({ slug: "index", frontmatter: { title: "Index", type: "note", summary: "s", tags: [] }, body: "" }, meta),
    ).rejects.toThrow(ValidationError);
    const hub = await store.write({ slug: "index", frontmatter: { title: "Index", type: "hub", summary: "Root.", tags: [] }, body: "hubs\n" }, meta);
    expect(hub.body).toBe("hubs\n");
  });

  it("detects conflicts through expectedMtimeMs", async () => {
    const input = { slug: "c", frontmatter: { title: "C", type: "note" as const, summary: "s", tags: [] }, body: "1" };
    const first = await store.write(input, meta);
    const second = await store.write({ ...input, body: "2", expectedMtimeMs: first.mtimeMs }, meta);
    expect(second.body).toBe("2");
    // Touch the file behind the store's back.
    const abs = path.join(root, "notes", "c.md");
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(abs, future, future);
    await expect(store.write({ ...input, body: "3", expectedMtimeMs: second.mtimeMs }, meta)).rejects.toThrow(ConflictError);
    await expect(
      store.write({ slug: "never", frontmatter: input.frontmatter, body: "x", expectedMtimeMs: 123 }, meta),
    ).rejects.toThrow(ConflictError);
  });
});

describe("get and list", () => {
  it("get returns links, mentions, and null for missing", async () => {
    await store.write(
      { slug: "a", frontmatter: { title: "A", type: "note", summary: "s", tags: [] }, body: "[[b]] [[c|C]] [[b]] `C:\\Files\\a.pdf`" },
      meta,
    );
    const a = await store.get("a");
    expect(a?.links).toEqual(["b", "c"]);
    expect(a?.mentions).toEqual(["C:\\Files\\a.pdf"]);
    expect(a?.frontmatter.title).toBe("A");
    expect(await store.get("missing")).toBeNull();
    expect(await store.get("../etc")).toBeNull();
  });

  it("get finds sources too", async () => {
    await store.write({ slug: "src", frontmatter: { title: "Src", type: "source", summary: "s", tags: [] }, body: "raw" }, meta);
    const s = await store.get("src");
    expect(s?.path).toBe("sources/src.md");
    expect(s?.type).toBe("source");
  });

  it("list filters by tag and type, sorts by title, skips invalid files", async () => {
    await seedTags("t1", "t2");
    await store.write({ slug: "b", frontmatter: { title: "Bravo", type: "note", summary: "s", tags: ["t1"] }, body: "" }, meta);
    await store.write({ slug: "a", frontmatter: { title: "Alpha", type: "note", summary: "s", tags: ["t1", "t2"] }, body: "" }, meta);
    await store.write({ slug: "s", frontmatter: { title: "Source", type: "source", summary: "s", tags: ["t2"] }, body: "" }, meta);
    await writeFile("notes/broken.md", "no frontmatter here\n");
    const all = await store.list();
    expect(all.map((n) => n.slug)).toEqual(["a", "b", "index", "s"]);
    expect((await store.list({ tag: "t1" })).map((n) => n.slug)).toEqual(["a", "b"]);
    expect((await store.list({ type: "source" })).map((n) => n.slug)).toEqual(["s"]);
    expect((await store.list({ tag: "t2", type: "note" })).map((n) => n.slug)).toEqual(["a"]);
  });

  it("list breaks a title tie by slug, so pages of the list stay stable", async () => {
    await store.write({ slug: "twin-b", frontmatter: { title: "Twin", type: "note", summary: "s", tags: [] }, body: "" }, meta);
    await store.write({ slug: "twin-a", frontmatter: { title: "Twin", type: "note", summary: "s", tags: [] }, body: "" }, meta);
    expect((await store.list()).map((n) => n.slug)).toEqual(["index", "twin-a", "twin-b"]);
  });
});

describe("readAll", () => {
  it("yields InvalidNote for broken files and Note for good ones", async () => {
    await store.write({ slug: "good", frontmatter: { title: "Good", type: "note", summary: "s", tags: [] }, body: "" }, meta);
    await writeFile("notes/bad-yaml.md", "---\ntitle: [unclosed\n---\nbody\n");
    await writeFile("notes/missing-fields.md", "---\ntitle: Only title\n---\nbody\n");
    await writeFile("sources/wrong-type.md", "---\ntitle: W\ntype: note\nsummary: s\ntags: []\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n");
    const items = [];
    for await (const item of store.readAll()) items.push(item);
    const invalid = items.filter((i) => "error" in i).map((i) => i.path);
    const valid = items.filter((i): i is Note => !("error" in i)).map((i) => i.slug);
    expect(invalid.sort()).toEqual(["notes/bad-yaml.md", "notes/missing-fields.md", "sources/wrong-type.md"]);
    expect(valid.sort()).toEqual(["good", "index"]);
    const missing = items.find((i) => "error" in i && i.path === "notes/missing-fields.md");
    expect(missing && "error" in missing ? missing.error : "").toMatch(/type.*summary.*tags/s);
  });
});

describe("long summaries already on disk", () => {
  it("still read, list, index, and search, and check_links does not flag them", async () => {
    const summary = `Zanzibar ferry fares ${"a".repeat(479)}`;
    expect([...summary].length).toBe(500);
    await writeFile(
      "notes/ferry-fares.md",
      `---\ntitle: Ferry fares\ntype: note\nsummary: ${summary}\ntags: []\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nThe table is below.\n`,
    );

    expect((await store.get("ferry-fares"))?.summary).toBe(summary);
    expect((await store.list()).find((n) => n.slug === "ferry-fares")?.summary).toBe(summary);
    const invalid = [];
    for await (const item of store.readAll()) if ("error" in item) invalid.push(item);
    expect(invalid).toEqual([]);
    expect((await store.checkLinks()).invalidNotes).toEqual([]);

    const idx = createIndex({ dbPath: path.join(root, ".cache", "index.sqlite"), modelCachePath: path.join(root, ".cache", "models"), embeddings: false });
    await idx.open();
    try {
      expect(await idx.rebuild(store)).toMatchObject({ notes: 2, invalid: 0 });
      // "Zanzibar" appears only in the summary.
      const hits = await idx.search("Zanzibar");
      expect(hits.map((h) => h.id)).toEqual(["ferry-fares"]);
      expect(hits[0]?.summary).toBe(summary);
    } finally {
      await idx.close();
    }
  });
});

describe("rename", () => {
  it("moves the file and rewrites links and sources elsewhere", async () => {
    await store.write({ slug: "src-old", frontmatter: { title: "Src", type: "source", summary: "s", tags: [] }, body: "raw" }, meta);
    await store.write(
      { slug: "derived", frontmatter: { title: "Derived", type: "note", summary: "s", tags: [], sources: ["src-old", "other"] }, body: "from [[src-old|the source]] and [[src-old]]\n`[[src-old]]`\n" },
      meta,
    );
    await store.write({ slug: "unrelated", frontmatter: { title: "U", type: "note", summary: "s", tags: [] }, body: "[[derived]]" }, meta);
    const unrelatedBefore = await readFile("notes/unrelated.md");
    await writeFile(
      "notes/derived.md",
      (await readFile("notes/derived.md")).replace(`updated: ${today()}`, "updated: 2020-02-02"),
    );

    const result = await store.rename("src-old", "src-new", meta);
    expect(result.note.slug).toBe("src-new");
    expect(result.note.path).toBe("sources/src-new.md");
    expect(result.note.updated).toBe(today());
    expect(result.rewritten).toEqual(["derived"]);
    expect(await fileExists("sources/src-old.md")).toBe(false);

    const derived = await store.get("derived");
    expect(derived?.body).toBe("from [[src-new|the source]] and [[src-new]]\n`[[src-old]]`\n");
    expect(derived?.frontmatter.sources).toEqual(["src-new", "other"]);
    expect(derived?.updated).toBe("2020-02-02");
    expect(await readFile("notes/unrelated.md")).toBe(unrelatedBefore);
    expect((await commitMessages())[0]).toBe("test: rename src-old -> src-new");
  });

  it("validates slugs and existence", async () => {
    await store.write({ slug: "a", frontmatter: { title: "A", type: "note", summary: "s", tags: [] }, body: "" }, meta);
    await store.write({ slug: "b", frontmatter: { title: "B", type: "note", summary: "s", tags: [] }, body: "" }, meta);
    await expect(store.rename("a", "Bad!", meta)).rejects.toThrow(ValidationError);
    await expect(store.rename("a", "b", meta)).rejects.toThrow(ValidationError);
    await expect(store.rename("nope", "c", meta)).rejects.toThrow(NotFoundError);
    await expect(store.rename("index", "c", meta)).rejects.toThrow(ValidationError);
  });
});

describe("delete", () => {
  it("removes the file and commits; refuses index and missing", async () => {
    await store.write({ slug: "gone", frontmatter: { title: "G", type: "note", summary: "s", tags: [] }, body: "" }, meta);
    await store.delete("gone", meta);
    expect(await fileExists("notes/gone.md")).toBe(false);
    expect(await store.get("gone")).toBeNull();
    expect((await commitMessages())[0]).toBe("test: delete gone");
    await expect(store.delete("gone", meta)).rejects.toThrow(NotFoundError);
    await expect(store.delete("index", meta)).rejects.toThrow(ValidationError);
  });
});

describe("tags", () => {
  it("round-trips through tags.yml, sorted, with duplicates rejected", async () => {
    expect(await store.tags()).toEqual([]);
    await store.createTag({ name: "zeta", description: "last" }, meta);
    const created = await store.createTag({ name: "alpha", description: "first: colon" }, meta);
    expect(created).toEqual({ name: "alpha", description: "first: colon" });
    expect(await store.tags()).toEqual([
      { name: "alpha", description: "first: colon" },
      { name: "zeta", description: "last" },
    ]);
    const yml = await readFile("tags.yml");
    expect(yml.startsWith("#")).toBe(true);
    expect(yml).toContain("- name: alpha\n  description:");
    await expect(store.createTag({ name: "alpha", description: "again" }, meta)).rejects.toThrow(ValidationError);
    await expect(store.createTag({ name: "Not Valid", description: "" }, meta)).rejects.toThrow(ValidationError);
    expect((await commitMessages()).slice(0, 2)).toEqual(["test: create tag alpha", "test: create tag zeta"]);
  });
});

describe("inbox", () => {
  it("lists items recursively with text detection", async () => {
    await writeFile("inbox/a.md", "hello");
    await writeFile("inbox/sub/b.pdf", "%PDF");
    await writeFile("inbox/noext-text", "plain words");
    await writeFile("inbox/noext-bin", Buffer.from([1, 0, 2, 3]).toString("latin1"));
    const items = await store.inboxList();
    expect(items.map((i) => [i.name, i.isText])).toEqual([
      ["a.md", true],
      ["noext-bin", false],
      ["noext-text", true],
      ["sub/b.pdf", false],
    ]);
    expect(items[0]?.path).toBe("inbox/a.md");
    expect(items[0]?.sizeBytes).toBe(5);
  });

  it("takes a text item into sources/ verbatim", async () => {
    const original = "---\nfake: frontmatter\n---\n\n  Transcript line one.\r\nLine two with [[link]] and `code`\n\n\ttrailing tab\n\n\n";
    await writeFile("inbox/My Talk.txt", original);
    const result = await store.inboxTake("My Talk.txt", {}, meta);
    expect(result.kind).toBe("source");
    const note = result.note!;
    expect(note.slug).toBe("my-talk");
    expect(note.title).toBe("My Talk");
    expect(note.type).toBe("source");
    expect(note.summary).toBe("Unprocessed source. Read it and update this summary.");
    expect(note.tags).toEqual([]);
    expect(note.created).toBe(today());
    expect(note.body).toBe(original);
    expect(await readFile("sources/my-talk.md")).toBe(note.raw);
    expect(note.raw.endsWith(original)).toBe(true);
    expect(await fileExists("inbox/My Talk.txt")).toBe(false);
    expect((await commitMessages())[0]).toBe("test: take inbox My Talk.txt -> my-talk");
  });

  it("honours title, slug and summary options and rejects clashes", async () => {
    await writeFile("inbox/x.md", "x");
    await writeFile("inbox/y.md", "y");
    const r = await store.inboxTake("x.md", { title: "Custom", slug: "custom-slug", summary: "Summed." }, meta);
    expect(r.note?.title).toBe("Custom");
    expect(r.note?.slug).toBe("custom-slug");
    expect(r.note?.summary).toBe("Summed.");
    await expect(store.inboxTake("y.md", { slug: "custom-slug" }, meta)).rejects.toThrow(ValidationError);
    await expect(store.inboxTake("missing.md", {}, meta)).rejects.toThrow(NotFoundError);
    await expect(store.inboxTake("../tags.yml", {}, meta)).rejects.toThrow(ValidationError);
  });

  it(`rejects a summary longer than ${SUMMARY_MAX_CHARS} characters and leaves the item in the inbox`, async () => {
    await writeFile("inbox/long.md", "material");
    const before = (await commitMessages()).length;
    await expect(
      store.inboxTake("long.md", { title: "Long", summary: "x".repeat(SUMMARY_MAX_CHARS + 1) }, meta),
    ).rejects.toThrow(
      `summary must be at most ${SUMMARY_MAX_CHARS} characters (got ${SUMMARY_MAX_CHARS + 1}). Name the one or two facts the note is about and leave lists of values to the body.`,
    );
    expect(await fileExists("inbox/long.md")).toBe(true);
    expect(await fileExists("sources/long.md")).toBe(false);
    expect((await commitMessages()).length).toBe(before);
  });

  it("moves binary items into files/ with numeric suffixes on clash", async () => {
    await writeFile("files/scan.pdf", "existing");
    await writeFile("inbox/nested/scan.pdf", "one");
    await writeFile("inbox/scan.pdf", "two");
    const first = await store.inboxTake("nested/scan.pdf", {}, meta);
    expect(first).toEqual({ kind: "file", filePath: "files/scan-1.pdf" });
    const second = await store.inboxTake("scan.pdf", {}, meta);
    expect(second.filePath).toBe("files/scan-2.pdf");
    expect(await readFile("files/scan-1.pdf")).toBe("one");
    expect(await readFile("files/scan-2.pdf")).toBe("two");
    expect(await fileExists("inbox/scan.pdf")).toBe(false);
    expect((await commitMessages()).slice(0, 2)).toEqual([
      "test: take inbox scan.pdf -> files/scan-2.pdf",
      "test: take inbox nested/scan.pdf -> files/scan-1.pdf",
    ]);
    const files = await store.files();
    expect(files.map((f) => f.path)).toEqual(["files/scan-1.pdf", "files/scan-2.pdf", "files/scan.pdf"]);
    expect(files[0]?.ext).toBe("pdf");
    expect(files[0]?.sizeBytes).toBe(3);
  });

  it("inboxAdd sanitizes names, adds .md, avoids clashes, does not commit", async () => {
    const before = (await commitMessages()).length;
    const a = await store.inboxAdd("../../etc/pass wd?.txt", "one");
    expect(a.name).toBe("pass-wd-.txt");
    expect(a.isText).toBe(true);
    const b = await store.inboxAdd("plain note", "two");
    expect(b.name).toBe("plain-note.md");
    const c = await store.inboxAdd("plain note", "three");
    expect(c.name).toBe("plain-note-1.md");
    const d = await store.inboxAdd("...", "four");
    expect(d.name).toBe("untitled.md");
    expect(await readFile("inbox/plain-note-1.md")).toBe("three");
    expect((await commitMessages()).length).toBe(before);
  });
});

describe("resolve", () => {
  it("returns absolute paths inside the root and rejects escapes", () => {
    const abs = store.resolve("notes/a.md");
    expect(path.isAbsolute(abs)).toBe(true);
    expect(abs.toLowerCase().startsWith(root.toLowerCase())).toBe(true);
    expect(store.resolve("")).toBe(path.resolve(root));
    expect(() => store.resolve("../outside.md")).toThrow("path escapes brain root");
    expect(() => store.resolve("notes/../../x")).toThrow(ValidationError);
    expect(() => store.resolve(path.join(root, "notes", "a.md"))).toThrow(ValidationError);
    expect(() => store.resolve("C:/Windows/system32")).toThrow(ValidationError);
    expect(() => store.resolve("/abs")).toThrow(ValidationError);
  });
});

describe("checkLinks", () => {
  it("reports broken links, missing files, missing sources and invalid notes", async () => {
    await writeFile("files/present.pdf", "x");
    await store.write({ slug: "real-src", frontmatter: { title: "R", type: "source", summary: "s", tags: [] }, body: "" }, meta);
    await store.write(
      {
        slug: "n",
        frontmatter: { title: "N", type: "note", summary: "s", tags: [], sources: ["real-src", "ghost-src"], files: ["files/present.pdf", "files/absent.pdf"] },
        body: "[[real-src]] [[nowhere]] [[index]]",
      },
      meta,
    );
    await writeFile("notes/junk.md", "---\ntitle: J\n---\n");
    const report = await store.checkLinks();
    expect(report.brokenLinks).toEqual([{ from: "n", to: "nowhere" }]);
    expect(report.missingFiles).toEqual([{ from: "n", file: "files/absent.pdf" }]);
    expect(report.missingSources).toEqual([{ from: "n", source: "ghost-src" }]);
    expect(report.invalidNotes.map((i) => i.path)).toEqual(["notes/junk.md"]);
  });
});

describe("git", () => {
  it("records one commit per write in the expected format", async () => {
    await store.createTag({ name: "t", description: "" }, meta);
    await store.write({ slug: "w", frontmatter: { title: "W", type: "note", summary: "s", tags: ["t"] }, body: "" }, { tool: "mcp" });
    await store.rename("w", "w2", { tool: "api" });
    await store.delete("w2", { tool: "cli" });
    expect(await commitMessages()).toEqual([
      "cli: delete w2",
      "api: rename w -> w2",
      "mcp: write w",
      "test: create tag t",
      "init: brain layout",
    ]);
    const status = await simpleGit({ baseDir: root }).status();
    expect(status.isClean()).toBe(true);
  });

  it("serializes concurrent writes without losing commits", async () => {
    const writes = ["p", "q", "r", "s"].map((slug) =>
      store.write({ slug, frontmatter: { title: slug.toUpperCase(), type: "note", summary: "s", tags: [] }, body: "" }, meta),
    );
    const notes = await Promise.all(writes);
    expect(notes.map((n) => n.slug)).toEqual(["p", "q", "r", "s"]);
    const messages = await commitMessages();
    for (const slug of ["p", "q", "r", "s"]) expect(messages).toContain(`test: write ${slug}`);
    expect(messages).toHaveLength(5);
  });

  it("wraps io failures as BrainError(500, io)", async () => {
    await fs.rm(path.join(root, "notes"), { recursive: true, force: true });
    let err: unknown;
    try {
      await store.write({ slug: "x", frontmatter: { title: "X", type: "note", summary: "s", tags: [] }, body: "" }, meta);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BrainError);
    expect((err as BrainError).status).toBe(500);
    expect((err as BrainError).code).toBe("io");
  });
});
