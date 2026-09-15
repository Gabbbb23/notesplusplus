import { renameSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { BrainImpl } from "../src/core/brain.ts";
import { buildingPath, createIndex, type Embedder, type IndexOptions, type LocalSearchIndex } from "../src/core/index/index.ts";
import { createStore } from "../src/core/store/index.ts";
import type { InvalidNote, Note, NoteStore } from "../src/core/types.ts";

// A rebuild fills a new SQLite file and swaps it in. These tests run real SQLite in temp folders, with embeddings off
// or a fake embedder, and check what a caller sees before, during, and after the swap, plus what is left on disk.

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "npp-rebuild-"));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

async function makeIndex(extra: Partial<IndexOptions> = {}): Promise<{ idx: LocalSearchIndex; dbPath: string; logs: string[] }> {
  const dir = await tempDir();
  const logs: string[] = [];
  const dbPath = path.join(dir, "cache", "index.sqlite");
  const idx = createIndex({ dbPath, modelCachePath: path.join(dir, "models"), embeddings: false, log: (m) => logs.push(m), ...extra });
  await idx.open();
  cleanups.push(() => idx.close());
  return { idx, dbPath, logs };
}

function note(slug: string, body: string): Note {
  const frontmatter = { title: slug, type: "note" as const, summary: `Summary of ${slug}`, tags: [], created: "2026-09-15", updated: "2026-09-15" };
  return { ...frontmatter, slug, path: `notes/${slug}.md`, frontmatter, body, raw: body, links: [], mentions: [], mtimeMs: 1 };
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * A store double for rebuild: notes by slug, a readAll that can stop after its first note until resumed, and get()
 * for the replay. `notes` may change while a rebuild runs, as the store on disk would.
 */
function pausingStore(notes: Map<string, Note>, opts: { fail?: Error } = {}) {
  const paused = deferred();
  const resume = deferred();
  const store = {
    root: "",
    async *readAll(): AsyncIterable<Note | InvalidNote> {
      let first = true;
      for (const n of [...notes.values()]) {
        yield n;
        if (first) {
          first = false;
          paused.resolve();
          await resume.promise;
          if (opts.fail) throw opts.fail;
        }
      }
    },
    get: async (slug: string) => notes.get(slug) ?? null,
    files: async () => [],
    resolve: (rel: string) => rel,
  };
  return { store: store as unknown as NoteStore, paused: paused.promise, resume: resume.resolve };
}

const ids = (results: Array<{ id: string }>) => results.map((r) => r.id).sort();

/** Files in the index folder, sorted. */
const folder = async (dbPath: string) => (await fs.readdir(path.dirname(dbPath))).sort();

/** The index file and the WAL pair of its open connection; nothing else belongs in the folder. */
const expectOnlyIndexFiles = async (dbPath: string) => {
  const files = await folder(dbPath);
  expect(files).toContain("index.sqlite");
  expect(files.every((f) => ["index.sqlite", "index.sqlite-wal", "index.sqlite-shm"].includes(f)), files.join(", ")).toBe(true);
};

/** Deterministic offline embedder: hashed bag of words, normalized. */
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
          v[h % dims] = (v[h % dims] ?? 0) + 1;
        }
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        return v.map((x) => x / norm);
      });
    },
  };
}

