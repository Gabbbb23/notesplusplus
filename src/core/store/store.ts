import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  BrainError,
  ConflictError,
  NotFoundError,
  ValidationError,
  compareSummaries,
  type FileEntry,
  type Frontmatter,
  type InboxItem,
  type InboxTakeResult,
  type InvalidNote,
  type ListFilter,
  type Note,
  type NoteStore,
  type NoteSummary,
  type NoteType,
  type RenameResult,
  type StoreLinkReport,
  type Tag,
  type WriteMeta,
  type WriteNoteInput,
} from "../types.ts";
import { parseNoteBody, rewriteLinks } from "../graph/note-body.ts";
import { parseFrontmatter, serializeNote, summaryLengthProblem, validateFrontmatter } from "./frontmatter.ts";
import { GitRepo } from "./git.ts";
import { isValidSlug, slugify } from "./slug.ts";

const TEXT_EXTS = new Set(["md", "markdown", "txt", "text", "csv", "json", "srt", "vtt", "log"]);
const NOTE_DIRS = ["notes", "sources"] as const;
const TAGS_FILE = "tags.yml";
const TAGS_HEADER = "# Tag registry. One entry per tag:\n#   - name: hardware\n#     description: Laptops, parts, peripherals.\n";
const ROOT_HUB_SLUG = "index";

/** Local calendar date as YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function dirForType(type: NoteType): "notes" | "sources" {
  return type === "source" ? "sources" : "notes";
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/** Run an fs operation, turning unexpected errors into BrainError(500, "io"). BrainErrors pass through. */
async function io<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BrainError) throw err;
    throw new BrainError(`${what}: ${err instanceof Error ? err.message : String(err)}`, 500, "io");
  }
}

