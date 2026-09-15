/**
 * Every REST request and response shape, in the order docs/rest-api.md lists the routes.
 *
 * Request schemas carry the rules from rules.ts and are what the REST adapter parses. Query-string schemas also turn
 * the strings into values and fill in defaults. Response schemas are strict: a field the server sends that is not
 * here, or one it stops sending, fails the response-shape tests in test/api.test.ts. Nothing parses responses at
 * runtime.
 */
import { z } from "zod";
import {
  NOTE_LIST_LIMIT,
  NOTE_TYPES,
  OFFSET,
  SEARCH_LIMIT,
  SEARCH_MODES,
  noteListLimitSchema,
  noteTypeSchema,
  offsetSchema,
  pinTargetSchema,
  requiredText,
  searchLimitSchema,
  searchModeSchema,
  slugSchema,
  summarySchema,
  tagNameSchema,
  type IntegerRange,
} from "./rules.ts";

// ---- query-string readers --------------------------------------------------------------------------------------

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

/** An integer parameter: absent or empty takes the range's default; anything else must be a number in the range. */
function queryInteger(schema: z.ZodNumber, range: IntegerRange) {
  return z.preprocess((value) => (value === undefined || value === "" ? range.default : Number(value)), schema);
}

/** A text filter: empty counts as absent. */
const queryText = z.preprocess(emptyToUndefined, z.string().optional());

/** One of `values`, or absent when empty. The message names the parameter: "type must be one of note, hub, source". */
function queryEnum<const T extends readonly [string, ...string[]]>(name: string, values: T) {
  return z.preprocess(emptyToUndefined, z.enum(values, { error: `${name} must be one of ${values.join(", ")}` }).optional());
}

/** `true` or `false`. Absent, empty, or any other value leaves the option to its default. */
const queryFlag = z.preprocess((value) => (value === "true" ? true : value === "false" ? false : undefined), z.boolean().optional());

// ---- shared fields ---------------------------------------------------------------------------------------------

/** ISO date, YYYY-MM-DD. Not checked here: the store checks dates on write and reads files on disk loosely. */
const isoDate = z.string();

const tagFilter = z.string().optional().describe("Only notes carrying this tag.");
const typeFilter = noteTypeSchema.optional().describe("Only notes of this type.");

// ---- notes -----------------------------------------------------------------------------------------------------

export const frontmatterSchema = z.strictObject({
  title: z.string(),
  type: noteTypeSchema,
  /** One sentence an agent reads before deciding whether to open the note. */
  summary: z.string(),
  /** Every tag must exist in tags.yml. */
  tags: z.array(z.string()),
  created: isoDate,
  updated: isoDate,
  /** Slugs of source notes this note was derived from. */
  sources: z.array(z.string()).optional(),
  /** Paths relative to the brain root, e.g. "files/invoice.pdf". */
  files: z.array(z.string()).optional(),
});

/** Frontmatter as a write sends it: the summary limit applies, and the store fills in dates left out. */
export const frontmatterInputSchema = frontmatterSchema.extend({
  summary: summarySchema,
  created: isoDate.optional(),
  updated: isoDate.optional(),
});

/** The fields the store shows in lists and search results. Cheap to scan. */
export const noteSummarySchema = z.strictObject({
  slug: z.string(),
  /** Path relative to the brain root, e.g. "notes/ryzen-laptop-specs.md". */
  path: z.string(),
  title: z.string(),
  type: noteTypeSchema,
  summary: z.string(),
  tags: z.array(z.string()),
  created: isoDate,
  updated: isoDate,
});

/** `GET /api/notes/:slug`. */
export const noteSchema = noteSummarySchema.extend({
  frontmatter: frontmatterSchema,
  /** Markdown body without the frontmatter block. */
  body: z.string(),
  /** Full file contents as on disk. */
  raw: z.string(),
  /** Outgoing link targets (slugs), deduplicated, in order of first appearance. Never from code. */
  links: z.array(z.string()),
  /**
   * Mentions: drive-letter absolute paths the body writes as inline code outside a markdown link, exactly as written,
   * deduplicated, in order of first appearance. The web view gives these spans Open and Show in folder.
   */
  mentions: z.array(z.string()),
  /** File modification time, used for the write-conflict check. */
  mtimeMs: z.number(),
});

