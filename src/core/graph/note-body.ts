/**
 * The one reader of what a note body links to and mentions. The store runs it on every note it reads, rename runs
 * it to find the links it rewrites, and the index stores its output for backlinks, trails, hub membership, and the
 * open-file allowlist.
 *
 * The body is parsed into a markdown syntax tree with GFM, by the same parser family the web view renders with
 * (react-markdown and remark-gfm), so "code" means what the owner sees as code: inline code spans with any number of
 * backticks, fenced blocks with ``` or ~~~, and indented blocks.
 *
 * - A link is `[[slug]]` or `[[slug|label]]` inside one text node: never in code, never inside a markdown link's
 *   text, and not split by other markup. Inside a table cell the pipe must be escaped, `[[slug\|label]]`, or GFM
 *   splits the cell there.
 * - A mention is an inline code span, outside a markdown link, whose whole value passes checkDrivePath.
 */
import type { InlineCode, Nodes, Root, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { checkDrivePath } from "./drive-path.ts";

export interface BodyGraph {
  /** Link targets, trimmed, deduplicated, in order of first appearance. */
  links: string[];
  /** Mentioned paths exactly as written, deduplicated, in order of first appearance. */
  mentions: string[];
}

const LINK = /\[\[([^\][|]+)(\|[^\]]*)?\]\]/g;

function parse(body: string): Root {
  return fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** Text and inline code nodes outside markdown links, in body order. Code blocks have a value, not children. */
function prose(body: string): { texts: Text[]; codes: InlineCode[] } {
  const texts: Text[] = [];
  const codes: InlineCode[] = [];
  const stack: Nodes[] = [parse(body)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "text") texts.push(node);
    else if (node.type === "inlineCode") codes.push(node);
    else if (node.type !== "link" && node.type !== "linkReference" && "children" in node) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
    }
  }
  return { texts, codes };
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

/** The links and mentions in a markdown body. */
export function parseNoteBody(body: string): BodyGraph {
  const { texts, codes } = prose(body);
  return {
    links: unique(texts.flatMap((t) => [...t.value.matchAll(LINK)].map((m) => m[1]!.trim()).filter((s) => s !== ""))),
    mentions: unique(codes.map((c) => c.value).filter((value) => checkDrivePath(value).ok)),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Point every link to `oldSlug` at `newSlug`, keeping labels. Only the source text behind the text nodes that
 * parseNoteBody reads is touched, so `[[oldSlug]]` inside code or a markdown link's text stays as written.
 * In that source a table cell's label pipe is still escaped (`\|`), and the escape is kept.
 */
export function rewriteLinks(body: string, oldSlug: string, newSlug: string): string {
  if (oldSlug === newSlug) return body;
  const link = new RegExp(`\\[\\[\\s*${escapeRegExp(oldSlug)}\\s*(\\\\?\\|[^\\]]*)?\\]\\]`, "g");
  let out = "";
  let last = 0;
  for (const text of prose(body).texts) {
    const start = text.position?.start.offset;
    const end = text.position?.end.offset;
    if (start === undefined || end === undefined || start < last) continue;
    out += body.slice(last, start) + body.slice(start, end).replace(link, (_m, label: string | undefined) => `[[${newSlug}${label ?? ""}]]`);
    last = end;
  }
  return out + body.slice(last);
}
