/**
 * Text transforms applied before rendering. Ported from the old src/web/render.ts.
 */

const WIKILINK = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

function replaceWikilinksInText(text: string): string {
  return text.replace(WIKILINK, (_m, slug: string, label?: string) => {
    const s = slug.trim();
    const l = (label ?? s).trim();
    return `[${l}](/notes/${encodeURIComponent(s)})`;
  });
}

/** Replace wikilinks in one line, skipping inline code spans. */
function replaceWikilinksInLine(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf("`", i);
    if (open === -1) {
      out += replaceWikilinksInText(line.slice(i));
      break;
    }
    // Length of the opening backtick run.
    let runEnd = open;
    while (runEnd < line.length && line[runEnd] === "`") runEnd++;
    const run = line.slice(open, runEnd);
    const close = line.indexOf(run, runEnd);
    if (close === -1) {
      // Unbalanced backticks: not a code span, treat the rest as text.
      out += replaceWikilinksInText(line.slice(i));
      break;
    }
    out += replaceWikilinksInText(line.slice(i, open));
    out += line.slice(open, close + run.length);
    i = close + run.length;
  }
  return out;
}

/**
 * Turn [[slug]] and [[slug|label]] into markdown links to /notes/slug.
 * Fenced code blocks and inline code spans are left untouched.
 */
export function replaceWikilinks(md: string): string {
  const lines = md.split("\n");
  let fence: string | null = null;
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && line.trim() === m[1]) {
        fence = null;
      }
      continue;
    }
    if (m) {
      fence = m[1]!;
      out.push(line);
      continue;
    }
    out.push(replaceWikilinksInLine(line));
  }
  return out.join("\n");
}

/** Escape a string for safe inclusion in HTML text or attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A search snippet with «» markers becomes escaped HTML with <mark> around each match. */
export function markSnippet(snippet: string): string {
  return escapeHtml(snippet).replace(/«/g, "<mark>").replace(/»/g, "</mark>");
}

export interface SnippetPart {
  text: string;
  /** True for text that sat between « and ». */
  hit: boolean;
}

/**
 * Split a snippet on its «» markers so a React component can wrap hits in <mark>
 * while letting React escape the text. Unbalanced markers are treated as plain text.
 */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  const re = /«([^«»]*)»/g;
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    const start = m.index;
    if (start > last) parts.push({ text: snippet.slice(last, start), hit: false });
    parts.push({ text: m[1] ?? "", hit: true });
    last = start + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false });
  return parts;
}

const SAFE_HREF = /^(?:https?:|mailto:|\/|#|\.\/|\.\.\/|[a-z0-9._~-]+(?:\/|$|\?|#))/i;

/** Drop javascript: and other unsafe schemes. Returns null when the href must not be rendered. */
export function safeHref(href: string | undefined): string | null {
  const h = (href ?? "").trim();
  if (h === "") return null;
  return SAFE_HREF.test(h) ? h : null;
}

/** True for links that leave the app: anything with a scheme other than a bare path or fragment. */
export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}