/**
 * A file on disk under notes/ or sources/ that failed to parse or validate. Indexed loosely, reported, never crashed on.
 * check-links also reports a malformed pins.yml this way.
 */
export const invalidNoteSchema = z.strictObject({
  path: z.string(),
  error: z.string(),
});

/** Which notes a list holds. */
export const listFilterSchema = z.object({ tag: tagFilter, type: typeFilter });

/** One page of the note list, as a caller asks for it. Omitted limit and offset take the defaults. */
export const noteListOptionsSchema = listFilterSchema.extend({
  limit: noteListLimitSchema.optional(),
  offset: offsetSchema.optional().describe("How many notes to skip, for the next page. Default 0."),
});

/** `GET /api/notes?tag=&type=&limit=&offset=`. */
export const noteListQuerySchema = z.object({
  tag: queryText,
  type: queryEnum("type", NOTE_TYPES),
  limit: queryInteger(noteListLimitSchema, NOTE_LIST_LIMIT),
  offset: queryInteger(offsetSchema, OFFSET),
});

/** One page of `GET /api/notes`. */
export const notePageSchema = z.strictObject({
  items: z.array(noteSummarySchema),
  /** Every note matching the filters, across all pages. */
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/** `POST /api/notes`, and `PUT /api/notes/:slug` with the slug taken from the path. */
export const writeNoteInputSchema = z.object({
  /** Omit to derive from title. */
  slug: slugSchema.optional(),
  frontmatter: frontmatterInputSchema,
  body: z.string(),
  /**
   * If set, the write fails with a ConflictError when the file on disk has a different mtime.
   * Omit for a blind create-or-replace.
   */
  expectedMtimeMs: z.number().optional(),
});

/** `POST /api/notes/:slug/rename`. */
export const renameInputSchema = z.object({ newSlug: slugSchema });

export const renameResultSchema = z.strictObject({
  note: noteSchema,
  /** Slugs of notes whose wikilinks or sources lists were rewritten. */
  rewritten: z.array(z.string()),
});

/** One hub in a note's breadcrumb trail. */
export const trailHubSchema = z.strictObject({
  slug: z.string(),
  title: z.string(),
});

/** `GET /api/notes/:slug/trail`: where a note sits under the root hub `index`. */
export const noteTrailSchema = z.strictObject({
  /**
   * Hubs from `index` down to the hub that links directly to the note, root first. Never includes the note.
   * The shortest chain of hub links wins; on a tie, the hub linked first wins. Empty for `index` itself.
   */
  trail: z.array(trailHubSchema),
  /** False when no chain of hubs from `index` reaches the note, or `index` does not exist. */
  inHub: z.boolean(),
});

/**
 * `GET /api/notes/:slug/export.md`: the note file's bytes exactly as stored, frontmatter included, sent as
 * `attachment; filename="<slug>.md"`.
 */
export const MARKDOWN_EXPORT_TYPE = "text/markdown; charset=utf-8";

/**
 * `GET /api/notes/:slug/export.pdf`: the web UI's print page for the note, printed to A4 by headless Microsoft Edge,
 * sent as an attachment named by `pdfExportFileName`. Fails with 503 pdf_unavailable, 504 export_timeout, or 500
 * export_failed.
 */
export const PDF_EXPORT_TYPE = "application/pdf";

// ---- search ----------------------------------------------------------------------------------------------------

/** What `Brain.search` takes. Each option except `limit` is also a `GET /api/search` parameter and an MCP search input. */
export const searchOptionsSchema = z.object({
  /** How many results to return, best first. REST and MCP cap theirs at SEARCH_LIMIT; the server asks for one more. */
  limit: z.number().int().min(1).optional(),
  tag: tagFilter,
  type: typeFilter,
  mode: searchModeSchema.optional().describe("hybrid (default), keyword (FTS only), or semantic (embeddings only)."),
  includeFiles: z.boolean().optional().describe("Include files in the results. Default true; false searches notes only."),
});

/**
 * `GET /api/search?q=&limit=&tag=&type=&mode=&files=`, read into the page size and the options for `Brain.search`.
 * `files` is the REST name of `includeFiles`; every other option keeps its name.
 */
export const searchQuerySchema = z
  .object({
    q: requiredText("q"),
    limit: queryInteger(searchLimitSchema, SEARCH_LIMIT),
    tag: queryText,
    type: queryEnum("type", NOTE_TYPES),
    mode: queryEnum("mode", SEARCH_MODES),
    files: queryFlag,
  })
  .transform(({ q, limit, files, ...rest }) => ({
    q,
    limit,
    options: { ...rest, includeFiles: files } satisfies z.infer<typeof searchOptionsSchema>,
  }));

/** The `GET /api/search` parameters for a query and its options: what searchQuerySchema reads back. */
export function searchQueryParams(
  q: string,
  { includeFiles, ...rest }: z.infer<typeof searchOptionsSchema>,
): Record<string, string | number | boolean | undefined> {
  return { q, ...rest, files: includeFiles };
}

export const searchResultSchema = z.strictObject({
  kind: z.enum(["note", "file"]),
  /** Slug for notes, brain-relative path for files. */
  id: z.string(),
  path: z.string(),
  title: z.string(),
  /** Frontmatter summary for notes, empty for files. */
  summary: z.string(),
  /** A short excerpt around the best match. */
  snippet: z.string(),
  /** Higher is better. Comparable only within one result set. */
  score: z.number(),
  tags: z.array(z.string()),
  type: noteTypeSchema.optional(),
});

/** `GET /api/search`: the top `limit` results, and whether more exist past them. */
export const searchPageSchema = z.strictObject({
  results: z.array(searchResultSchema),
  hasMore: z.boolean(),
});

// ---- tags ------------------------------------------------------------------------------------------------------

export const tagSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
});