async function statOrNull(p: string): Promise<Stats | null> {
  try {
    return await fs.stat(p);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

/** Recursively list files under `dir`, returning paths relative to `dir` with forward slashes, sorted. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(rel: string): Promise<void> {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await visit(child);
      else if (e.isFile()) out.push(child);
    }
  }
  if (await statOrNull(dir)) await visit("");
  return out.sort();
}

function extOf(name: string): string {
  const ext = path.extname(name);
  return ext ? ext.slice(1).toLowerCase() : "";
}

/**
 * NoteStore over a folder of markdown files with a git repo.
 * Every brain-relative path uses forward slashes, even on Windows.
 */
export class FileStore implements NoteStore {
  readonly root: string;
  private readonly git: GitRepo;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.git = new GitRepo(this.root);
  }

  // ---- layout -------------------------------------------------------------

  async init(): Promise<void> {
    await this.git.serialize(async () => {
      await io(async () => {
        for (const d of ["notes", "sources", "files", "inbox"]) {
          await fs.mkdir(path.join(this.root, d), { recursive: true });
        }
        const tagsPath = path.join(this.root, TAGS_FILE);
        if (!(await statOrNull(tagsPath))) {
          await fs.writeFile(tagsPath, `${TAGS_HEADER}[]\n`, "utf8");
        }
        const indexPath = this.abs(`notes/${ROOT_HUB_SLUG}.md`);
        if (!(await statOrNull(indexPath))) {
          const d = today();
          const fm: Frontmatter = {
            title: "Index",
            type: "hub",
            summary: "Root hub. Lists every domain hub.",
            tags: [],
            created: d,
            updated: d,
          };
          await fs.writeFile(indexPath, serializeNote(fm, ""), "utf8");
        }
      }, "init brain layout");
      await this.git.initRepo();
      if (!(await this.git.hasCommits())) {
        await this.git.commitAll("init: brain layout");
      }
    });
  }

  resolve(relativePath: string): string {
    if (typeof relativePath !== "string") throw new ValidationError("path must be a string");
    if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) {
      throw new ValidationError("path must be relative to the brain root");
    }
    const abs = path.resolve(this.root, relativePath);
    const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
    const rootF = fold(this.root);
    const absF = fold(abs);
    if (absF !== rootF && !absF.startsWith(rootF + path.sep)) {
      throw new ValidationError("path escapes brain root");
    }
    return abs;
  }

  /** Absolute path for a brain-relative path this class built itself (no user input). */
  private abs(rel: string): string {
    return path.join(this.root, ...rel.split("/"));
  }

  // ---- reading ------------------------------------------------------------

  /** Brain-relative path of the note file for a slug, or null if it is in neither folder. */
  private async locate(slug: string): Promise<string | null> {
    for (const dir of NOTE_DIRS) {
      const rel = `${dir}/${slug}.md`;
      if (await statOrNull(this.abs(rel))) return rel;
    }
    return null;
  }

  /** Read and validate a note file, and parse its body for links and mentions. Throws like readSummary. */
  private async readNote(rel: string): Promise<Note> {
    const note = await this.readSummary(rel);
    return { ...note, ...parseNoteBody(note.body) };
  }

  /**
   * Read and validate a note file without parsing its body. Parsing costs about 2.5 ms per note on the owner's brain,
   * so lists and rename's scan skip it. Throws ValidationError for bad content; io errors become BrainError.
   */
  private async readSummary(rel: string): Promise<Omit<Note, "links" | "mentions">> {
    const abs = this.abs(rel);
    const [raw, stat] = await io(() => Promise.all([fs.readFile(abs, "utf8"), fs.stat(abs)]), `read ${rel}`);
    const slug = path.posix.basename(rel, ".md");
    const dir = rel.split("/")[0];
    const parsed = parseFrontmatter(raw);
    if (!parsed.hasFrontmatter) throw new ValidationError("frontmatter block is missing");
    const frontmatter = validateFrontmatter(parsed.data, { requireDates: true });
    const problems: string[] = [];
    if (!isValidSlug(slug)) problems.push(`filename "${slug}" is not a valid slug`);
    if (dirForType(frontmatter.type) !== dir) problems.push(`type ${frontmatter.type} does not belong in ${dir}/`);
    if (problems.length) throw new ValidationError(problems.join("; "));
    return {
      slug,
      path: rel,
      title: frontmatter.title,
      type: frontmatter.type,
      summary: frontmatter.summary,
      tags: frontmatter.tags,
      created: frontmatter.created,
      updated: frontmatter.updated,
      frontmatter,
      body: parsed.body,
      raw,
      mtimeMs: stat.mtimeMs,
    };
  }

  async get(slug: string): Promise<Note | null> {
    if (!isValidSlug(slug)) return null;
    const rel = await io(() => this.locate(slug), `locate ${slug}`);
    if (!rel) return null;
    try {
      return await this.readNote(rel);
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new BrainError(`${rel} is invalid: ${err.message}`, 422, "invalid_note");
      }
      throw err;
    }
  }

  readAll(): AsyncIterable<Note | InvalidNote> {
    return this.readEvery((rel) => this.readNote(rel));
  }

  private async *readEvery<T>(read: (rel: string) => Promise<T>): AsyncIterable<T | InvalidNote> {
    for (const dir of NOTE_DIRS) {
      let names: string[];
      try {
        names = (await fs.readdir(this.abs(dir))).filter((n) => n.toLowerCase().endsWith(".md")).sort();
      } catch (err) {
        if (isNodeError(err) && err.code === "ENOENT") continue;
        throw new BrainError(`list ${dir}: ${err instanceof Error ? err.message : String(err)}`, 500, "io");
      }
      for (const name of names) {
        const rel = `${dir}/${name}`;
        try {
          yield await read(rel);
        } catch (err) {
          yield { path: rel, error: err instanceof Error ? err.message : String(err) };
        }
      }
    }
  }

  async list(filter: ListFilter = {}): Promise<NoteSummary[]> {
    const out: NoteSummary[] = [];
    for await (const item of this.readEvery((rel) => this.readSummary(rel))) {
      if ("error" in item) continue;
      if (filter.type && item.type !== filter.type) continue;
      if (filter.tag && !item.tags.includes(filter.tag)) continue;
      out.push({
        slug: item.slug,
        path: item.path,
        title: item.title,
        type: item.type,
        summary: item.summary,
        tags: item.tags,
        created: item.created,
        updated: item.updated,
      });
    }
    return out.sort(compareSummaries);
  }

  // ---- writing ------------------------------------------------------------

  async write(input: WriteNoteInput, meta: WriteMeta): Promise<Note> {
    const knownTags = new Set((await this.tags()).map((t) => t.name));
    const problems: string[] = [];
    let fmInput: Frontmatter | null = null;
    try {
      fmInput = validateFrontmatter(input.frontmatter, { knownTags, limitSummary: true });
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      problems.push(err.message);
    }

    let slug = input.slug;
    if (slug === undefined) {
      const title = (input.frontmatter as { title?: unknown } | undefined)?.title;
      if (typeof title === "string") {
        try {
          slug = slugify(title);
        } catch (err) {
          if (!(err instanceof ValidationError)) throw err;
          problems.push(err.message);
        }
      }
    } else if (!isValidSlug(slug)) {
      problems.push(`slug "${slug}" must match /^[a-z0-9]+(-[a-z0-9]+)*$/`);
    }
    if (slug === ROOT_HUB_SLUG && fmInput && fmInput.type !== "hub") {
      problems.push(`slug "${ROOT_HUB_SLUG}" is reserved for the root hub (type hub)`);
    }
    if (problems.length || !fmInput || !slug) throw new ValidationError(problems.join("; "));
    const fm = fmInput;
    const theSlug = slug;

    return this.git.serialize(async () => {
      const dir = dirForType(fm.type);
      const other = dir === "notes" ? "sources" : "notes";
      const otherKind = other === "sources" ? "source" : "note";
      const rel = `${dir}/${theSlug}.md`;

      const note = await io(async () => {
        if (await statOrNull(this.abs(`${other}/${theSlug}.md`))) {
          throw new ValidationError(
            `slug ${theSlug} already exists as a ${otherKind}; a note cannot change to/from source`,
          );
        }
        const existing = await statOrNull(this.abs(rel));
        if (input.expectedMtimeMs !== undefined) {
          if (!existing) {
            throw new ConflictError(`${rel} does not exist but expectedMtimeMs was given`);
          }
          if (Math.round(existing.mtimeMs) !== Math.round(input.expectedMtimeMs)) {
            throw new ConflictError(`${rel} changed on disk since it was read; re-read it and try again`);
          }
        }
        let previousCreated: string | undefined;
        if (existing) {
          try {
            const prev = parseFrontmatter(await fs.readFile(this.abs(rel), "utf8"));
            if (typeof prev.data.created === "string" && /^\d{4}-\d{2}-\d{2}$/.test(prev.data.created)) {
              previousCreated = prev.data.created;
            }
          } catch {
            // The old file is unreadable; a fresh created date is the best we can do.
          }
        }
        const now = today();
        const finalFm: Frontmatter = {
          ...fm,
          created: fm.created || previousCreated || now,
          updated: now,
        };
        await fs.writeFile(this.abs(rel), serializeNote(finalFm, input.body ?? ""), "utf8");
        return rel;
      }, `write ${rel}`);

      await this.git.commit(`${meta.tool}: write ${theSlug}`, [note]);
      return this.readNote(rel);
    });
  }

  async rename(oldSlug: string, newSlug: string, meta: WriteMeta): Promise<RenameResult> {
    if (!isValidSlug(newSlug)) throw new ValidationError(`slug "${newSlug}" must match /^[a-z0-9]+(-[a-z0-9]+)*$/`);
    if (oldSlug === ROOT_HUB_SLUG || newSlug === ROOT_HUB_SLUG) {
      throw new ValidationError(`slug "${ROOT_HUB_SLUG}" is reserved for the root hub and cannot be renamed`);
    }
    if (oldSlug === newSlug) throw new ValidationError("old and new slug are the same");

    return this.git.serialize(async () => {
      const oldRel = await io(() => this.locate(oldSlug), `locate ${oldSlug}`);
      if (!oldRel) throw new NotFoundError(`note ${oldSlug}`);
      if (await io(() => this.locate(newSlug), `locate ${newSlug}`)) {
        throw new ValidationError(`slug ${newSlug} already exists`);
      }
      const dir = oldRel.split("/")[0] as "notes" | "sources";
      const newRel = `${dir}/${newSlug}.md`;

      const moving = await this.readNote(oldRel).catch((err: unknown) => {
        if (err instanceof ValidationError) {
          throw new ValidationError(`${oldRel} is invalid and cannot be renamed: ${err.message}`);
        }
        throw err;
      });

      // Collect the rewrites before touching disk so a bad file cannot leave a half-done rename.
      const rewrites: Array<{ rel: string; content: string; slug: string }> = [];
      for await (const item of this.readEvery((rel) => this.readSummary(rel))) {
        if ("error" in item || item.path === oldRel) continue;
        // Only a body that contains the slug can link to it, so most notes skip the parse.
        const linked = item.body.includes(oldSlug) && parseNoteBody(item.body).links.includes(oldSlug);
        const sourced = item.frontmatter.sources?.includes(oldSlug) ?? false;
        if (!linked && !sourced) continue;
        const fm: Frontmatter = { ...item.frontmatter };
        if (sourced) fm.sources = fm.sources!.map((s) => (s === oldSlug ? newSlug : s));
        const body = linked ? rewriteLinks(item.body, oldSlug, newSlug) : item.body;
        rewrites.push({ rel: item.path, content: serializeNote(fm, body), slug: item.slug });
      }

      await io(async () => {
        const fm: Frontmatter = { ...moving.frontmatter, updated: today() };
        const body = rewriteLinks(moving.body, oldSlug, newSlug);
        await fs.writeFile(this.abs(newRel), serializeNote(fm, body), "utf8");
        await fs.unlink(this.abs(oldRel));
        for (const r of rewrites) await fs.writeFile(this.abs(r.rel), r.content, "utf8");
      }, `rename ${oldRel} -> ${newRel}`);

      await this.git.commit(`${meta.tool}: rename ${oldSlug} -> ${newSlug}`, [oldRel, newRel, ...rewrites.map((r) => r.rel)]);
      return { note: await this.readNote(newRel), rewritten: rewrites.map((r) => r.slug) };
    });
  }

  async delete(slug: string, meta: WriteMeta): Promise<void> {
    if (slug === ROOT_HUB_SLUG) throw new ValidationError(`the root hub "${ROOT_HUB_SLUG}" cannot be deleted`);
    await this.git.serialize(async () => {
      const rel = isValidSlug(slug) ? await io(() => this.locate(slug), `locate ${slug}`) : null;
      if (!rel) throw new NotFoundError(`note ${slug}`);
      await io(() => fs.unlink(this.abs(rel)), `delete ${rel}`);
      await this.git.commit(`${meta.tool}: delete ${slug}`, [rel]);
    });
  }

  // ---- tags ---------------------------------------------------------------

  async tags(): Promise<Tag[]> {
    const raw = await io(async () => {
      try {
        return await fs.readFile(path.join(this.root, TAGS_FILE), "utf8");
      } catch (err) {
        if (isNodeError(err) && err.code === "ENOENT") return "";
        throw err;
      }
    }, `read ${TAGS_FILE}`);
    let data: unknown;
    try {
      data = parseYaml(raw);
    } catch (err) {
      throw new ValidationError(`${TAGS_FILE} is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (data === null || data === undefined) return [];
    if (!Array.isArray(data)) throw new ValidationError(`${TAGS_FILE} must be a YAML list of { name, description }`);
    const tags: Tag[] = [];
    for (const entry of data) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as { name?: unknown; description?: unknown };
      if (typeof e.name !== "string") continue;
      tags.push({ name: e.name, description: typeof e.description === "string" ? e.description : "" });
    }
    return tags.sort((a, b) => a.name.localeCompare(b.name));
  }

  async createTag(tag: Tag, meta: WriteMeta): Promise<Tag> {
    const problems: string[] = [];
    const name = tag?.name;
    if (!isValidSlug(name)) problems.push(`tag name "${String(name)}" must match /^[a-z0-9]+(-[a-z0-9]+)*$/`);
    if (typeof tag?.description !== "string") problems.push("description must be a string");
    if (problems.length) throw new ValidationError(problems.join("; "));

    return this.git.serialize(async () => {
      const existing = await this.tags();
      if (existing.some((t) => t.name === name)) throw new ValidationError(`tag ${name} already exists`);
      const created: Tag = { name, description: tag.description };
      const all = [...existing, created].sort((a, b) => a.name.localeCompare(b.name));
      await io(
        () => fs.writeFile(path.join(this.root, TAGS_FILE), `${TAGS_HEADER}${stringifyYaml(all)}`, "utf8"),
        `write ${TAGS_FILE}`,
      );
      await this.git.commit(`${meta.tool}: create tag ${name}`, [TAGS_FILE]);
      return created;
    });
  }

  // ---- inbox --------------------------------------------------------------

  private async isTextFile(abs: string, name: string): Promise<boolean> {
    const ext = extOf(name);
    if (ext) return TEXT_EXTS.has(ext);
    const fh = await fs.open(abs, "r");
    try {
      const buf = Buffer.alloc(512);
      const { bytesRead } = await fh.read(buf, 0, 512, 0);
      return !buf.subarray(0, bytesRead).includes(0);
    } finally {
      await fh.close();
    }
  }

  private async inboxItem(name: string): Promise<InboxItem> {
    const abs = this.abs(`inbox/${name}`);
    const stat = await fs.stat(abs);
    return {
      name,
      path: `inbox/${name}`,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      isText: await this.isTextFile(abs, name),
    };
  }

  async inboxList(): Promise<InboxItem[]> {
    return io(async () => {
      const names = await walk(path.join(this.root, "inbox"));
      const items: InboxItem[] = [];
      for (const name of names) items.push(await this.inboxItem(name));
      return items;
    }, "list inbox");
  }

  private checkInboxName(name: string): string {
    if (typeof name !== "string" || name.trim() === "") throw new ValidationError("inbox name is required");
    const normalized = toPosix(name);
    if (normalized.split("/").some((seg) => seg === "..") || path.isAbsolute(name) || /^[a-zA-Z]:/.test(name)) {
      throw new ValidationError("inbox name must be a path inside inbox/");
    }
    return normalized.replace(/^\/+/, "");
  }

  async inboxTake(
    name: string,
    opts: { title?: string; slug?: string; summary?: string },
    meta: WriteMeta,
  ): Promise<InboxTakeResult> {
    const cleanName = this.checkInboxName(name);
    return this.git.serialize(async () => {
      const inboxRel = `inbox/${cleanName}`;
      const inboxAbs = this.abs(inboxRel);
      const stat = await io(() => statOrNull(inboxAbs), `stat ${inboxRel}`);
      if (!stat || !stat.isFile()) throw new NotFoundError(`inbox item ${cleanName}`);
      const base = path.posix.basename(cleanName);

      if (await io(() => this.isTextFile(inboxAbs, base), `read ${inboxRel}`)) {
        const title = opts.title ?? base.replace(/\.[^.]+$/, "");
        if (typeof title !== "string" || title.trim() === "") throw new ValidationError("title must be a non-empty string");
        const slug = opts.slug ?? slugify(title);
        if (!isValidSlug(slug)) throw new ValidationError(`slug "${slug}" must match /^[a-z0-9]+(-[a-z0-9]+)*$/`);
        if (slug === ROOT_HUB_SLUG) throw new ValidationError(`slug "${ROOT_HUB_SLUG}" is reserved for the root hub`);
        if (await io(() => this.locate(slug), `locate ${slug}`)) throw new ValidationError(`slug ${slug} already exists`);
        const summary = opts.summary ?? "Unprocessed source. Read it and update this summary.";
        if (typeof summary !== "string" || summary.trim() === "") throw new ValidationError("summary must be a non-empty string");
        const tooLong = summaryLengthProblem(summary);
        if (tooLong) throw new ValidationError(tooLong);

        const rel = `sources/${slug}.md`;
        const d = today();
        const fm: Frontmatter = { title, type: "source", summary, tags: [], created: d, updated: d };
        await io(async () => {
          const text = await fs.readFile(inboxAbs, "utf8");
          await fs.writeFile(this.abs(rel), serializeNote(fm, text), "utf8");
          await fs.unlink(inboxAbs);
        }, `take ${inboxRel}`);
        await this.git.commit(`${meta.tool}: take inbox ${cleanName} -> ${slug}`, [rel, inboxRel]);
        return { kind: "source", note: await this.readNote(rel) };
      }

      const filePath = await io(async () => {
        const target = await this.freeName(path.join(this.root, "files"), base);
        await fs.rename(inboxAbs, path.join(this.root, "files", target));
        return `files/${target}`;
      }, `take ${inboxRel}`);
      await this.git.commit(`${meta.tool}: take inbox ${cleanName} -> ${filePath}`, [filePath, inboxRel]);
      return { kind: "file", filePath };
    });
  }

  /** First of base, base-1, base-2, ... (suffix before the extension) that does not exist in `dir`. */
  private async freeName(dir: string, base: string): Promise<string> {
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    let candidate = base;
    for (let i = 1; await statOrNull(path.join(dir, candidate)); i++) {
      candidate = `${stem}-${i}${ext}`;
    }
    return candidate;
  }

  async inboxAdd(name: string, content: string): Promise<InboxItem> {
    const raw = typeof name === "string" ? name : "";
    let safe = raw
      .split(/[\\/]/)
      .pop()!
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.\-]+/, "")
      .replace(/-+$/, "");
    if (!safe || safe === "." || safe === "..") safe = "untitled";
    if (!path.extname(safe)) safe = `${safe}.md`;
    return io(async () => {
      const dir = path.join(this.root, "inbox");
      await fs.mkdir(dir, { recursive: true });
      const final = await this.freeName(dir, safe);
      await fs.writeFile(path.join(dir, final), content ?? "", "utf8");
      return this.inboxItem(final);
    }, `add inbox ${safe}`);
  }

  // ---- files --------------------------------------------------------------

  async files(): Promise<FileEntry[]> {
    return io(async () => {
      const dir = path.join(this.root, "files");
      const out: FileEntry[] = [];
      for (const rel of await walk(dir)) {
        const stat = await fs.stat(path.join(dir, ...rel.split("/")));
        out.push({ path: `files/${rel}`, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, ext: extOf(rel) });
      }
      return out;
    }, "list files");
  }

  // ---- integrity ----------------------------------------------------------

  async checkLinks(): Promise<StoreLinkReport> {
    const notes: Note[] = [];
    const report: StoreLinkReport = { brokenLinks: [], missingFiles: [], missingSources: [], invalidNotes: [] };
    for await (const item of this.readAll()) {
      if ("error" in item) report.invalidNotes.push(item);
      else notes.push(item);
    }
    const slugs = new Set(notes.map((n) => n.slug));
    for (const n of notes) {
      for (const to of n.links) if (!slugs.has(to)) report.brokenLinks.push({ from: n.slug, to });
      for (const source of n.frontmatter.sources ?? []) {
        if (!slugs.has(source)) report.missingSources.push({ from: n.slug, source });
      }
      for (const file of n.frontmatter.files ?? []) {
        let ok = false;
        try {
          ok = (await statOrNull(this.resolve(file))) !== null;
        } catch {
          ok = false;
        }
        if (!ok) report.missingFiles.push({ from: n.slug, file });
      }
    }
    return report;
  }

  /** Commit subjects, newest first. Exposed for tests and diagnostics. */
  gitLog(): Promise<string[]> {
    return this.git.serialize(() => this.git.log());
  }
}
