/**
 * The rules a REST field follows: enums, the slug pattern, the summary and pin limits, and integer ranges with their defaults.
 * REST parsing, MCP tool inputs, and the store's strict write all take them from here, so none of them can hold a
 * different copy.
 *
 * A rule's refusal message names the field it checks ("limit must be ...", "summary must be ..."), so the REST error
 * reads the same whichever adapter refused the value.
 */
import { z } from "zod";

export const NOTE_TYPES = ["note", "hub", "source"] as const;
export const noteTypeSchema = z.enum(NOTE_TYPES);

export const SEARCH_MODES = ["hybrid", "keyword", "semantic"] as const;
export const searchModeSchema = z.enum(SEARCH_MODES);

/** Where a pin shows: on Home or in the sidebar. Each is its own ordered list in pins.yml. */
export const PIN_TARGETS = ["home", "sidebar"] as const;
export const pinTargetSchema = z.enum(PIN_TARGETS, { error: `target must be one of ${PIN_TARGETS.join(", ")}` });

/** Most pins one target holds. */
export const PINS_MAX = 50;

/** The refusal for a pin that would take a target past PINS_MAX. */
export function pinLimitProblem(target: string): string {
  return `${target} already holds ${PINS_MAX} pins, the most it can hold. Unpin one first.`;
}

/** Lowercase a-z0-9, hyphen-separated, no leading, trailing, or double hyphens. Note slugs and tag names follow it. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The refusal for a value that fails SLUG_RE. `noun` is what the value was meant to be: "slug", "tag name". */
export function slugProblem(noun: string, value: unknown): string {
  return `${noun} "${String(value)}" must match ${SLUG_RE}`;
}

const slugPattern = (noun: string) => z.string().regex(SLUG_RE, { error: (issue) => slugProblem(noun, issue.input) });

export const slugSchema = slugPattern("slug");
export const tagNameSchema = slugPattern("tag name");

/** Longest summary a write accepts, in code points after trimming. Files already on disk may be longer. */
export const SUMMARY_MAX_CHARS = 240;

/** The reason a summary is too long to write, or null when it fits in SUMMARY_MAX_CHARS. */
export function summaryLengthProblem(summary: string): string | null {
  // Spread counts code points, so an emoji is one character rather than two UTF-16 units.
  const chars = [...summary.trim()].length;
  if (chars <= SUMMARY_MAX_CHARS) return null;
  return `summary must be at most ${SUMMARY_MAX_CHARS} characters (got ${chars}). Name the one or two facts the note is about and leave lists of values to the body.`;
}

/** A summary as a write accepts it. Only the length is checked here; the store also refuses an empty one. */
export const summarySchema = z.string().check((ctx) => {
  const problem = summaryLengthProblem(ctx.value);
  if (problem) ctx.issues.push({ code: "custom", message: problem, input: ctx.value });
});

/** Longest name a PDF export gets before `.pdf`, in code points. */
export const EXPORT_NAME_MAX_CHARS = 120;

/** Characters Windows does not allow in a file name, and control characters. */
const FILE_NAME_FORBIDDEN_RE = /[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/g;

/**
 * The file name of a note's PDF export: the title with whitespace collapsed to single spaces, without the characters
 * Windows forbids in file names (`\ / : * ? " < > |` and control characters), cut to EXPORT_NAME_MAX_CHARS, then
 * `.pdf`. A title with nothing left uses `fallback`, the slug.
 */
export function pdfExportFileName(title: string, fallback: string): string {
  const cleaned = title.replace(/\s+/g, " ").replace(FILE_NAME_FORBIDDEN_RE, "").replace(/ {2,}/g, " ").trim();
  const name = [...cleaned].slice(0, EXPORT_NAME_MAX_CHARS).join("").trim();
  return `${name || fallback}.pdf`;
}

/** An integer range. `default` is what REST uses when the request leaves the value out. */
export interface IntegerRange {
  min: number;
  max?: number;
  default: number;
}

/** `limit` for `GET /api/notes`. */
export const NOTE_LIST_LIMIT = { min: 1, max: 500, default: 100 } as const satisfies IntegerRange;
/** `limit` for `GET /api/search`. The server asks the index for one more to answer `hasMore`. */
export const SEARCH_LIMIT = { min: 1, max: 100, default: 20 } as const satisfies IntegerRange;
/** `offset` for `GET /api/notes`. */
export const OFFSET = { min: 0, default: 0 } as const satisfies IntegerRange;

function integerIn(name: string, range: IntegerRange) {
  const error =
    range.max === undefined ? `${name} must be an integer of ${range.min} or more` : `${name} must be an integer from ${range.min} to ${range.max}`;
  const atLeast = z.number({ error }).int({ error }).min(range.min, { error });
  return range.max === undefined ? atLeast : atLeast.max(range.max, { error });
}

export const noteListLimitSchema = integerIn("limit", NOTE_LIST_LIMIT);
export const searchLimitSchema = integerIn("limit", SEARCH_LIMIT);
export const offsetSchema = integerIn("offset", OFFSET);

/** Text that must hold something besides whitespace. The message names the field: "q is required". */
export function requiredText(name: string) {
  const error = `${name} is required`;
  return z.string({ error }).refine((s) => s.trim() !== "", { error });
}
