import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BrainImpl } from "../src/core/brain.ts";
import { createIndex } from "../src/core/index/index.ts";
import { createStore, serializeNote, today } from "../src/core/store/index.ts";
import {
  ValidationError,
  type Brain,
  type FileEntry,
  type InvalidNote,
  type Note,
  type NoteStore,
  type PinnedNotes,
  type SearchIndex,
  type SearchOptions,
} from "../src/core/types.ts";
import { TempBrain } from "./helpers/temp-brain.ts";

// BrainImpl's job is keeping the index in step with the store. These tests cross the Brain interface only, on a real
// store and index, and check what a caller would see: search, backlinks, and stats. Notes that only set the scene go
// on disk through writeNotes (which reindexes); the write under test always goes through the brain.

const meta = { tool: "test" };

const note = (slug: string, title: string, body: string) => ({ slug, frontmatter: { title, type: "note" as const, summary: "s", tags: [] }, body });
/** A hub titled with its slug in upper case, listing `links` one per line. */
const hub = (slug: string, links: string[], extra = "") => ({
  slug,
  frontmatter: { title: slug.toUpperCase(), type: "hub" as const, summary: "s", tags: [] },
  body: `${links.map((l) => `- [[${l}]]`).join("\n")}\n${extra}`,
});
const crumb = (slug: string) => ({ slug, title: slug.toUpperCase() });
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

