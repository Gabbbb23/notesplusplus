/**
 * Shared contracts for notesplusplus.
 *
 * Every module (store, index, api, web, mcp) builds against these types.
 * Change them only with care: four modules depend on them.
 *
 * Brain repo layout (BRAIN_PATH):
 *   notes/<slug>.md      type: note | hub   (notes/index.md is the root hub)
 *   sources/<slug>.md    type: source        raw material kept verbatim, with a frontmatter header
 *   files/**             attachments (pdf, docx, pptx, xlsx, images, anything)
 *   inbox/**             raw material dropped by the owner, waiting for the agent
 *   tags.yml             tag registry: list of { name, description }
 *   .git                 auto-committed on every write
 *
 * A slug is unique across notes/ and sources/. Wikilinks are [[slug]] or [[slug|label]].
 */

export type NoteType = "note" | "hub" | "source";

/** ISO date, YYYY-MM-DD. */
export type IsoDate = string;

export interface Frontmatter {
  title: string;
  type: NoteType;
  /** One sentence an agent reads before deciding whether to open the note. */
  summary: string;
  /** Every tag must exist in tags.yml. */
  tags: string[];
  created: IsoDate;
  updated: IsoDate;
  /** Slugs of source notes this note was derived from. */
  sources?: string[];
  /** Paths relative to the brain root, e.g. "files/invoice.pdf". */
  files?: string[];
}

/** The fields the store shows in lists and search results. Cheap to scan. */
export interface NoteSummary {
  slug: string;
  /** Path relative to the brain root, e.g. "notes/ryzen-laptop-specs.md". */
  path: string;
  title: string;
  type: NoteType;
  summary: string;
  tags: string[];
  created: IsoDate;
  updated: IsoDate;
}

export interface Note extends NoteSummary {
  frontmatter: Frontmatter;
  /** Markdown body without the frontmatter block. */
  body: string;
  /** Full file contents as on disk. */
  raw: string;
  /** Outgoing wikilink targets (slugs), deduplicated, in order of first appearance. */
  links: string[];
  /** File modification time, used for the write-conflict check. */
  mtimeMs: number;
}

/** A file on disk under notes/ or sources/ that failed to parse or validate. Indexed loosely, reported, never crashed on. */
export interface InvalidNote {
  path: string;
  error: string;
}

export interface Tag {
  name: string;
  description: string;
}

export interface InboxItem {
  /** Filename inside inbox/, may include subfolders. */
  name: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  /** True when the store can treat the contents as text and turn it into a source note. */
  isText: boolean;
}

export interface FileEntry {
  /** Path relative to the brain root, always starting with "files/". */
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  /** Lowercased extension without the dot, e.g. "pdf". */
  ext: string;
}

export interface LinkReport {
  brokenLinks: Array<{ from: string; to: string }>;
  missingFiles: Array<{ from: string; file: string }>;
  missingSources: Array<{ from: string; source: string }>;
  invalidNotes: InvalidNote[];
}

/** Who performed a write. Goes in the git commit message as "<tool>: <action> <slug>". */
export interface WriteMeta {
  tool: string;
}

export interface WriteNoteInput {
  /** Omit to derive from title. Must match /^[a-z0-9]+(-[a-z0-9]+)*$/ if given. */
  slug?: string;
  frontmatter: Omit<Frontmatter, "created" | "updated"> & Partial<Pick<Frontmatter, "created" | "updated">>;
  body: string;
  /**
   * If set, the write fails with a ConflictError when the file on disk has a different mtime.
   * Omit for a blind create-or-replace.
   */
  expectedMtimeMs?: number;
}

export interface RenameResult {
  note: Note;
  /** Slugs of notes whose wikilinks or sources lists were rewritten. */
  rewritten: string[];
}

export interface InboxTakeResult {
  /** "source" when the item became a source note; "file" when it was moved to files/. */
  kind: "source" | "file";
  note?: Note;
  filePath?: string;
}

export interface ListFilter {
  tag?: string;
  type?: NoteType;
}

/**
 * The file store. Owns everything on disk in the brain repo and the git history.
 * Never touches SQLite.
 */
export interface NoteStore {
  readonly root: string;
  /** Create the folder layout, tags.yml, notes/index.md, and the git repo if missing. Idempotent. */
  init(): Promise<void>;

  list(filter?: ListFilter): Promise<NoteSummary[]>;
  get(slug: string): Promise<Note | null>;
  /** Yield every parseable note and every invalid file. Used by the indexer. */
  readAll(): AsyncIterable<Note | InvalidNote>;

