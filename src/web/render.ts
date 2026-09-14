import { Marked, type Tokens } from "marked";

/** Escape a string for safe inclusion in HTML text or attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

const SAFE_HREF = /^(?:https?:|mailto:|\/|#|\.\/|\.\.\/|[a-z0-9._~-]+(?:\/|$|\?|#))/i;

function safeHref(href: string): string | null {
  const h = href.trim();
  if (h === "") return null;
  return SAFE_HREF.test(h) ? h : null;
}

const marked = new Marked({
  gfm: true,
  renderer: {
    // Raw HTML in a note is shown as text. Notes must never inject markup into the page.
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link): string {
      const inner = this.parser.parseInline(tokens);
      const h = safeHref(href);
      if (!h) return inner;
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(h)}"${t}>${inner}</a>`;
    },
    image({ href, title, text }: Tokens.Image): string {
      const h = safeHref(href);
      if (!h) return escapeHtml(text);
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(h)}" alt="${escapeHtml(text)}"${t}>`;
    },
  },
});

/** Markdown (with wikilinks) to HTML. Raw HTML in the source is escaped. */
export function renderMarkdown(md: string): string {
  return marked.parse(replaceWikilinks(md), { async: false });
}

/** A search snippet with «» markers becomes escaped HTML with <mark> around each match. */
export function markSnippet(snippet: string): string {
  return escapeHtml(snippet).replace(/«/g, "<mark>").replace(/»/g, "</mark>");
}