/** A tag as `GET /api/tags` returns it. */
export const tagWithCountSchema = tagSchema.extend({
  /** Notes of every type (note, hub, source) carrying the tag. */
  count: z.number().int(),
});

/** `POST /api/tags`. */
export const createTagInputSchema = z.object({
  name: tagNameSchema,
  description: z.string(),
});

// ---- pins ------------------------------------------------------------------------------------------------------

/** What pins.yml holds: each target's pinned slugs, in the owner's order, each at most once. */
export const pinListsSchema = z.strictObject({
  home: z.array(z.string()),
  sidebar: z.array(z.string()),
});

/**
 * `GET /api/pins`, and the answer to every pin change: the pinned notes in pin order. A pinned slug with no note, or
 * whose file does not parse, is left out here and stays in pins.yml; check-links lists it in `missingPins`.
 */
export const pinnedNotesSchema = z.strictObject({
  home: z.array(noteSummarySchema),
  sidebar: z.array(noteSummarySchema),
});

/** `PUT /api/pins/:target` with `{ slug, pinned }`, the target taken from the path. */
export const setPinInputSchema = z.object({
  target: pinTargetSchema,
  slug: slugSchema,
  /** True appends the slug to the target's list, or keeps its place when already pinned. False removes it. */
  pinned: z.boolean(),
});

/** `PUT /api/pins/:target/order` with `{ slugs }`, the target taken from the path. */
export const reorderPinsInputSchema = z.object({
  target: pinTargetSchema,
  /** Every slug pinned to the target, each once, in the new order. Slugs with no note may be left out. */
  slugs: z.array(slugSchema),
});

// ---- inbox -----------------------------------------------------------------------------------------------------

export const inboxItemSchema = z.strictObject({
  /** Filename inside inbox/, may include subfolders. */
  name: z.string(),
  path: z.string(),
  sizeBytes: z.number(),
  mtimeMs: z.number(),
  /** True when the store can treat the contents as text and turn it into a source note. */
  isText: z.boolean(),
});

/** `POST /api/inbox`. */
export const inboxAddInputSchema = z.object({
  name: z.string(),
  content: z.string(),
});

