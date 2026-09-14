/**
 * Wikilink helpers. Links are [[slug]] or [[slug|label]].
 * Anything inside a fenced code block (``` ... ```) or inline code (`...`) is ignored.
 */

/** Fenced blocks (an unterminated fence runs to the end) and inline code spans. */
const CODE_RE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

const LINK_RE = /\[\[([^\][|]+)(\|[^\]]*)?\]\]/g;

interface Segment {
  text: string;
  code: boolean;
}

/** Split a body into code and prose segments so callers can leave code untouched. */
function segments(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(CODE_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: body.slice(last, start), code: false });
    out.push({ text: m[0], code: true });
    last = start + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), code: false });
  return out;
}

/** Outgoing link targets, trimmed, deduplicated, in order of first appearance. */
export function extractLinks(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of segments(body)) {
    if (seg.code) continue;
    for (const m of seg.text.matchAll(LINK_RE)) {
      const target = (m[1] ?? "").trim();
      if (!target || seen.has(target)) continue;
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrite [[old]] and [[old|label]] to the new slug, keeping labels and code untouched. */
export function rewriteLinks(body: string, oldSlug: string, newSlug: string): string {
  if (oldSlug === newSlug) return body;
  const re = new RegExp(`\\[\\[\\s*${escapeRegExp(oldSlug)}\\s*(\\|[^\\]]*)?\\]\\]`, "g");
  return segments(body)
    .map((seg) => (seg.code ? seg.text : seg.text.replace(re, (_m, label: string | undefined) => `[[${newSlug}${label ?? ""}]]`)))
    .join("");
}