describe("BrainImpl trail", () => {
  // Every test gets its own copy of an empty brain, so hubs from one tree never reach another.
  let base: TempBrain;
  let tb: TempBrain;
  let brain: Brain;

  beforeAll(async () => {
    base = await TempBrain.create();
  });

  beforeEach(async () => {
    tb = await base.copy();
    brain = tb.brain;
  });

  afterEach(async () => {
    await tb.dispose();
  });

  afterAll(async () => {
    await base.dispose();
  });

  it("follows hub writes, a hub rename, and a hub delete, and reports orphans and unknown slugs", async () => {
    await brain.write(note("rizal-day", "RIZAL-DAY", "December 30."), meta);
    await brain.write(hub("ge09", ["rizal-day"]), meta);
    await brain.write(hub("college", ["ge09"]), meta);
    await brain.write(note("stray", "STRAY", "No hub lists this."), meta);
    expect(await brain.trail("rizal-day")).toEqual({ trail: [], inHub: false });

    await brain.write(hub("index", ["college"]), meta);
    expect(await brain.trail("rizal-day")).toEqual({ trail: [crumb("index"), crumb("college"), crumb("ge09")], inHub: true });
    expect(await brain.trail("stray")).toEqual({ trail: [], inHub: false });
    expect(await brain.trail("nope")).toBeNull();

    await brain.rename("ge09", "ge09-rizal", meta);
    expect(await brain.trail("rizal-day")).toEqual({
      trail: [crumb("index"), crumb("college"), { slug: "ge09-rizal", title: "GE09" }],
      inHub: true,
    });
    expect(await brain.trail("ge09")).toBeNull();

    await brain.delete("college", meta);
    expect(await brain.trail("rizal-day")).toEqual({ trail: [], inHub: false });
    expect(await brain.trail("ge09-rizal")).toEqual({ trail: [], inHub: false });
  });

  it("lists every hub from the root down to the one that links the note or source", async () => {
    await tb.writeNotes([
      hub("index", ["fields", "college"]),
      hub("college", ["ge09"]),
      hub("ge09", ["rizal-day", "ge09-transcript"]),
      hub("fields", ["org-chart"]),
      note("rizal-day", "Rizal Day", ""),
      note("org-chart", "Org chart", ""),
      { slug: "ge09-transcript", frontmatter: { title: "Transcript", type: "source", summary: "s", tags: [] }, body: "" },
    ]);
    const nested = { trail: [crumb("index"), crumb("college"), crumb("ge09")], inHub: true };
    expect(await brain.trail("rizal-day")).toEqual(nested);
    expect(await brain.trail("ge09-transcript")).toEqual(nested);
    expect(await brain.trail("ge09")).toEqual({ trail: [crumb("index"), crumb("college")], inHub: true });
    expect(await brain.trail("org-chart")).toEqual({ trail: [crumb("index"), crumb("fields")], inHub: true });
  });

  it("prefers the shallower hub when hubs at different depths list the note", async () => {
    // The deeper hub is linked first, so a depth-first search would pick it.
    await tb.writeNotes([hub("index", ["college", "fields"]), hub("college", ["ge09"]), hub("ge09", ["shared"]), hub("fields", ["shared"]), note("shared", "Shared", "")]);
    expect(await brain.trail("shared")).toEqual({ trail: [crumb("index"), crumb("fields")], inHub: true });
  });

  it("prefers the hub linked first when hubs at the same depth list the note, by link order in the body", async () => {
    await tb.writeNotes([hub("index", ["fields", "college"]), hub("college", ["shared"]), hub("fields", ["shared"]), note("shared", "Shared", "")]);
    expect(await brain.trail("shared")).toEqual({ trail: [crumb("index"), crumb("fields")], inHub: true });

    await brain.write(hub("index", ["college", "fields"]), meta);
    expect(await brain.trail("shared")).toEqual({ trail: [crumb("index"), crumb("college")], inHub: true });
  });

  it("breaks a tie a level down by the order of the hubs above, not by position in the parent", async () => {
    // Both sub-hubs sit at depth 2. a-sub is the first link in a, b-sub the second in b, but index links b before a,
    // so b-sub leaves the queue first.
    await tb.writeNotes([
      hub("index", ["b", "a"]),
      hub("a", ["a-sub"]),
      hub("b", ["x", "b-sub"]),
      hub("a-sub", ["deep"]),
      hub("b-sub", ["deep"]),
      note("x", "X", ""),
      note("deep", "Deep", ""),
    ]);
    expect(await brain.trail("deep")).toEqual({ trail: [crumb("index"), crumb("b"), crumb("b-sub")], inHub: true });
  });

  it("stops on hubs that link each other", async () => {
    await tb.writeNotes([hub("index", ["a"]), hub("a", ["b", "index"]), hub("b", ["a", "b", "note"]), note("orphan", "Orphan", ""), note("note", "Note", "")]);
    expect(await brain.trail("orphan")).toEqual({ trail: [], inHub: false });
    expect(await brain.trail("note")).toEqual({ trail: [crumb("index"), crumb("a"), crumb("b")], inHub: true });
    expect(await brain.trail("a")).toEqual({ trail: [crumb("index")], inHub: true });
  });

  it("does not follow links from a non-hub note or to slugs that do not exist", async () => {
    await tb.writeNotes([
      hub("index", ["specs", "missing", "college"]),
      hub("college", []),
      note("specs", "Specs", "From [[transcript]]."),
      note("transcript", "Transcript", ""),
    ]);
    expect(await brain.trail("transcript")).toEqual({ trail: [], inHub: false });
    expect(await brain.trail("specs")).toEqual({ trail: [crumb("index")], inHub: true });
    expect(await brain.trail("missing")).toBeNull();
  });

  it("gives the root an empty trail, and every note none once the root hub is gone from disk and reindexed", async () => {
    await tb.writeNotes([hub("index", ["college"]), hub("college", ["ge09", "index"]), hub("ge09", ["rizal-day"]), note("rizal-day", "Rizal Day", "")]);
    expect(await brain.trail("index")).toEqual({ trail: [], inHub: true });

    // The store refuses to delete the root hub, but the file can still go missing on disk.
    await fs.rm(path.join(tb.root, "notes", "index.md"));
    // Until a reindex, the index still answers from what it last saw.
    expect(await brain.trail("rizal-day")).toEqual({ trail: [crumb("index"), crumb("college"), crumb("ge09")], inHub: true });
    await brain.reindex();
    expect(await brain.trail("rizal-day")).toEqual({ trail: [], inHub: false });
    expect(await brain.trail("index")).toBeNull();
  });
});