/** How a text item becomes a source note. Each field has a default: the filename, a slug from the title, a stub. */
export const inboxTakeOptionsSchema = z.object({
  title: z.string().optional(),
  slug: slugSchema.optional(),
  summary: summarySchema.optional(),
});

/** `POST /api/inbox/take`. */
export const inboxTakeInputSchema = z.object({
  name: z.string(),
  ...inboxTakeOptionsSchema.shape,
});

export const inboxTakeResultSchema = z.strictObject({
  /** "source" when the item became a source note; "file" when it was moved to files/. */
  kind: z.enum(["source", "file"]),
  note: noteSchema.optional(),
  filePath: z.string().optional(),
});

// ---- files and paths -------------------------------------------------------------------------------------------

export const fileEntrySchema = z.strictObject({
  /** Path relative to the brain root, always starting with "files/". */
  path: z.string(),
  sizeBytes: z.number(),
  mtimeMs: z.number(),
  /** Lowercased extension without the dot, e.g. "pdf". */
  ext: z.string(),
});

/** `POST /api/open` and `POST /api/reveal`. Which paths are allowed is src/api/local-paths.ts's call. */
export const pathInputSchema = z.object({
  path: z.string(),
});

export const openResultSchema = z.strictObject({ opened: z.string() });
export const revealResultSchema = z.strictObject({ revealed: z.string() });

// ---- maintenance -----------------------------------------------------------------------------------------------

/** The problems `NoteStore.checkLinks` finds by reading every note file and pins.yml. */
export const storeLinkReportSchema = z.strictObject({
  brokenLinks: z.array(z.strictObject({ from: z.string(), to: z.string() })),
  missingFiles: z.array(z.strictObject({ from: z.string(), file: z.string() })),
  missingSources: z.array(z.strictObject({ from: z.string(), source: z.string() })),
  /** Also holds `{ path: "pins.yml", error }` when pins.yml is malformed and reads as no pins. */
  invalidNotes: z.array(invalidNoteSchema),
  /** Pinned slugs with no valid note, from either target, each once, sorted. */
  missingPins: z.array(z.string()),
});

/**
 * Hub membership, read from the index. Conventions put every note of type `note` in exactly one hub, so only those
 * are checked: hubs (the root hub included) and sources are never reported. A hub lists a note when its body links to
 * it; the root hub counts as a hub.
 */
export const hubMembershipReportSchema = z.strictObject({
  /** Notes of type `note` that no hub links to, sorted by slug. */
  notesWithoutHub: z.array(z.strictObject({ slug: z.string() })),
  /** Notes of type `note` that two or more hubs link to, sorted by slug, each with those hubs sorted by slug. */
  notesInSeveralHubs: z.array(z.strictObject({ slug: z.string(), hubs: z.array(z.string()) })),
});

/** `GET /api/check-links`. */
export const linkReportSchema = storeLinkReportSchema.extend(hubMembershipReportSchema.shape);

/** `GET /api/stats`: what the index holds. */
export const brainStatsSchema = z.strictObject({
  notes: z.number().int(),
  files: z.number().int(),
  invalid: z.number().int(),
});

/** `POST /api/reindex`. */
export const indexStatsSchema = brainStatsSchema.extend({
  durationMs: z.number(),
});

/** `GET /api/health`. */
export const healthSchema = z.strictObject({
  ok: z.literal(true),
  brainPath: z.string(),
});

// ---- errors ----------------------------------------------------------------------------------------------------

/**
 * `error.code` values. The status comes from `BrainError.status`: 400 validation, 403 forbidden, 404 not_found,
 * 409 conflict, 415 unsupported_media_type, 416 range_not_satisfiable, 422 invalid_note, 500 io, git, export_failed,
 * and internal, 503 pdf_unavailable, 504 export_timeout.
 */
export const ERROR_CODES = [
  "validation",
  "forbidden",
  "not_found",
  "conflict",
  "unsupported_media_type",
  "range_not_satisfiable",
  "invalid_note",
  "io",
  "git",
  "export_failed",
  "internal",
  "pdf_unavailable",
  "export_timeout",
] as const;

/** The body of every JSON error response. */
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(ERROR_CODES),
    message: z.string(),
  }),
});
