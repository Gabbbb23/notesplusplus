/**
 * The unfiled scan over a real store and a real folder tree. What is asserted here is the pair of traces filing
 * leaves (a mention of the path, a copy under files/ with the same name and size) and what the walk refuses to look
 * at, because those two decide whether the scan is worth running on a folder holding 10,000 files.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../src/core/store/index.ts";
import { checkTrackedRoot, scanTracked } from "../src/core/tracked.ts";
import type { NoteStore } from "../src/core/types.ts";

const meta = { tool: "test" };

let dir: string;
let brainRoot: string;
let tracked: string;
let store: NoteStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "npp-tracked-"));
  brainRoot = path.join(dir, "brain");
  tracked = path.join(dir, "College Files");
  store = createStore(brainRoot);
  await store.init();
  await fs.mkdir(tracked, { recursive: true });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** A file under the tracked root. `rel` uses forward slashes; the modification time is set when given. */
async function put(rel: string, content = "x", mtime?: Date): Promise<string> {
  const abs = path.join(tracked, ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
  if (mtime) await fs.utimes(abs, mtime, mtime);
  return abs;
}

/** An attachment in the brain, the copy trace. */
async function attach(rel: string, content = "x"): Promise<void> {
  const abs = path.join(brainRoot, "files", ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

async function note(body: string, slug = "n"): Promise<void> {
  await store.write({ slug, frontmatter: { title: slug, type: "note", summary: "s", tags: [] }, body }, meta);
}

async function scan(opts?: { allExtensions?: boolean; roots?: string[] }) {
  return scanTracked(store, opts?.roots ?? [tracked], { allExtensions: opts?.allExtensions });
}

function relatives(result: Awaited<ReturnType<typeof scan>>): string[] {
  return result.unfiled.map((f) => f.relativePath);
}

describe("what counts as filed", () => {
  it("a mentioned path is filed, and a document nothing records is not", async () => {
    const mentioned = await put("Sem 1/Syllabus.pdf");
    await put("Sem 1/New Handout.pdf");
    await note(`The syllabus is \`${mentioned}\`.`);

    const result = await scan();
    expect(result.scanned).toBe(2);
    expect(result.filed).toBe(1);
    expect(relatives(result)).toEqual(["Sem 1\\New Handout.pdf"]);
  });

  it("matches a mention that differs in case, slash style, or a trailing separator", async () => {
    await put("Sem 1/Syllabus.pdf");
    await note("See `" + path.join(tracked, "sem 1", "syllabus.pdf").replace(/\\/g, "/") + "`.");

    expect(relatives(await scan())).toEqual([]);
  });

  it("an attachment with the same name and size is filed; a different size is not", async () => {
    await put("Reflection.pdf", "same bytes");
    await put("Report.pdf", "original bytes");
    await attach("college/Reflection.pdf", "same bytes");
    await attach("college/Report.pdf", "an edited copy, longer");

    expect(relatives(await scan())).toEqual(["Report.pdf"]);
  });

  it("a file named in prose but not written as a path stays unfiled", async () => {
    await put("Reflection.pdf");
    await note("The reflection is in Reflection.pdf, submitted today.");

    expect(relatives(await scan())).toEqual(["Reflection.pdf"]);
  });

  it("reads mentions from every note and ignores a file that fails to parse", async () => {
    const a = await put("A.pdf");
    const b = await put("B.pdf");
    await note(`\`${a}\``, "first");
    await note(`\`${b}\``, "second");
    await fs.writeFile(path.join(brainRoot, "notes", "broken.md"), "no frontmatter here");

    const result = await scan();
    expect(result.unfiled).toEqual([]);
    expect(result.filed).toBe(2);
  });
});

describe("what the walk looks at", () => {
  it("skips extensions that are not documents unless allExtensions is set", async () => {
    await put("Schedule.png");
    await put("Notes.pdf");

    expect(relatives(await scan())).toEqual(["Notes.pdf"]);
    expect(relatives(await scan({ allExtensions: true })).sort()).toEqual(["Notes.pdf", "Schedule.png"]);
  });

  it("skips a folder a program keeps for itself, and everything under it", async () => {
    await put("Default/Preferences", "{}");
    await put("Default/Extensions/licence.txt");
    await put("Default/deep/nested/index.txt");
    await put("node_modules/readme.md");
    await put(".git/COMMIT_EDITMSG.txt");
    await put("Coursework.pdf");

    const result = await scan();
    expect(relatives(result)).toEqual(["Coursework.pdf"]);
    expect(result.scanned).toBe(1);
  });

  it("does not report the brain's own attachments when the brain sits inside a tracked root", async () => {
    const inside = path.join(tracked, "brain");
    const nested = createStore(inside);
    await nested.init();
    await fs.writeFile(path.join(inside, "files", "Copy.pdf"), "x");
    await put("Coursework.pdf");

    expect(relatives(await scanTracked(nested, [tracked]))).toEqual(["Coursework.pdf"]);
  });

  it("reports the newest first", async () => {
    await put("Old.pdf", "x", new Date("2026-01-02T00:00:00Z"));
    await put("Newest.pdf", "x", new Date("2026-09-16T00:00:00Z"));
    await put("Middle.pdf", "x", new Date("2026-05-05T00:00:00Z"));

    expect(relatives(await scan())).toEqual(["Newest.pdf", "Middle.pdf", "Old.pdf"]);
  });

  it("reports a file once when one root sits inside another", async () => {
    await put("Sem 1/Handout.pdf");

    const result = await scan({ roots: [tracked, path.join(tracked, "Sem 1")] });
    expect(result.unfiled).toHaveLength(1);
    expect(result.unfiled[0]!.root).toBe(checkTrackedRoot(tracked));
  });

  it("names a root that is not a folder instead of failing", async () => {
    await put("Handout.pdf");
    const missing = path.join(dir, "Gone");

    const result = await scan({ roots: [tracked, missing] });
    expect(result.missingRoots).toEqual([checkTrackedRoot(missing)]);
    expect(relatives(result)).toEqual(["Handout.pdf"]);
  });
});

describe("checkTrackedRoot", () => {
  it("normalizes a drive path the way a mention is normalized", () => {
    expect(checkTrackedRoot("c:/College Files/")).toBe("C:\\College Files");
  });

  it("refuses what a mention may not be, naming the path", () => {
    expect(() => checkTrackedRoot("College Files")).toThrow(/"College Files".*absolute/);
    expect(() => checkTrackedRoot("\\\\server\\share")).toThrow(/UNC/);
    expect(() => checkTrackedRoot("C:\\College\\..\\Windows")).toThrow(/traversal/);
  });
});