describe("BrainImpl mentions and hub membership", () => {
  let tb: TempBrain;
  let brain: Brain;
  const MODULE = String.raw`C:\College Files\Ethics\Module 1.pdf`;

  beforeEach(async () => {
    tb = await TempBrain.create();
    brain = tb.brain;
  });

  afterEach(async () => {
    await tb.dispose();
  });

  it("allows a mentioned path after the write that adds it and refuses it after the write that removes it", async () => {
    expect(await brain.isMentioned(MODULE)).toBe(false);
    await brain.write(note("ethics", "Ethics", `Module 1 is \`${MODULE}\`.`), meta);

    expect(await brain.isMentioned(MODULE)).toBe(true);
    // Case, slash style, and a trailing separator do not matter.
    expect(await brain.isMentioned("c:/college files/ETHICS/module 1.pdf")).toBe(true);
    expect(await brain.isMentioned(`${MODULE}\\`)).toBe(true);
    expect(await brain.isMentioned(String.raw`C:\College Files\Ethics\Module 2.pdf`)).toBe(false);
    // A mentioned folder does not allow the files inside it, and a path that only normalizes onto a mention is refused.
    expect(await brain.isMentioned(String.raw`C:\College Files\Ethics`)).toBe(false);
    expect(await brain.isMentioned(String.raw`C:\College Files\Other\..\Ethics\Module 1.pdf`)).toBe(false);

    await brain.write(note("ethics", "Ethics", `Module 1 is gone. \`\`${String.raw`D:\Videos\Lecture 3.mp4`}\`\``), meta);
    expect(await brain.isMentioned(MODULE)).toBe(false);
    expect(await brain.isMentioned(String.raw`d:\videos\lecture 3.mp4`)).toBe(true);
  });

  it("keeps mentions current through rename, delete, inbox take, and reindex", async () => {
    await brain.write(note("first", "First", `\`${MODULE}\``), meta);
    await brain.write(note("second", "Second", `Also \`${MODULE}\``), meta);

    await brain.rename("first", "renamed", meta);
    expect((await brain.get("renamed"))?.mentions).toEqual([MODULE]);
    await brain.delete("second", meta);
    expect(await brain.isMentioned(MODULE)).toBe(true);
    await brain.delete("renamed", meta);
    expect(await brain.isMentioned(MODULE)).toBe(false);

    await brain.inboxAdd("paths.md", "The syllabus is `C:\\College Files\\Syllabus.pdf`.");
    await brain.inboxTake("paths.md", { title: "Paths", summary: "Where files are." }, meta);
    expect(await brain.isMentioned(String.raw`C:\College Files\Syllabus.pdf`)).toBe(true);

    // A note edited by hand counts only after a reindex.
    await tb.writeNotes([note("by-hand", "By hand", `\`${MODULE}\``)]);
    expect(await brain.isMentioned(MODULE)).toBe(true);
  });

  it("check_links reports notes that no hub lists and notes that several hubs list", async () => {
    await tb.writeNotes([
      hub("index", ["alpha-hub", "beta-hub"]),
      hub("alpha-hub", ["in-one", "in-two", "beta-hub", "a-source"]),
      hub("beta-hub", ["in-two", "alpha-hub"]),
      note("in-none", "In none", "Linked only from a note: [[in-one]]."),
      note("in-one", "In one", "Links to [[in-none]]."),
      note("in-two", "In two", ""),
      note("in-code", "In code", ""),
      hub("unlisted-hub", [], "`[[in-code]]` stays code.\n\n~~~\n[[in-code]]\n~~~\n"),
      { slug: "a-source", frontmatter: { title: "A source", type: "source", summary: "s", tags: [] }, body: "" },
      { slug: "lone-source", frontmatter: { title: "Lone source", type: "source", summary: "s", tags: [] }, body: "" },
    ]);
    const report = await brain.checkLinks();
    // Hubs (listed twice or not at all) and sources are exempt; a link from a plain note or from code does not list.
    expect(report.notesWithoutHub).toEqual([{ slug: "in-code" }, { slug: "in-none" }]);
    expect(report.notesInSeveralHubs).toEqual([{ slug: "in-two", hubs: ["alpha-hub", "beta-hub"] }]);

    await brain.write(hub("beta-hub", ["alpha-hub", "in-none"]), meta);
    const after = await brain.checkLinks();
    expect(after.notesWithoutHub).toEqual([{ slug: "in-code" }]);
    expect(after.notesInSeveralHubs).toEqual([]);
    expect(after).toMatchObject({ brokenLinks: [], missingFiles: [], missingSources: [], invalidNotes: [] });
  });

  it("rename rewrites real links and leaves [[old]] inside code as written", async () => {
    await tb.writeNotes([
      note("okapi", "Okapi", "Forest giraffe."),
      note(
        "zoo",
        "Zoo",
        ["See [[okapi]] and [[okapi|the okapi]].", "Inline `[[okapi]]` and ``[[okapi]]``.", "~~~", "[[okapi]]", "~~~", "", "    [[okapi]]", ""].join("\n"),
      ),
    ]);
    const result = await brain.rename("okapi", "forest-giraffe", meta);
    expect(result.rewritten).toEqual(["zoo"]);
    expect((await brain.get("zoo"))?.body).toBe(
      ["See [[forest-giraffe]] and [[forest-giraffe|the okapi]].", "Inline `[[okapi]]` and ``[[okapi]]``.", "~~~", "[[okapi]]", "~~~", "", "    [[okapi]]", ""].join("\n"),
    );
    expect(await brain.checkLinks()).toMatchObject({ brokenLinks: [] });
    expect(slugs(await brain.backlinks("forest-giraffe"))).toEqual(["zoo"]);
  });
});

