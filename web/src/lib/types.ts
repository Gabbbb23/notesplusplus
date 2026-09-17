// Mirrors src/core/types.ts (the data shapes only). Keep in sync when that file changes.
// Copied rather than imported so the web build never reaches outside web/.

export type NoteType = "note" | "hub" | "source";

/** How GET /api/notes orders a page: A to Z by title, or newest first by created or updated. */
export type NoteSort = "title" | "created" | "updated";

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

/** What the web UI needs to name a note and link to it: its menu, a pinned card, a sidebar link. */
export type NoteRef = Pick<NoteSummary, "slug" | "title" | "type">;

/** The two places a note can be pinned. */
export type PinTarget = "home" | "sidebar";

/** GET /api/pins, and the answer to every pin change: the pinned notes of each target in pin order. */
export interface PinnedNotes {
  home: NoteSummary[];
  sidebar: NoteSummary[];
}

export interface Note extends NoteSummary {
  frontmatter: Frontmatter;
  /** Markdown body without the frontmatter block. */
  body: string;
  /** Full file contents as on disk. */
  raw: string;
  /** Outgoing link targets (slugs), deduplicated, in order of first appearance. Never from code. */
  links: string[];
  /**
   * Absolute paths the body writes as inline code outside a link, exactly as written, deduplicated, in body order.
   * NoteBody gives exactly these spans View, Open, and Show in folder.
   */
  mentions: string[];
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

/** A tag as GET /api/tags returns it. */
export interface TagWithCount extends Tag {
  /** How many notes carry the tag. */
  count: number;
}

/** One page of GET /api/notes, ordered by the requested sort (title by default). */
export interface NoteListPage {
  items: NoteSummary[];
  /** Notes matching the filter across all pages. */
  total: number;
  /** The page size the server used: 100 by default, at most 500. */
  limit: number;
  offset: number;
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
  /** Notes of type note that no hub links to, sorted by slug. Hubs and sources are never listed. */
  notesWithoutHub: Array<{ slug: string }>;
  /** Notes of type note that two or more hubs link to, sorted by slug, with those hubs. */
  notesInSeveralHubs: Array<{ slug: string; hubs: string[] }>;
  /** Slugs pins.yml lists whose note no longer exists or does not parse. They stay pinned but show nowhere. */
  missingPins: string[];
}

/** One hub in a note's breadcrumb trail. */
export interface TrailHub {
  slug: string;
  title: string;
}

/** Where a note sits under the root hub `index`. */
export interface NoteTrail {
  /**
   * Hubs from `index` down to the hub that links directly to the note, root first. Never includes the note.
   * The shortest chain of hub links wins; on a tie, the hub linked first wins. Empty for `index` itself.
   */
  trail: TrailHub[];
  /** False when no chain of hubs from `index` reaches the note, or `index` does not exist. */
  inHub: boolean;
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

/** GET /api/search: the best `limit` results (1 to 100). */
export interface SearchResponse {
  results: SearchResult[];
  /** True when more results exist past the limit. */
  hasMore: boolean;
}

export interface IndexStats {
  notes: number;
  files: number;
  invalid: number;
  durationMs: number;
}