describe("rebuild into a new file", () => {
  test("searches during a rebuild see the whole old index, and the whole new one after the swap", async () => {
    const { idx, dbPath } = await makeIndex({ embeddings: true, embedder: fakeEmbedder() });
    await idx.upsertNote(note("walrus-tusks", "walrus tusks"));
    await idx.upsertNote(note("walrus-colony", "walrus colony"));

    const next = new Map([
      ["narwhal-tusk", note("narwhal-tusk", "narwhal tusk")],
      ["narwhal-pod", note("narwhal-pod", "narwhal pod")],
    ]);
    const { store, paused, resume } = pausingStore(next);
    const rebuilt = idx.rebuild(store);
    await paused;

    // The new file already holds the first narwhal, but nothing reads from it yet.
    expect(await folder(dbPath)).toContain("index.sqlite.building");
    for (const mode of ["keyword", "semantic", "hybrid"] as const) {
      expect(ids(await idx.search("walrus", { mode })), mode).toEqual(["walrus-colony", "walrus-tusks"]);
      expect(await idx.search("narwhal", { mode: "keyword" }), mode).toEqual([]);
    }
    expect(await idx.stats()).toEqual({ notes: 2, files: 0, invalid: 0 });

    resume();
    expect(await rebuilt).toEqual({ notes: 2, files: 0, invalid: 0, durationMs: expect.any(Number) });
    for (const mode of ["keyword", "semantic", "hybrid"] as const) {
      expect(ids(await idx.search("narwhal", { mode })), mode).toEqual(["narwhal-pod", "narwhal-tusk"]);
      expect(await idx.search("walrus", { mode: "keyword" }), mode).toEqual([]);
    }
    await expectOnlyIndexFiles(dbPath);
  });

  test("searches running throughout a rebuild never fail and never see a partial index", async () => {
    const { idx } = await makeIndex();
    const before = Array.from({ length: 20 }, (_, i) => note(`old-${String(i).padStart(2, "0")}`, "shared word old"));
    const after = Array.from({ length: 20 }, (_, i) => note(`new-${String(i).padStart(2, "0")}`, "shared word new"));
    for (const n of before) await idx.upsertNote(n);

    // A store that yields slowly, so the rebuild spans many turns of the event loop.
    const slow = {
      async *readAll() {
        for (const n of after) {
          await new Promise((r) => setTimeout(r, 2));
          yield n;
        }
      },
      files: async () => [],
      resolve: (rel: string) => rel,
    } as unknown as NoteStore;

    const oldIds = JSON.stringify(before.map((n) => n.slug));
    const newIds = JSON.stringify(after.map((n) => n.slug));
    const classify = (found: string[]) => (JSON.stringify(found) === oldIds ? "old" : JSON.stringify(found) === newIds ? "new" : found.join(","));

    let done = false;
    const rebuilt = idx.rebuild(slow).finally(() => (done = true));
    const seen = new Set<string>();
    let searches = 0;
    while (!done) {
      seen.add(classify(ids(await idx.search("shared", { limit: 100 }))));
      searches++;
      await new Promise((r) => setImmediate(r));
    }
    await rebuilt;
    seen.add(classify(ids(await idx.search("shared", { limit: 100 }))));

    expect(searches).toBeGreaterThan(10);
    expect([...seen].sort()).toEqual(["new", "old"]);
  });

  test("writes during a rebuild still reach the old index and are replayed onto the new one", async () => {
    const { idx } = await makeIndex();
    await idx.upsertNote(note("before", "otter holt"));

    const notes = new Map([
      ["alpha", note("alpha", "first draft")],
      ["beta", note("beta", "badger sett")],
    ]);
    const { store, paused, resume } = pausingStore(notes);
    const rebuilt = idx.rebuild(store);
    await paused;

    // The store changes while the build runs: a new note, a rewrite of a note the build already read, and a delete.
    const added = note("gamma", "heron nest");
    notes.set("gamma", added);
    await idx.upsertNote(added);
    const rewritten = note("alpha", "second draft");
    notes.set("alpha", rewritten);
    await idx.upsertNote(rewritten);
    notes.delete("beta");
    await idx.removeNote("beta");

    // Until the swap, the writes show in the old index.
    expect(ids(await idx.search("heron"))).toEqual(["gamma"]);
    expect(ids(await idx.search("otter"))).toEqual(["before"]);

    resume();
    expect(await rebuilt).toMatchObject({ notes: 2 });
    expect(ids(await idx.search("heron"))).toEqual(["gamma"]);
    expect(ids(await idx.search("second"))).toEqual(["alpha"]);
    expect(await idx.search("first")).toEqual([]);
    expect(await idx.search("badger")).toEqual([]);
    expect(await idx.search("otter")).toEqual([]);
  });

  test("a failing rebuild leaves the old index searchable and removes the partial file", async () => {
    const { idx, dbPath } = await makeIndex();
    await idx.upsertNote(note("kept", "lynx den"));

    const { store, paused, resume } = pausingStore(new Map([["lost", note("lost", "puma cave")]]), { fail: new Error("disk unplugged") });
    const rebuilt = idx.rebuild(store);
    await paused;
    expect(await folder(dbPath)).toContain("index.sqlite.building");
    resume();

    await expect(rebuilt).rejects.toThrow("disk unplugged");
    expect(ids(await idx.search("lynx"))).toEqual(["kept"]);
    expect(await idx.search("puma")).toEqual([]);
    await expectOnlyIndexFiles(dbPath);

    // The next rebuild starts clean.
    const again = pausingStore(new Map([["fresh", note("fresh", "ibex ledge")]]));
    const second = idx.rebuild(again.store);
    again.resume();
    await second;
    expect(ids(await idx.search("ibex"))).toEqual(["fresh"]);
  });

  test("after a successful rebuild the index folder holds only the index file and its WAL pair", async () => {
    const { idx, dbPath } = await makeIndex({ embeddings: true, embedder: fakeEmbedder() });
    await idx.upsertNote(note("one", "yak"));
    const { store, resume } = pausingStore(new Map([["two", note("two", "zebu")]]));
    resume();
    await idx.rebuild(store);
    await expectOnlyIndexFiles(dbPath);

    await idx.close();
    expect(await folder(dbPath)).toEqual(["index.sqlite"]);
  });

  test("a search during the swap waits while a busy rename is retried, then reads the new index", async () => {
    let attempts = 0;
    let during: Promise<string[]> | null = null;
    let statsDuring: Promise<unknown> | null = null;
    const { idx, logs } = await makeIndex({
      renameFile: (from, to) => {
        attempts++;
        if (attempts === 1) {
          // The live connection is closed now; these must wait for the swap rather than fail.
          during = idx.search("marmot").then(ids);
          statsDuring = idx.stats();
          throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
        }
        renameSync(from, to);
      },
    });
    await idx.upsertNote(note("old", "vole"));
    const { store, resume } = pausingStore(new Map([["new", note("new", "marmot")]]));
    resume();

    await idx.rebuild(store);
    expect(attempts).toBe(2);
    expect(await during).toEqual(["new"]);
    expect(await statsDuring).toEqual({ notes: 1, files: 0, invalid: 0 });
    expect(logs.some((l) => /^index swapped in \d+(\.\d+)? ms$/.test(l))).toBe(true);
  });

  test("a rename that keeps failing leaves the old index in place", async () => {
    const { idx, dbPath } = await makeIndex({
      renameFile: () => {
        throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
      },
    });
    await idx.upsertNote(note("old", "vole"));
    const { store, resume } = pausingStore(new Map([["new", note("new", "marmot")]]));
    resume();

    await expect(idx.rebuild(store)).rejects.toThrow("operation not permitted");
    expect(ids(await idx.search("vole"))).toEqual(["old"]);
    expect(await idx.search("marmot")).toEqual([]);
    await expectOnlyIndexFiles(dbPath);
  });

  test("a rebuild does not replace a file another connection still has open", async () => {
    const { idx, dbPath } = await makeIndex();
    await idx.upsertNote(note("old", "vole"));
    // What the server's connection looks like to `npm run reindex` in a second process.
    const other = new DatabaseSync(dbPath);
    other.prepare("SELECT COUNT(*) FROM notes").get();
    try {
      const { store, resume } = pausingStore(new Map([["new", note("new", "marmot")]]));
      resume();
      await expect(idx.rebuild(store)).rejects.toThrow("is open in another process");
      expect(ids(await idx.search("vole"))).toEqual(["old"]);
      expect(await folder(dbPath)).not.toContain("index.sqlite.building");
    } finally {
      other.close();
    }
  });

  test("open deletes a rebuild file that a crash left behind", async () => {
    const dir = await tempDir();
    const dbPath = path.join(dir, "index.sqlite");
    await fs.writeFile(buildingPath(dbPath), "half a database");
    await fs.writeFile(`${buildingPath(dbPath)}-journal`, "its journal");
    const logs: string[] = [];
    const idx = createIndex({ dbPath, modelCachePath: dir, embeddings: false, log: (m) => logs.push(m) });
    await idx.open();
    cleanups.push(() => idx.close());

    await expectOnlyIndexFiles(dbPath);
    expect(logs).toContain(`removed an unfinished index rebuild: ${buildingPath(dbPath)}`);
  });

  test("a rebuild asked for while one runs joins it", async () => {
    const { idx } = await makeIndex();
    const { store, paused, resume } = pausingStore(new Map([["solo", note("solo", "okapi")]]));
    const first = idx.rebuild(store);
    await paused;
    const second = idx.rebuild(store);
    resume();
    expect(await second).toBe(await first);
  });

  test("closing the index during a rebuild fails the rebuild and removes its file", async () => {
    const { idx, dbPath } = await makeIndex();
    const { store, paused, resume } = pausingStore(new Map([["gone", note("gone", "tapir")]]));
    const rebuilt = idx.rebuild(store);
    await paused;
    await idx.close();
    resume();
    await expect(rebuilt).rejects.toThrow("closed during the rebuild");
    expect(await folder(dbPath)).toEqual(["index.sqlite"]);
  });
});

