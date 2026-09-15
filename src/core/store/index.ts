import type { NoteStore } from "../types.ts";
import { FileStore } from "./store.ts";

/** Create a NoteStore over the brain repo at `root`. Call `init()` before use. */
export function createStore(root: string): NoteStore {
  return new FileStore(root);
}

export { FileStore, today } from "./store.ts";
export { slugify, isValidSlug, SLUG_RE } from "./slug.ts";
export { extractLinks, rewriteLinks } from "./wikilinks.ts";
export {
  parseFrontmatter,
  validateFrontmatter,
  serializeNote,
  NOTE_TYPES,
  DATE_RE,
  SUMMARY_MAX_CHARS,
  summaryLengthProblem,
  type FrontmatterInput,
  type ParsedFile,
  type ValidateOptions,
} from "./frontmatter.ts";
export { GitRepo } from "./git.ts";
