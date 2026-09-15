/**
 * Shared contracts for notesplusplus.
 *
 * Every module (store, index, api, mcp) builds against these types. The data types are inferred from the zod schemas
 * in src/core/contract, the REST contract's one source of truth, so a field is declared once. The interfaces below
 * describe modules (NoteStore, SearchIndex, Brain) and use those data types.
 *
 * Brain repo layout (BRAIN_PATH):
 *   notes/<slug>.md      type: note | hub   (notes/index.md is the root hub)
 *   sources/<slug>.md    type: source        raw material kept verbatim, with a frontmatter header
 *   files/**             attachments (pdf, docx, pptx, xlsx, images, anything)
 *   inbox/**             raw material dropped by the owner, waiting for the agent
 *   tags.yml             tag registry: list of { name, description }
 *   .git                 auto-committed on every write
 *
 * A slug is unique across notes/ and sources/. Links are [[slug]] or [[slug|label]]; src/core/graph/note-body.ts
 * decides what a body links to and mentions.
 */
import type { z } from "zod";
import type * as contract from "./contract/index.ts";

export type NoteType = z.infer<typeof contract.noteTypeSchema>;
export type SearchMode = z.infer<typeof contract.searchModeSchema>;

/** ISO date, YYYY-MM-DD. */
export type IsoDate = string;

export type Frontmatter = z.infer<typeof contract.frontmatterSchema>;
/** Frontmatter as it arrives on write: created and updated are optional. */
export type FrontmatterInput = z.infer<typeof contract.frontmatterInputSchema>;
export type NoteSummary = z.infer<typeof contract.noteSummarySchema>;
export type Note = z.infer<typeof contract.noteSchema>;
export type InvalidNote = z.infer<typeof contract.invalidNoteSchema>;
export type Tag = z.infer<typeof contract.tagSchema>;
export type TagWithCount = z.infer<typeof contract.tagWithCountSchema>;
export type InboxItem = z.infer<typeof contract.inboxItemSchema>;
export type FileEntry = z.infer<typeof contract.fileEntrySchema>;
export type StoreLinkReport = z.infer<typeof contract.storeLinkReportSchema>;
export type HubMembershipReport = z.infer<typeof contract.hubMembershipReportSchema>;
export type LinkReport = z.infer<typeof contract.linkReportSchema>;
export type TrailHub = z.infer<typeof contract.trailHubSchema>;
export type NoteTrail = z.infer<typeof contract.noteTrailSchema>;
export type WriteNoteInput = z.infer<typeof contract.writeNoteInputSchema>;
export type RenameResult = z.infer<typeof contract.renameResultSchema>;
export type InboxTakeOptions = z.infer<typeof contract.inboxTakeOptionsSchema>;
export type InboxTakeResult = z.infer<typeof contract.inboxTakeResultSchema>;
export type ListFilter = z.infer<typeof contract.listFilterSchema>;
export type NoteListOptions = z.infer<typeof contract.noteListOptionsSchema>;
export type NotePage = z.infer<typeof contract.notePageSchema>;
export type SearchOptions = z.infer<typeof contract.searchOptionsSchema>;
export type SearchResult = z.infer<typeof contract.searchResultSchema>;
export type SearchPage = z.infer<typeof contract.searchPageSchema>;
export type BrainStats = z.infer<typeof contract.brainStatsSchema>;
export type IndexStats = z.infer<typeof contract.indexStatsSchema>;
export type ErrorEnvelope = z.infer<typeof contract.errorEnvelopeSchema>;

/** Who performed a write. Goes in the git commit message as "<tool>: <action> <slug>". Sent as the X-Brain-Tool header. */
export interface WriteMeta {
  tool: string;
}

/** The order of every note list: by title, then by slug when titles are equal, so pages never overlap or skip. */
export function compareSummaries(a: Pick<NoteSummary, "title" | "slug">, b: Pick<NoteSummary, "title" | "slug">): number {
  return a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug);
}

/**
 * The file store. Owns everything on disk in the brain repo and the git history.
 * Never touches SQLite.
 */
export interface NoteStore {
  readonly root: string;
  /** Create the folder layout, tags.yml, notes/index.md, and the git repo if missing. Idempotent. */
  init(): Promise<void>;

