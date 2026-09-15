/**
 * Text helpers for snippets and hrefs. Wikilinks in note bodies render through lib/remark-wikilinks.ts.
 */

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
