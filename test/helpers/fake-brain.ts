import fs from "node:fs";
import path from "node:path";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  compareSummaries,
  type Brain,
  type FileEntry,
  type InboxItem,
  type InboxTakeResult,
  type IndexStats,
  type InvalidNote,
  type LinkReport,
  type ListFilter,
  type Note,
  type NoteStore,
  type NoteSummary,
  type RenameResult,
  type SearchIndex,
  type SearchOptions,
  type SearchResult,
  type Tag,
  type WriteMeta,
  type WriteNoteInput,
} from "../../src/core/types.ts";
import { summaryLengthProblem } from "../../src/core/store/frontmatter.ts";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WIKILINK = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractLinks(body: string): string[] {
  const out: string[] = [];
  // Ignore fenced blocks and inline code, like the real store does.
  const stripped = body.replace(/^(`{3,}|~{3,})[\s\S]*?^\1[ \t]*$/gm, "").replace(/(`+)[^`][\s\S]*?\1/g, "");
  for (const m of stripped.matchAll(WIKILINK)) {
    const s = m[1]!.trim();
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function summaryOf(n: Note): NoteSummary {
  const { slug, path, title, type, summary, tags, created, updated } = n;
  return { slug, path, title, type, summary, tags, created, updated };
}

/** A write the fake saw, with the meta the caller passed. Tests use this to check X-Brain-Tool. */
export interface RecordedWrite {
  action: string;
  slug: string;
  meta: WriteMeta;
}

/**
 * In-memory Brain for API tests. Holds notes, tags, inbox items, and file
 * entries in Maps. `root` is a real folder so /api/files/* can stream from disk.
 */
export class FakeBrain implements Brain {
  readonly notes = new Map<string, Note>();
  readonly tagList: Tag[] = [];
  readonly inbox = new Map<string, InboxItem & { content: string }>();
  readonly fileEntries: FileEntry[] = [];
  readonly invalidNotes: InvalidNote[] = [];
  readonly writes: RecordedWrite[] = [];
  /** Set a method name here to make its next call throw the given error. */
  readonly failures = new Map<string, Error>();
  reindexCalls = 0;

  readonly store: NoteStore;
  readonly index: SearchIndex;

  constructor(readonly root: string) {
    this.store = new FakeStore(this);
    this.index = new FakeIndex(this);
  }

  private fail(method: string): void {
    const err = this.failures.get(method);
    if (err) {
      this.failures.delete(method);
      throw err;
    }
  }

  // ---- seeding helpers ----

  addTag(name: string, description = ""): void {
    this.tagList.push({ name, description });
  }

  seed(input: WriteNoteInput & { slug: string; created?: string; updated?: string }): Note {
    const fm = input.frontmatter;
    const created = input.created ?? fm.created ?? "2026-09-01";
    const updated = input.updated ?? fm.updated ?? created;
    const dir = fm.type === "source" ? "sources" : "notes";
    const frontmatter = { ...fm, created, updated };
    const raw = `---\ntitle: ${fm.title}\n---\n${input.body}`;
    const note: Note = {
      slug: input.slug,
      path: `${dir}/${input.slug}.md`,
      title: fm.title,
      type: fm.type,
      summary: fm.summary,
      tags: fm.tags,
      created,
      updated,
      frontmatter,
      body: input.body,
      raw,
      links: extractLinks(input.body),
      mtimeMs: 1_700_000_000_000 + this.notes.size,
    };
    this.notes.set(input.slug, note);
    return note;
  }

  addFile(relPath: string, content: string | Buffer): FileEntry {
    const abs = path.join(this.root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    const stat = fs.statSync(abs);
    const entry: FileEntry = {
      path: relPath,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      ext: path.extname(relPath).slice(1).toLowerCase(),
    };
    this.fileEntries.push(entry);
    return entry;
  }

  // ---- Brain ----

  async init(): Promise<void> {}

  async reindex(): Promise<IndexStats> {
    this.fail("reindex");
    this.reindexCalls++;
    return { notes: this.notes.size, files: this.fileEntries.length, invalid: this.invalidNotes.length, durationMs: 3 };
  }

  /** Same order as the real store: title, then slug. */
  async list(filter?: ListFilter): Promise<NoteSummary[]> {
    this.fail("list");
    return [...this.notes.values()]
      .filter((n) => !filter?.tag || n.tags.includes(filter.tag))
      .filter((n) => !filter?.type || n.type === filter.type)
      .map(summaryOf)
      .sort(compareSummaries);
  }

  async get(slug: string): Promise<Note | null> {
    this.fail("get");
    return this.notes.get(slug) ?? null;
  }

  async write(input: WriteNoteInput, meta: WriteMeta): Promise<Note> {
    this.fail("write");
    const slug = input.slug ?? slugify(input.frontmatter.title);
    if (!SLUG_RE.test(slug)) throw new ValidationError(`bad slug: ${slug}`);
    const unknown = input.frontmatter.tags.filter((t) => !this.tagList.some((x) => x.name === t));
    if (unknown.length) throw new ValidationError(`unknown tags: ${unknown.join(", ")}`);
    const tooLong = summaryLengthProblem(input.frontmatter.summary);
    if (tooLong) throw new ValidationError(tooLong);
    const existing = this.notes.get(slug);
    if (input.expectedMtimeMs !== undefined && existing && existing.mtimeMs !== input.expectedMtimeMs) {
      throw new ConflictError(`${slug} changed on disk`);
    }
    this.writes.push({ action: "write", slug, meta });
    const note = this.seed({
      ...input,
      slug,
      created: existing?.created ?? input.frontmatter.created ?? today(),
      updated: today(),
    });
    note.mtimeMs = (existing?.mtimeMs ?? 1_700_000_000_000) + 1000;
    return note;
  }

  async rename(oldSlug: string, newSlug: string, meta: WriteMeta): Promise<RenameResult> {
    this.fail("rename");
    const note = this.notes.get(oldSlug);
    if (!note) throw new NotFoundError(`note ${oldSlug}`);
    if (!SLUG_RE.test(newSlug)) throw new ValidationError(`bad slug: ${newSlug}`);
    if (this.notes.has(newSlug)) throw new ConflictError(`${newSlug} already exists`);
    this.writes.push({ action: "rename", slug: oldSlug, meta });
    this.notes.delete(oldSlug);
    const dir = note.type === "source" ? "sources" : "notes";
    const renamed: Note = { ...note, slug: newSlug, path: `${dir}/${newSlug}.md` };
    this.notes.set(newSlug, renamed);
    const rewritten: string[] = [];
    for (const n of this.notes.values()) {
      if (n.slug === newSlug) continue;
      if (n.links.includes(oldSlug) || n.frontmatter.sources?.includes(oldSlug)) {
        const body = n.body.replace(new RegExp(`\\[\\[${oldSlug}(\\||\\]\\])`, "g"), `[[${newSlug}$1`);
        const sources = n.frontmatter.sources?.map((s) => (s === oldSlug ? newSlug : s));
        this.notes.set(n.slug, { ...n, body, links: extractLinks(body), frontmatter: { ...n.frontmatter, sources } });
        rewritten.push(n.slug);
      }
    }
    return { note: renamed, rewritten };
  }

  async delete(slug: string, meta: WriteMeta): Promise<void> {
    this.fail("delete");
    if (!this.notes.has(slug)) throw new NotFoundError(`note ${slug}`);
    this.writes.push({ action: "delete", slug, meta });
    this.notes.delete(slug);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    this.fail("search");
    const q = query.toLowerCase();
    const results: SearchResult[] = [];
    for (const n of this.notes.values()) {
      if (opts?.tag && !n.tags.includes(opts.tag)) continue;
      if (opts?.type && n.type !== opts.type) continue;
      const hay = `${n.title}\n${n.summary}\n${n.body}`;
      const at = hay.toLowerCase().indexOf(q);
      if (at === -1) continue;
      const start = Math.max(0, at - 30);
      const end = Math.min(hay.length, at + q.length + 30);
      const snippet = hay.slice(start, at) + "«" + hay.slice(at, at + q.length) + "»" + hay.slice(at + q.length, end);
      results.push({
        kind: "note",
        id: n.slug,
        path: n.path,
        title: n.title,
        summary: n.summary,
        snippet: snippet.replace(/\n/g, " "),
        score: 1,
        tags: n.tags,
        type: n.type,
      });
    }
    if (opts?.includeFiles !== false) {
      for (const f of this.fileEntries) {
        if (!f.path.toLowerCase().includes(q)) continue;
        results.push({ kind: "file", id: f.path, path: f.path, title: path.basename(f.path), summary: "", snippet: `«${f.path}»`, score: 0.5, tags: [] });
      }
    }
    return results.slice(0, opts?.limit ?? 20);
  }

  async backlinks(slug: string): Promise<NoteSummary[]> {
    this.fail("backlinks");
    return [...this.notes.values()].filter((n) => n.links.includes(slug)).map(summaryOf);
  }

  async tags(): Promise<Tag[]> {
    this.fail("tags");
    // The real store sorts the registry by name.
    return [...this.tagList].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createTag(tag: Tag, meta: WriteMeta): Promise<Tag> {
    this.fail("createTag");
    if (!SLUG_RE.test(tag.name)) throw new ValidationError(`bad tag name: ${tag.name}`);
    if (this.tagList.some((t) => t.name === tag.name)) throw new ConflictError(`tag ${tag.name} already exists`);
    this.writes.push({ action: "createTag", slug: tag.name, meta });
    this.tagList.push({ ...tag });
    return { ...tag };
  }

  async inboxList(): Promise<InboxItem[]> {
    this.fail("inboxList");
    return [...this.inbox.values()].map(({ content: _c, ...item }) => item);
  }

  async inboxTake(name: string, opts: { title?: string; slug?: string; summary?: string }, meta: WriteMeta): Promise<InboxTakeResult> {
    this.fail("inboxTake");
    const item = this.inbox.get(name);
    if (!item) throw new NotFoundError(`inbox item ${name}`);
    // Like the real store, the summary only matters when the item becomes a source note.
    const tooLong = item.isText && opts.summary !== undefined ? summaryLengthProblem(opts.summary) : null;
    if (tooLong) throw new ValidationError(tooLong);
    this.writes.push({ action: "inboxTake", slug: name, meta });
    this.inbox.delete(name);
    if (!item.isText) {
      const filePath = `files/${name}`;
      this.fileEntries.push({ path: filePath, sizeBytes: item.sizeBytes, mtimeMs: item.mtimeMs, ext: path.extname(name).slice(1) });
      return { kind: "file", filePath };
    }
    const title = opts.title ?? name;
    const slug = opts.slug ?? slugify(title);
    const note = this.seed({
      slug,
      frontmatter: { title, type: "source", summary: opts.summary ?? `Raw material from ${name}`, tags: [] },
      body: item.content,
    });
    return { kind: "source", note };
  }

  async inboxAdd(name: string, content: string): Promise<InboxItem> {
    this.fail("inboxAdd");
    if (name.includes("..") || path.isAbsolute(name)) throw new ValidationError(`bad inbox name: ${name}`);
    const item = {
      name,
      path: `inbox/${name}`,
      sizeBytes: Buffer.byteLength(content),
      mtimeMs: Date.now(),
      isText: true,
      content,
    };
    this.inbox.set(name, item);
    const { content: _c, ...out } = item;
    return out;
  }

  async files(): Promise<FileEntry[]> {
    this.fail("files");
    return [...this.fileEntries];
  }

  async checkLinks(): Promise<LinkReport> {
    this.fail("checkLinks");
    const report: LinkReport = { brokenLinks: [], missingFiles: [], missingSources: [], invalidNotes: [...this.invalidNotes] };
    for (const n of this.notes.values()) {
      for (const to of n.links) if (!this.notes.has(to)) report.brokenLinks.push({ from: n.slug, to });
      for (const file of n.frontmatter.files ?? []) {
        if (!this.fileEntries.some((f) => f.path === file)) report.missingFiles.push({ from: n.slug, file });
      }
      for (const source of n.frontmatter.sources ?? []) {
        if (!this.notes.has(source)) report.missingSources.push({ from: n.slug, source });
      }
    }
    return report;
  }

  async stats(): Promise<Omit<IndexStats, "durationMs">> {
    this.fail("stats");
    return { notes: this.notes.size, files: this.fileEntries.length, invalid: this.invalidNotes.length };
  }
}

class FakeStore implements NoteStore {
  constructor(private readonly brain: FakeBrain) {}

  get root(): string {
    return this.brain.root;
  }

  async init(): Promise<void> {}
  list(filter?: ListFilter) {
    return this.brain.list(filter);
  }
  get(slug: string) {
    return this.brain.get(slug);
  }
  async *readAll(): AsyncIterable<Note | InvalidNote> {
    yield* this.brain.notes.values();
    yield* this.brain.invalidNotes;
  }
  write(input: WriteNoteInput, meta: WriteMeta) {
    return this.brain.write(input, meta);
  }
  rename(oldSlug: string, newSlug: string, meta: WriteMeta) {
    return this.brain.rename(oldSlug, newSlug, meta);
  }
  delete(slug: string, meta: WriteMeta) {
    return this.brain.delete(slug, meta);
  }
  tags() {
    return this.brain.tags();
  }
  createTag(tag: Tag, meta: WriteMeta) {
    return this.brain.createTag(tag, meta);
  }
  inboxList() {
    return this.brain.inboxList();
  }
  inboxTake(name: string, opts: { title?: string; slug?: string; summary?: string }, meta: WriteMeta) {
    return this.brain.inboxTake(name, opts, meta);
  }
  inboxAdd(name: string, content: string) {
    return this.brain.inboxAdd(name, content);
  }
  files() {
    return this.brain.files();
  }

  /** Join under root and refuse anything that escapes it. Mirrors the real store's contract. */
  resolve(relativePath: string): string {
    if (path.isAbsolute(relativePath)) throw new ValidationError(`path must be relative: ${relativePath}`);
    const abs = path.resolve(this.root, relativePath);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new ValidationError(`path escapes the brain: ${relativePath}`);
    }
    return abs;
  }

  checkLinks() {
    return this.brain.checkLinks();
  }
}

class FakeIndex implements SearchIndex {
  constructor(private readonly brain: FakeBrain) {}
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  rebuild(_store: NoteStore) {
    return this.brain.reindex();
  }
  async upsertNote(_note: Note): Promise<void> {}
  async removeNote(_slug: string): Promise<void> {}
  async upsertFile(_file: FileEntry, _absolutePath: string): Promise<void> {}
  async removeFile(_path: string): Promise<void> {}
  async recordInvalid(invalid: InvalidNote): Promise<void> {
    this.brain.invalidNotes.push(invalid);
  }
  search(query: string, opts?: SearchOptions) {
    return this.brain.search(query, opts);
  }
  backlinks(slug: string) {
    return this.brain.backlinks(slug);
  }
  async invalid(): Promise<InvalidNote[]> {
    return [...this.brain.invalidNotes];
  }
  stats() {
    return this.brain.stats();
  }
}

/**
 * A fake brain with a temp root on disk, two tags, a root hub, a note, and a source.
 * Layout:
 *   index (hub) -> links [[ryzen-laptop-specs]]
 *   ryzen-laptop-specs (note) -> links [[laptop-transcript]], [[index]], sources [laptop-transcript], files [files/invoice.pdf]
 *   laptop-transcript (source)
 */
export function seededBrain(root: string): FakeBrain {
  const brain = new FakeBrain(root);
  brain.addTag("hardware", "Physical machines and parts");
  brain.addTag("laptop", "Portable computers");
  brain.seed({
    slug: "index",
    frontmatter: { title: "Index", type: "hub", summary: "Root hub of the brain.", tags: [] },
    body: "# Hubs\n\n- [[ryzen-laptop-specs|Laptop specs]]\n",
  });
  brain.seed({
    slug: "ryzen-laptop-specs",
    frontmatter: {
      title: "Ryzen laptop specs",
      type: "note",
      summary: "The laptop has a Ryzen 7 7735HS and an RTX 4050.",
      tags: ["hardware", "laptop"],
      sources: ["laptop-transcript"],
      files: ["files/invoice.pdf"],
    },
    body: "The CPU is a **Ryzen 7 7735HS**. See [[laptop-transcript]] and [[index|home]].\n\n`[[not-a-link]]` stays code.\n",
  });
  brain.seed({
    slug: "laptop-transcript",
    frontmatter: { title: "Laptop transcript", type: "source", summary: "Raw transcript about the laptop.", tags: ["laptop"] },
    body: "Speaker 1: the laptop has 16 GB RAM <b>bold</b> and a Ryzen chip.\n",
  });
  brain.addFile("files/invoice.pdf", "%PDF-1.4 fake invoice");
  return brain;
}
