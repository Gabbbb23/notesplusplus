import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BrainImpl } from "../src/core/brain.ts";
import { createIndex } from "../src/core/index/index.ts";
import { createStore, serializeNote } from "../src/core/store/index.ts";
import {
  ValidationError,
  type Brain,
  type FileEntry,
  type InvalidNote,
  type Note,
  type NoteStore,
  type SearchIndex,
  type SearchOptions,
} from "../src/core/types.ts";
import { TempBrain } from "./helpers/temp-brain.ts";

// BrainImpl's job is keeping the index in step with the store. These tests cross the Brain interface only, on a real
// store and index, and check what a caller would see: search, backlinks, and stats. Notes that only set the scene go
// on disk through writeNotes (which reindexes); the write under test always goes through the brain.

const meta = { tool: "test" };

const note = (slug: string, title: string, body: string) => ({ slug, frontmatter: { title, type: "note" as const, summary: "s", tags: [] }, body });
const ids = (results: Array<{ id: string }>) => results.map((r) => r.id);
const slugs = (notes: Array<{ slug: string }>) => notes.map((n) => n.slug);

describe("BrainImpl keeps the index in step with every write", () => {
  // Each test uses its own slugs and words, so they share one brain.
  let tb: TempBrain;
  let brain: Brain;

  beforeAll(async () => {
    tb = await TempBrain.create();
    brain = tb.brain;
  });

  afterAll(async () => {
    await tb.dispose();
  });

  it("a write reaches search, backlinks, and stats, and a rewrite replaces what they report", async () => {
    const before = await brain.stats();
    await brain.write(note("aardvark", "Aardvark", "Aardvarks eat termites."), meta);
    await brain.write(note("burrow", "Burrow", "Dug by [[aardvark]] at night."), meta);

    expect(ids(await brain.search("termites"))).toEqual(["aardvark"]);
    expect(slugs(await brain.backlinks("aardvark"))).toEqual(["burrow"]);
    expect(await brain.stats()).toEqual({ ...before, notes: before.notes + 2 });

    await brain.write(note("burrow", "Burrow", "A den in the ground."), meta);
    expect(await brain.search("night")).toEqual([]);
    expect(ids(await brain.search("den"))).toEqual(["burrow"]);
    expect(await brain.backlinks("aardvark")).toEqual([]);
    expect(await brain.stats()).toEqual({ ...before, notes: before.notes + 2 });
  });

  it("rename rewrites links, moves backlinks and search to the new slug, and keeps the note's own links", async () => {
    await tb.writeNotes([
      note("giraffe-family", "Giraffe family", "Giraffids."),
      note("okapi", "Okapi", "Lives in the Ituri forest. Kin: [[giraffe-family]]."),
      note("zoo-list", "Zoo list", "Animals: [[okapi|the okapi]]."),
    ]);
    expect(slugs(await brain.backlinks("okapi"))).toEqual(["zoo-list"]);

    const result = await brain.rename("okapi", "forest-giraffe", meta);
    expect(result.note.slug).toBe("forest-giraffe");
    expect(result.rewritten).toEqual(["zoo-list"]);
    expect((await brain.get("zoo-list"))?.body).toContain("[[forest-giraffe|the okapi]]");

    expect(ids(await brain.search("ituri"))).toEqual(["forest-giraffe"]);
    expect(await brain.backlinks("okapi")).toEqual([]);
    expect(slugs(await brain.backlinks("forest-giraffe"))).toEqual(["zoo-list"]);
    expect(slugs(await brain.backlinks("giraffe-family"))).toEqual(["forest-giraffe"]);
  });

  it("delete removes the note from search, backlinks, and stats", async () => {
    await tb.writeNotes([note("kangaroo-kin", "Kangaroo kin", "Marsupials."), note("quokka", "Quokka", "Quokkas smile. See [[kangaroo-kin]].")]);
    const before = await brain.stats();
    expect(ids(await brain.search("smile"))).toEqual(["quokka"]);
    expect(slugs(await brain.backlinks("kangaroo-kin"))).toEqual(["quokka"]);

    await brain.delete("quokka", meta);
    expect(await brain.search("smile")).toEqual([]);
    expect(await brain.backlinks("kangaroo-kin")).toEqual([]);
    expect(await brain.stats()).toEqual({ ...before, notes: before.notes - 1 });
  });

  it("inboxTake indexes a text item as a source note and any other item as a file", async () => {
    const before = await brain.stats();

    await brain.inboxAdd("zeppelin.txt", "Zeppelins float on hydrogen.");
    const text = await brain.inboxTake("zeppelin.txt", { title: "Zeppelin talk", summary: "A talk about airships." }, meta);
    expect(text).toMatchObject({ kind: "source", note: { slug: "zeppelin-talk" } });
    expect(await brain.search("hydrogen")).toEqual([expect.objectContaining({ kind: "note", id: "zeppelin-talk", type: "source" })]);

    await tb.addFile("inbox/blimp-photo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
    const file = await brain.inboxTake("blimp-photo.png", {}, meta);
    expect(file).toEqual({ kind: "file", filePath: "files/blimp-photo.png" });
    expect(await brain.search("blimp")).toEqual([expect.objectContaining({ kind: "file", id: "files/blimp-photo.png" })]);

    expect(await brain.stats()).toEqual({ notes: before.notes + 1, files: before.files + 1, invalid: before.invalid });
  });
});

/** A second SearchIndex adapter: the real index, except that updates throw while `failing` is true. */
class FlakyIndex implements SearchIndex {
  failing = false;

  constructor(private readonly inner: SearchIndex) {}

  private check(): void {
    if (this.failing) throw new Error("database is locked");
  }

  open(): Promise<void> {
    return this.inner.open();
  }
  close(): Promise<void> {
    return this.inner.close();
  }
  rebuild(store: NoteStore) {
    return this.inner.rebuild(store);
  }
  async upsertNote(n: Note): Promise<void> {
    this.check();
    return this.inner.upsertNote(n);
  }
  async removeNote(slug: string): Promise<void> {
    this.check();
    return this.inner.removeNote(slug);
  }
  async upsertFile(file: FileEntry, absolutePath: string): Promise<void> {
    this.check();
    return this.inner.upsertFile(file, absolutePath);
  }
  async removeFile(filePath: string): Promise<void> {
    this.check();
    return this.inner.removeFile(filePath);
  }
  recordInvalid(invalid: InvalidNote): Promise<void> {
    return this.inner.recordInvalid(invalid);
  }
  search(query: string, opts?: SearchOptions) {
    return this.inner.search(query, opts);
  }
  backlinks(slug: string) {
    return this.inner.backlinks(slug);
  }
  invalid() {
    return this.inner.invalid();
  }
  stats() {
    return this.inner.stats();
  }
}

describe("BrainImpl when the index fails during a write", () => {
  let tb: TempBrain;
  let brain: Brain;
  let flaky: FlakyIndex;
  const logs: string[] = [];

  beforeAll(async () => {
    tb = await TempBrain.create({ wrapIndex: (index) => (flaky = new FlakyIndex(index)), log: (m) => logs.push(m) });
    brain = tb.brain;
  });

  afterEach(() => {
    flaky.failing = false;
    logs.length = 0;
  });

  afterAll(async () => {
    await tb.dispose();
  });

  it("keeps the write, logs the missed update, and reindex repairs the index", async () => {
    flaky.failing = true;
    const written = await brain.write(note("walrus", "Walrus", "Walruses haul out on ice. See [[index]]."), meta);

    expect(written.slug).toBe("walrus");
    expect((await brain.get("walrus"))?.body).toBe("Walruses haul out on ice. See [[index]].");
    expect((await tb.commits())[0]).toBe("test: write walrus");
    expect(logs).toEqual(["index update failed (upsert walrus): database is locked. Run reindex."]);
    expect(await brain.search("walruses")).toEqual([]);
    expect(await brain.backlinks("index")).toEqual([]);

    flaky.failing = false;
    await brain.reindex();
    expect(ids(await brain.search("walruses"))).toEqual(["walrus"]);
    expect(slugs(await brain.backlinks("index"))).toEqual(["walrus"]);
  });

  it("keeps a rename, a delete, and an inbox take the same way", async () => {
    await tb.writeNotes([note("narwhal", "Narwhal", "Narwhals have tusks."), note("beluga", "Beluga", "Belugas sing.")]);
    await brain.inboxAdd("orca.txt", "Orcas hunt in pods.");

    flaky.failing = true;
    await brain.rename("narwhal", "sea-unicorn", meta);
    await brain.delete("beluga", meta);
    await brain.inboxTake("orca.txt", { title: "Orca notes", summary: "Notes on orcas." }, meta);

    const exists = async (slug: string) => (await brain.get(slug)) !== null;
    expect([await exists("narwhal"), await exists("sea-unicorn"), await exists("beluga"), await exists("orca-notes")]).toEqual([false, true, false, true]);
    expect(logs).toEqual([
      "index update failed (rename narwhal -> sea-unicorn): database is locked. Run reindex.",
      "index update failed (remove beluga): database is locked. Run reindex.",
      "index update failed (upsert source orca-notes): database is locked. Run reindex.",
    ]);
    // Until a reindex, the index still answers with what it held before the failed updates.
    expect(ids(await brain.search("tusks"))).toEqual(["narwhal"]);
    expect(ids(await brain.search("sing"))).toEqual(["beluga"]);
    expect(await brain.search("pods")).toEqual([]);

    flaky.failing = false;
    await brain.reindex();
    expect(ids(await brain.search("tusks"))).toEqual(["sea-unicorn"]);
    expect(await brain.search("sing")).toEqual([]);
    expect(ids(await brain.search("pods"))).toEqual(["orca-notes"]);
  });
});

describe("BrainImpl init, close, root, and resolve", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "npp-brain-init-"));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  const open = (root: string, dbName: string, log: (m: string) => void = () => {}) =>
    new BrainImpl(
      createStore(root),
      createIndex({ dbPath: path.join(dir, dbName), modelCachePath: path.join(dir, "models"), embeddings: false }),
      log,
    );

  it("init builds the index when it is empty and leaves an index that holds notes alone", async () => {
    const root = path.join(dir, "brain");

    // No brain on disk yet: init creates it with the root hub, finds the index empty, and builds it.
    const first = open(root, "index.sqlite");
    expect(await first.init()).toEqual({ notes: 1, files: 0, invalid: 0, durationMs: expect.any(Number) });
    expect(ids(await first.search("hub"))).toEqual(["index"]);
    await first.write(note("pangolin", "Pangolin", "Pangolins roll into a ball."), meta);
    await first.close();

    // A note that reaches the disk without the brain, while it is closed.
    const stray = serializeNote({ title: "Armadillo", type: "note", summary: "s", tags: [], created: "2026-09-01", updated: "2026-09-01" }, "Armadillos dig.");
    await fs.writeFile(path.join(root, "notes", "armadillo.md"), stray);

    // The same index already holds notes, so init does not rebuild it and the stray note stays unindexed.
    const again = open(root, "index.sqlite");
    expect(await again.init()).toBeNull();
    expect(ids(await again.search("pangolins"))).toEqual(["pangolin"]);
    expect(await again.search("armadillos")).toEqual([]);
    await again.close();

    // A new, empty index over the same brain is built from everything on disk.
    const fresh = open(root, "fresh.sqlite");
    expect(await fresh.init()).toEqual({ notes: 3, files: 0, invalid: 0, durationMs: expect.any(Number) });
    expect(ids(await fresh.search("armadillos"))).toEqual(["armadillo"]);
    await fresh.close();
  });

  it("close releases the index: reads fail and writes log until init opens it again", async () => {
    const logs: string[] = [];
    const brain = open(path.join(dir, "closing"), "closing.sqlite", (m) => logs.push(m));
    await brain.init();
    await brain.close();

    await expect(brain.stats()).rejects.toThrow("search index is not open");
    await brain.write(note("gecko", "Gecko", "Geckos climb glass."), meta);
    expect(await brain.get("gecko")).not.toBeNull();
    expect(logs).toEqual(["index update failed (upsert gecko): search index is not open: call open() first. Run reindex."]);

    // The index is not empty, so init does not rebuild; reindex picks up the write it missed.
    expect(await brain.init()).toBeNull();
    expect(await brain.search("geckos")).toEqual([]);
    await brain.reindex();
    expect(ids(await brain.search("geckos"))).toEqual(["gecko"]);
    await brain.close();
  });

  it("root is the absolute brain path, and resolve refuses paths outside it", () => {
    const root = path.join(dir, "paths");
    const brain = open(root, "paths.sqlite");
    expect(brain.root).toBe(path.resolve(root));
    expect(brain.resolve("files/college/Module 1.pdf")).toBe(path.join(root, "files", "college", "Module 1.pdf"));
    for (const bad of ["../outside.txt", "files/../../outside.txt", path.join(root, "files", "a.pdf"), "C:\\Windows\\win.ini"]) {
      expect(() => brain.resolve(bad), bad).toThrow(ValidationError);
    }
  });
});