  /** Create or replace. Validates frontmatter, tags, and slug. Sets updated (and created on first write). Commits. */
  write(input: WriteNoteInput, meta: WriteMeta): Promise<Note>;
  /** Move the file and rewrite [[oldSlug]] and sources entries across the store. Commits once. */
  rename(oldSlug: string, newSlug: string, meta: WriteMeta): Promise<RenameResult>;
  delete(slug: string, meta: WriteMeta): Promise<void>;

  tags(): Promise<Tag[]>;
  createTag(tag: Tag, meta: WriteMeta): Promise<Tag>;

  inboxList(): Promise<InboxItem[]>;
  /**
   * Take an inbox item. Text items become a source note in sources/ with the raw contents as the body,
   * a frontmatter header, and the given title (default: the filename). Other items move to files/.
   * The original is removed from inbox/. Commits.
   */
  inboxTake(name: string, opts: { title?: string; slug?: string; summary?: string }, meta: WriteMeta): Promise<InboxTakeResult>;
  /** Write text into inbox/ as a new file. Used by the web UI drop box. Not committed. */
  inboxAdd(name: string, content: string): Promise<InboxItem>;

  files(): Promise<FileEntry[]>;
  /** Absolute path for a brain-relative path, refusing anything outside the root. */
  resolve(relativePath: string): string;

  checkLinks(): Promise<LinkReport>;
}

export type SearchMode = "hybrid" | "keyword" | "semantic";

export interface SearchOptions {
  limit?: number;
  tag?: string;
  type?: NoteType;
  /** Default "hybrid". */
  mode?: SearchMode;
  /** Include file contents in results. Default true. */
  includeFiles?: boolean;
}

export interface SearchResult {
  kind: "note" | "file";
  /** Slug for notes, brain-relative path for files. */
  id: string;
  path: string;
  title: string;
  /** Frontmatter summary for notes, empty for files. */
  summary: string;
  /** A short excerpt around the best match. */
  snippet: string;
  /** Higher is better. Comparable only within one result set. */
  score: number;
  tags: string[];
  type?: NoteType;
}

export interface IndexStats {
  notes: number;
  files: number;
  invalid: number;
  durationMs: number;
}

/**
 * The search index. A rebuildable SQLite cache over the store: FTS5 for keywords,
 * local embeddings for semantic search, link table for backlinks.
 * Never writes to the brain repo.
 */
export interface SearchIndex {
  open(): Promise<void>;
  close(): Promise<void>;
  /** Drop everything and index the whole store. */
  rebuild(store: NoteStore): Promise<IndexStats>;

  upsertNote(note: Note): Promise<void>;
  removeNote(slug: string): Promise<void>;
  upsertFile(file: FileEntry, absolutePath: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  recordInvalid(invalid: InvalidNote): Promise<void>;

  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  backlinks(slug: string): Promise<NoteSummary[]>;
  invalid(): Promise<InvalidNote[]>;
  stats(): Promise<Omit<IndexStats, "durationMs">>;
}

/**
 * The facade the API, web UI, and MCP server use. Composes store and index so a write
 * always updates both. This is the only thing the outer layers import.
 */
export interface Brain {
  readonly store: NoteStore;
  readonly index: SearchIndex;

  init(): Promise<void>;
  reindex(): Promise<IndexStats>;

  list(filter?: ListFilter): Promise<NoteSummary[]>;
  get(slug: string): Promise<Note | null>;
  write(input: WriteNoteInput, meta: WriteMeta): Promise<Note>;
  rename(oldSlug: string, newSlug: string, meta: WriteMeta): Promise<RenameResult>;
  delete(slug: string, meta: WriteMeta): Promise<void>;

  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  backlinks(slug: string): Promise<NoteSummary[]>;

  tags(): Promise<Tag[]>;
  createTag(tag: Tag, meta: WriteMeta): Promise<Tag>;

  inboxList(): Promise<InboxItem[]>;
  inboxTake(name: string, opts: { title?: string; slug?: string; summary?: string }, meta: WriteMeta): Promise<InboxTakeResult>;
  inboxAdd(name: string, content: string): Promise<InboxItem>;

  files(): Promise<FileEntry[]>;
  checkLinks(): Promise<LinkReport>;
  stats(): Promise<Omit<IndexStats, "durationMs">>;
}

/** Thrown by the store. `status` maps directly to an HTTP status in the API layer. */
export class BrainError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BrainError";
  }
}

export class NotFoundError extends BrainError {
  constructor(what: string) {
    super(`${what} not found`, 404, "not_found");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends BrainError {
  constructor(message: string) {
    super(message, 400, "validation");
    this.name = "ValidationError";
  }
}

export class ConflictError extends BrainError {
  constructor(message: string) {
    super(message, 409, "conflict");
    this.name = "ConflictError";
  }
}