describe("BrainImpl pins", () => {
  let tb: TempBrain;
  let brain: Brain;
  const pinSlugs = (pins: PinnedNotes) => ({ home: slugs(pins.home), sidebar: slugs(pins.sidebar) });

  beforeEach(async () => {
    tb = await TempBrain.create();
    brain = tb.brain;
    await tb.writeNotes([note("okapi", "Okapi", "Forest giraffe."), note("zebra", "Zebra", "Stripes."), hub("animals", ["okapi", "zebra"])]);
  });

  afterEach(async () => {
    await tb.dispose();
  });

  it("answers with the pinned notes in pin order, carries a pin through a rename, and drops it on delete", async () => {
    await brain.setPin("zebra", "home", true, meta);
    await brain.setPin("okapi", "home", true, meta);
    const pinned = await brain.setPin("animals", "sidebar", true, meta);
    expect(pinSlugs(pinned)).toEqual({ home: ["zebra", "okapi"], sidebar: ["animals"] });
    expect(pinned.home[1]).toEqual({ slug: "okapi", path: "notes/okapi.md", title: "Okapi", type: "note", summary: "s", tags: [], created: today(), updated: today() });
    expect(await brain.pins()).toEqual(pinned);

    await brain.setPin("okapi", "sidebar", true, meta);
    await brain.rename("okapi", "forest-giraffe", meta);
    const renamed = await brain.pins();
    expect(pinSlugs(renamed)).toEqual({ home: ["zebra", "forest-giraffe"], sidebar: ["animals", "forest-giraffe"] });
    expect(renamed.home[1]).toMatchObject({ slug: "forest-giraffe", path: "notes/forest-giraffe.md", title: "Okapi" });

    await brain.delete("forest-giraffe", meta);
    expect(pinSlugs(await brain.pins())).toEqual({ home: ["zebra"], sidebar: ["animals"] });
    expect((await brain.checkLinks()).missingPins).toEqual([]);

    expect(pinSlugs(await brain.reorderPins("sidebar", ["animals"], meta))).toEqual({ home: ["zebra"], sidebar: ["animals"] });
  });

  it("leaves out a pinned note removed by hand without unpinning it, and checkLinks reports it as missingPins", async () => {
    await brain.setPin("okapi", "home", true, meta);
    await brain.setPin("zebra", "home", true, meta);
    await brain.setPin("okapi", "sidebar", true, meta);

    await fs.rm(path.join(tb.root, "notes", "okapi.md"));
    // Pins read the note files, not the index, so no reindex is needed.
    expect(await brain.pins()).toEqual({ home: [expect.objectContaining({ slug: "zebra" })], sidebar: [] });
    expect(await fs.readFile(path.join(tb.root, "pins.yml"), "utf8")).toContain("okapi");
    expect((await brain.checkLinks()).missingPins).toEqual(["okapi"]);

    // The web UI never saw it, so a reorder may leave it out.
    expect(pinSlugs(await brain.reorderPins("home", ["zebra"], meta))).toEqual({ home: ["zebra"], sidebar: [] });
    await brain.setPin("okapi", "home", false, meta);
    await brain.setPin("okapi", "sidebar", false, meta);
    expect((await brain.checkLinks()).missingPins).toEqual([]);
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
  trail(slug: string) {
    return this.inner.trail(slug);
  }
  isMentioned(absolutePath: string) {
    return this.inner.isMentioned(absolutePath);
  }
  hubMembership() {
    return this.inner.hubMembership();
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
