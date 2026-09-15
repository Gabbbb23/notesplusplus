/**
 * Real brains in temp folders. Each one is the file store with its git repo and the SQLite index with embeddings
 * off, composed by BrainImpl the same way src/server.ts composes them. Tests cross the Brain interface, or the REST
 * app built on it; nothing here stands in for the store or the index.
 *
 * Cost on the owner's laptop: init about 400 ms (git init and the first commit), each write about 200 ms (one
 * commit), copy() about 150 ms. Build seeded state once, then copy it for tests that need their own.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { BrainImpl } from "../../src/core/brain.ts";
import { createIndex } from "../../src/core/index/index.ts";
import { createStore, serializeNote, today } from "../../src/core/store/index.ts";
import type { FrontmatterInput } from "../../src/core/store/index.ts";
import type { SearchIndex } from "../../src/core/types.ts";

export interface TempBrainOptions {
  /** Put another SearchIndex adapter in front of the real index, for example one that fails on demand. */
  wrapIndex?: (index: SearchIndex) => SearchIndex;
  /** Where BrainImpl reports failed index updates. Defaults to console.error. */
  log?: (msg: string) => void;
}

/** A note as `writeNotes` puts it on disk. Dates default to today. */
export interface NoteFixture {
  slug: string;
  frontmatter: FrontmatterInput;
  body: string;
}

export class TempBrain {
  private constructor(
    readonly brain: BrainImpl,
    /** Folder holding the brain repo (`brain/`) and the index (`cache/`). Deleted by dispose(). */
    private readonly dir: string,
  ) {}

  /** A new brain: the layout, tags.yml, the root hub `index`, one commit, and an index built from them. */
  static async create(opts: TempBrainOptions = {}): Promise<TempBrain> {
    return TempBrain.open(await fs.mkdtemp(path.join(os.tmpdir(), "npp-brain-")), opts);
  }

  private static async open(dir: string, opts: TempBrainOptions): Promise<TempBrain> {
    const index = createIndex({
      dbPath: path.join(dir, "cache", "index.sqlite"),
      modelCachePath: path.join(dir, "cache", "models"),
      embeddings: false,
    });
    const brain = new BrainImpl(createStore(path.join(dir, "brain")), opts.wrapIndex?.(index) ?? index, opts.log);
    await brain.init();
    return new TempBrain(brain, dir);
  }

  /** Absolute path of the brain repo. */
  get root(): string {
    return this.brain.root;
  }

  /** An independent brain on a byte copy of this repo, git history included, with its own index that init() builds. */
  async copy(opts: TempBrainOptions = {}): Promise<TempBrain> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "npp-brain-"));
    // git init's sample hooks never run; skipping them halves the files to copy.
    await fs.cp(this.root, path.join(dir, "brain"), { recursive: true, filter: (src) => !src.endsWith(".sample") });
    return TempBrain.open(dir, opts);
  }

  async dispose(): Promise<void> {
    await this.brain.close();
    await fs.rm(this.dir, { recursive: true, force: true, maxRetries: 5 });
  }

  /** Commit subjects in the brain repo, newest first. */
  async commits(): Promise<string[]> {
    return (await simpleGit({ baseDir: this.root }).log()).all.map((e) => e.message);
  }

  /** Write a file under the brain root, creating folders: an attachment, an inbox drop, or a stray file. Not indexed. */
  async addFile(rel: string, content: string | Buffer): Promise<string> {
    const abs = path.join(this.root, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
    return abs;
  }

  /**
   * Put notes on disk exactly as the store serializes them, without a commit, then reindex. For fixtures of many
   * notes, where a commit each would cost seconds; the store reads whatever is on disk either way. Throws when a
   * fixture does not read back as a valid note, so a typo cannot quietly shrink the fixture.
   */
  async writeNotes(notes: NoteFixture[]): Promise<void> {
    for (const n of notes) {
      const d = today();
      const fm = { ...n.frontmatter, created: n.frontmatter.created ?? d, updated: n.frontmatter.updated ?? d };
      await this.addFile(`${fm.type === "source" ? "sources" : "notes"}/${n.slug}.md`, serializeNote(fm, n.body));
    }
    const stats = await this.brain.reindex();
    if (stats.invalid > 0) throw new Error(`writeNotes: ${stats.invalid} fixture file(s) are invalid`);
  }
}
