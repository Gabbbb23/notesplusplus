import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { BrainError } from "../types.ts";

const IDENTITY_RE = /(tell me who you are|Author identity unknown|user\.name|user\.email|empty ident)/i;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Thin wrapper over simple-git for the brain repo. Every operation runs through one
 * promise queue so concurrent writes never interleave their add/commit steps.
 * Never sets user identity: the machine's global git config is the source of truth.
 */
export class GitRepo {
  private _git: SimpleGit | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(public readonly root: string) {}

  /** Created on first use so the root may not exist yet when the store is constructed; init() creates it. */
  private get git(): SimpleGit {
    if (!this._git) this._git = simpleGit({ baseDir: this.root });
    return this._git;
  }

  /** Run `fn` after every previously queued operation has settled. */
  serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async isRepo(): Promise<boolean> {
    return exists(path.join(this.root, ".git"));
  }

  async hasCommits(): Promise<boolean> {
    try {
      await this.git.revparse(["--verify", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  /** `git init` when .git is missing. Not queued: call from an already-serialized section. */
  async initRepo(): Promise<void> {
    if (await this.isRepo()) return;
    await this.wrap(() => this.git.init(), "git init failed");
  }

  /** Stage everything and commit. Used once for the initial commit. */
  async commitAll(message: string): Promise<void> {
    await this.wrap(() => this.git.add(["-A"]), "git add failed");
    await this.commitStaged(message);
  }

  /**
   * Stage only the given brain-relative paths (additions, modifications, deletions) and commit.
   * Paths that neither exist on disk nor are tracked are skipped, so removing an untracked inbox file is fine.
   */
  async commit(message: string, paths: string[]): Promise<void> {
    const present: string[] = [];
    const gone: string[] = [];
    for (const p of new Set(paths)) {
      if (await exists(path.join(this.root, p))) present.push(p);
      else gone.push(p);
    }
    if (present.length) await this.wrap(() => this.git.add(["-A", "--", ...present]), "git add failed");
    for (const p of gone) {
      const tracked = await this.wrap(() => this.git.raw(["ls-files", "--", p]), "git ls-files failed");
      if (tracked.trim()) await this.wrap(() => this.git.add(["-A", "--", p]), "git add failed");
    }
    await this.commitStaged(message);
  }

  /** Commit message subjects, newest first. */
  async log(): Promise<string[]> {
    const l = await this.wrap(() => this.git.log(), "git log failed");
    return l.all.map((e) => e.message);
  }

  private async commitStaged(message: string): Promise<void> {
    try {
      // --allow-empty keeps "one write, one commit" true even when the bytes did not change.
      await this.git.commit(message, undefined, { "--allow-empty": null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (IDENTITY_RE.test(msg)) {
        throw new BrainError(
          `git has no user identity configured, so the brain repo cannot commit. Run: git config --global user.name "You" && git config --global user.email "you@example.com"`,
          500,
          "git_identity",
        );
      }
      throw new BrainError(`git commit failed: ${msg}`, 500, "git");
    }
  }

  private async wrap<T>(fn: () => Promise<T>, what: string): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BrainError) throw err;
      throw new BrainError(`${what}: ${err instanceof Error ? err.message : String(err)}`, 500, "git");
    }
  }
}