describe("rebuild through the brain on a real store", () => {
  test("a note written, rewritten, or deleted during a reindex is in the swapped-in index", async () => {
    const dir = await tempDir();
    const store = createStore(path.join(dir, "brain"));

    // The real store, except that readAll can stop after its first note until resumed.
    let pause: { reached: Deferred; resume: Deferred } | null = null;
    const pausable = new Proxy(store, {
      get(target, prop) {
        if (prop === "readAll") {
          return async function* () {
            let first = true;
            for await (const item of target.readAll()) {
              yield item;
              if (first && pause) {
                first = false;
                pause.reached.resolve();
                await pause.resume.promise;
              }
            }
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const index = createIndex({ dbPath: path.join(dir, "cache", "index.sqlite"), modelCachePath: path.join(dir, "models"), embeddings: false });
    const brain = new BrainImpl(pausable, index, () => {});
    cleanups.push(() => brain.close());
    await brain.init();

    const meta = { tool: "test" };
    const write = (slug: string, body: string) =>
      brain.write({ slug, frontmatter: { title: slug, type: "note", summary: "s", tags: [] }, body }, meta);
    await write("aardwolf", "Aardwolves eat termites.");
    await write("caracal", "Caracals leap at birds.");

    pause = { reached: deferred(), resume: deferred() };
    const reindexed = brain.reindex();
    await pause.reached.promise;
    // readAll listed the notes folder and handed over its first note, aardwolf, before these writes.
    await write("aardwolf", "Aardwolves nap in burrows.");
    await write("dingo", "Dingoes howl at dusk.");
    await brain.delete("caracal", meta);
    pause.resume.resolve();

    expect(await reindexed).toMatchObject({ notes: 3, invalid: 0 });
    expect(ids(await brain.search("burrows"))).toEqual(["aardwolf"]);
    expect(await brain.search("termites")).toEqual([]);
    expect(ids(await brain.search("dingoes"))).toEqual(["dingo"]);
    expect(await brain.search("caracals")).toEqual([]);
    expect(await index.invalid()).toEqual([]);
  });
});