  /** Every valid note matching the filter, sorted by title, then by slug when titles are equal (`compareSummaries`). */
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
  inboxTake(name: string, opts: InboxTakeOptions, meta: WriteMeta): Promise<InboxTakeResult>;
  /** Write text into inbox/ as a new file. Used by the web UI drop box. Not committed. */
  inboxAdd(name: string, content: string): Promise<InboxItem>;

  files(): Promise<FileEntry[]>;
  /** Absolute path for a brain-relative path, refusing anything outside the root. */
  resolve(relativePath: string): string;

  checkLinks(): Promise<StoreLinkReport>;
}

/**
 * The search index. A rebuildable SQLite cache over the store: FTS5 for keywords,
 * local embeddings for semantic search, and the note graph (links in body order, mentions) for backlinks, trails,
 * hub membership, and the open-file allowlist. Never writes to the brain repo, and never reads note files after
 * `upsertNote` or `rebuild` has been given them.
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
  /** See `Brain.trail`. */
  trail(slug: string): Promise<NoteTrail | null>;
  /** See `Brain.isMentioned`. */
  isMentioned(absolutePath: string): Promise<boolean>;
  hubMembership(): Promise<HubMembershipReport>;
  invalid(): Promise<InvalidNote[]>;
  stats(): Promise<BrainStats>;
}

/**
 * The facade the API, web UI, and MCP server use. Composes store and index so a write
 * always updates both. This is the only thing the outer layers import, and the store and
 * index behind it are not reachable through it.
 */
export interface Brain {
  /** Absolute path of the brain repo. */
  readonly root: string;
  /**
   * Absolute path for a brain-relative path such as "files/invoice.pdf". Throws ValidationError for an
   * absolute path or one that escapes the root. Checks the path only; the file need not exist.
   */
  resolve(relativePath: string): string;

  /**
   * Create the folder layout and git repo if missing, then open the index. Call before anything else. Idempotent.
   * When the index holds no notes (first run, or a schema or model change emptied it), builds it from disk and
   * returns the stats of that build; otherwise returns null and leaves the index as it is.
   */
  init(): Promise<IndexStats | null>;
  /** Drop the index and build it again from the files on disk. */
  reindex(): Promise<IndexStats>;
  /**
   * Close the index. Until init() runs again, search, backlinks, stats, and reindex fail, and writes still
   * reach the store but log a missed index update.
   */
  close(): Promise<void>;

  /** Same notes and order as `NoteStore.list`. */
  list(filter?: ListFilter): Promise<NoteSummary[]>;
  get(slug: string): Promise<Note | null>;
  write(input: WriteNoteInput, meta: WriteMeta): Promise<Note>;
  rename(oldSlug: string, newSlug: string, meta: WriteMeta): Promise<RenameResult>;
  delete(slug: string, meta: WriteMeta): Promise<void>;

  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  backlinks(slug: string): Promise<NoteSummary[]>;
  /**
   * Where a note or source sits under the root hub, answered from the index without reading note files. Null when
   * the index holds no note with that slug. A hand edit on disk shows up only after reindex.
   */
  trail(slug: string): Promise<NoteTrail | null>;
  /**
   * Whether some note mentions this drive-letter absolute path, ignoring case, slash style, and a trailing separator
   * (`pathKey` in src/core/graph/drive-path.ts). One indexed lookup; reads no note files.
   */
  isMentioned(absolutePath: string): Promise<boolean>;

  tags(): Promise<Tag[]>;
  createTag(tag: Tag, meta: WriteMeta): Promise<Tag>;

  inboxList(): Promise<InboxItem[]>;
  inboxTake(name: string, opts: InboxTakeOptions, meta: WriteMeta): Promise<InboxTakeResult>;
  inboxAdd(name: string, content: string): Promise<InboxItem>;

  files(): Promise<FileEntry[]>;
  /** Broken links, missing files and sources, and invalid notes from the files on disk; hub membership from the index. */
  checkLinks(): Promise<LinkReport>;
  stats(): Promise<BrainStats>;
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

export class ForbiddenError extends BrainError {
  constructor(message: string) {
    super(message, 403, "forbidden");
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends BrainError {
  constructor(message: string) {
    super(message, 409, "conflict");
    this.name = "ConflictError";
  }
}
