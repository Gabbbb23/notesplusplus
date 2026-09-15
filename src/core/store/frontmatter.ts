import matter from "gray-matter";
import { Document, type YAMLSeq } from "yaml";
import { NOTE_TYPES, SUMMARY_MAX_CHARS, summaryLengthProblem } from "../contract/index.ts";
import { ValidationError, type Frontmatter, type NoteType } from "../types.ts";
import { isValidSlug } from "./slug.ts";

// The note types and the summary limit are contract rules; strict writes here enforce the same ones.
export { NOTE_TYPES, SUMMARY_MAX_CHARS, summaryLengthProblem };
export type { FrontmatterInput } from "../types.ts";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParsedFile {
  /** Raw frontmatter data with Dates normalized to YYYY-MM-DD strings. Not validated. */
  data: Record<string, unknown>;
  /** Everything after the closing delimiter. Empty string when there is no frontmatter block. */
  body: string;
  hasFrontmatter: boolean;
}

/** Turn a Date (from the YAML parser) into YYYY-MM-DD; leave everything else alone. */
function normalizeDate(v: unknown): unknown {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : v;
}

/**
 * Split a markdown file into frontmatter and body. Throws a ValidationError on YAML that does not parse.
 * gray-matter turns unquoted dates into Date objects; created/updated are normalized back to strings.
 */
export function parseFrontmatter(raw: string): ParsedFile {
  let parsed: { data: Record<string, unknown>; content: string; matter?: string; isEmpty?: boolean };
  try {
    // Passing an options object bypasses gray-matter's global cache, so parsing never leaks memory or shares objects.
    parsed = matter(raw, {}) as unknown as typeof parsed;
  } catch (err) {
    throw new ValidationError(`frontmatter is not valid YAML: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
  const hasFrontmatter = raw.startsWith("---") && (typeof parsed.matter === "string" || parsed.isEmpty === true);
  const src = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : {};
  const data: Record<string, unknown> = { ...src };
  if ("created" in data) data.created = normalizeDate(data.created);
  if ("updated" in data) data.updated = normalizeDate(data.updated);
  return { data, body: parsed.content, hasFrontmatter };
}

export interface ValidateOptions {
  /** When given, every tag must be in this set. Omit on read (loose) and pass on write (strict). */
  knownTags?: ReadonlySet<string>;
  /** Require created/updated to be present. True on read, false on write (the store fills them). */
  requireDates?: boolean;
  /** Reject a summary longer than SUMMARY_MAX_CHARS. Omit on read (loose) and pass true on write (strict). */
  limitSummary?: boolean;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Check a frontmatter object and return it typed. Throws one ValidationError listing every problem.
 * Unknown extra fields are dropped (the field set is fixed by DECISIONS.md).
 */
export function validateFrontmatter(data: unknown, opts: ValidateOptions = {}): Frontmatter {
  const problems: string[] = [];
  const d = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  if (!data || typeof data !== "object" || Array.isArray(data)) problems.push("frontmatter block is missing");

  const title = d.title;
  if (typeof title !== "string" || title.trim() === "") problems.push("title must be a non-empty string");

  const type = d.type;
  if (typeof type !== "string" || !NOTE_TYPES.includes(type as NoteType)) {
    problems.push(`type must be one of ${NOTE_TYPES.join(", ")}`);
  }

  const summary = d.summary;
  if (typeof summary !== "string" || summary.trim() === "") {
    problems.push("summary must be a non-empty string");
  } else if (opts.limitSummary) {
    const tooLong = summaryLengthProblem(summary);
    if (tooLong) problems.push(tooLong);
  }

  const tags = d.tags;
  if (!isStringArray(tags)) {
    problems.push("tags must be an array of strings");
  } else if (opts.knownTags) {
    const unknown = tags.filter((t) => !opts.knownTags!.has(t));
    if (unknown.length) problems.push(`unknown tags: ${unknown.join(", ")}. Create them with createTag first.`);
  }

  for (const key of ["created", "updated"] as const) {
    const v = d[key];
    if (v === undefined || v === null) {
      if (opts.requireDates) problems.push(`${key} is required (YYYY-MM-DD)`);
    } else if (typeof v !== "string" || !DATE_RE.test(v)) {
      problems.push(`${key} must be a YYYY-MM-DD string`);
    }
  }

  const sources = d.sources;
  if (sources !== undefined && sources !== null) {
    if (!isStringArray(sources)) problems.push("sources must be an array of slugs");
    else {
      const bad = sources.filter((s) => !isValidSlug(s));
      if (bad.length) problems.push(`sources contains invalid slugs: ${bad.join(", ")}`);
    }
  }

  const files = d.files;
  if (files !== undefined && files !== null) {
    if (!isStringArray(files)) problems.push("files must be an array of brain-relative paths");
    else {
      const bad = files.filter((f) => !f.startsWith("files/") || f.length <= "files/".length);
      if (bad.length) problems.push(`files entries must start with "files/": ${bad.join(", ")}`);
    }
  }

  if (problems.length) throw new ValidationError(problems.join("; "));

  const fm: Frontmatter = {
    title: title as string,
    type: type as NoteType,
    summary: summary as string,
    tags: [...(tags as string[])],
    created: (d.created as string | undefined) ?? "",
    updated: (d.updated as string | undefined) ?? "",
  };
  if (isStringArray(sources) && sources.length) fm.sources = [...sources];
  if (isStringArray(files) && files.length) fm.files = [...files];
  return fm;
}

/**
 * Render frontmatter + body as a file. Field order is fixed; sources/files are omitted when empty.
 * Lists are written in flow style ([a, b]). Dates are plain YYYY-MM-DD scalars.
 */
export function serializeNote(fm: Frontmatter, body: string): string {
  const ordered: Record<string, unknown> = {
    title: fm.title,
    type: fm.type,
    summary: fm.summary,
    tags: fm.tags,
    created: fm.created,
    updated: fm.updated,
  };
  if (fm.sources && fm.sources.length) ordered.sources = fm.sources;
  if (fm.files && fm.files.length) ordered.files = fm.files;

  const doc = new Document(ordered);
  for (const key of ["tags", "sources", "files"]) {
    const node = doc.get(key, true) as YAMLSeq | undefined;
    if (node && "items" in node) node.flow = true;
  }
  const yamlText = doc.toString({ lineWidth: 0 });
  return `---\n${yamlText}---\n${body}`;
}
