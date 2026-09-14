import { ValidationError } from "../types.ts";

/** Lowercase, a-z0-9, hyphen-separated, no leading/trailing/double hyphens. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Unicode combining marks (U+0300 to U+036F), left behind by NFKD decomposition of accented letters. */
const COMBINING_MARKS_RE = new RegExp("[\\u0300-\\u036f]", "g");

export function isValidSlug(s: unknown): s is string {
  return typeof s === "string" && SLUG_RE.test(s);
}

/**
 * Derive a slug from a title: strip diacritics, lowercase, collapse every run of
 * non [a-z0-9] into one hyphen, trim hyphens. Throws when nothing is left.
 */
export function slugify(title: string): string {
  const slug = String(title)
    .normalize("NFKD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new ValidationError(`cannot derive a slug from title "${title}"; pass a slug explicitly`);
  }
  return slug;
}
