import { escapeHtml } from "./render.ts";

const CSS = `
:root {
  --bg: #fdfdfc;
  --fg: #1f2328;
  --muted: #59636e;
  --line: #d9dee3;
  --link: #0a5bd3;
  --badge-note: #e3f0ff;
  --badge-hub: #e8f7e6;
  --badge-source: #fff2d6;
  --badge-file: #f0e9ff;
  --badge-fg: #1f2328;
  --mark: #fff3a3;
  --code: #f3f4f6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171a;
    --fg: #e6e9ec;
    --muted: #9aa4ae;
    --line: #2e353c;
    --link: #79b2ff;
    --badge-note: #1d3557;
    --badge-hub: #1f4a2c;
    --badge-source: #5a3f10;
    --badge-file: #3b2a5e;
    --badge-fg: #e6e9ec;
    --mark: #6b5a00;
    --code: #1f242a;
  }
}
* { box-sizing: border-box; }
html { color-scheme: light dark; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
}
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
header.site {
  border-bottom: 1px solid var(--line);
  padding: 0.6rem 1rem;
}
header.site .inner {
  max-width: 52rem;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  align-items: center;
}
header.site nav a { margin-right: 1rem; }
header.site nav a.brand { font-weight: 600; color: var(--fg); }
header.site form { margin-left: auto; display: flex; gap: 0.4rem; }
main {
  max-width: 52rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 4rem;
}
h1 { font-size: 1.8rem; line-height: 1.25; margin: 0 0 0.5rem; }
h2 { font-size: 1.3rem; margin-top: 2rem; border-bottom: 1px solid var(--line); padding-bottom: 0.25rem; }
h3 { font-size: 1.1rem; }
input[type=text], input[type=search], textarea, select {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
}
textarea { width: 100%; min-height: 12rem; }
button {
  font: inherit;
  padding: 0.35rem 0.9rem;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--code);
  color: var(--fg);
  cursor: pointer;
}
.badge {
  display: inline-block;
  font-size: 0.75rem;
  line-height: 1.4;
  padding: 0 0.5rem;
  border-radius: 999px;
  color: var(--badge-fg);
  background: var(--badge-note);
  vertical-align: middle;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.badge.hub { background: var(--badge-hub); }
.badge.source { background: var(--badge-source); }
.badge.file { background: var(--badge-file); }
.meta { color: var(--muted); font-size: 0.9rem; }
.meta a { color: inherit; }
.tags a { margin-right: 0.5rem; }
.tags a::before { content: "#"; opacity: 0.6; }
.summary { font-size: 1.05rem; color: var(--muted); margin: 0.25rem 0 1rem; }
mark { background: var(--mark); color: inherit; padding: 0 0.1em; border-radius: 2px; }
.results { list-style: none; padding: 0; margin: 0; }
.results li { padding: 0.9rem 0; border-bottom: 1px solid var(--line); }
.results .title { font-size: 1.1rem; }
.results .snippet { margin: 0.3rem 0; }
.list { list-style: none; padding: 0; margin: 0; }
.list li { padding: 0.5rem 0; border-bottom: 1px solid var(--line); }
.flash { background: var(--badge-hub); padding: 0.5rem 0.8rem; border-radius: 6px; margin-bottom: 1rem; }
.error { background: var(--badge-source); padding: 0.5rem 0.8rem; border-radius: 6px; margin-bottom: 1rem; }
article.body { margin-top: 1.5rem; }
article.body img { max-width: 100%; }
article.body pre, pre.source {
  background: var(--code);
  padding: 0.8rem 1rem;
  overflow-x: auto;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.9rem;
}
article.body code { background: var(--code); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.92em; }
article.body pre code { background: none; padding: 0; }
article.body blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid var(--line); color: var(--muted); }
article.body table { border-collapse: collapse; }
article.body th, article.body td { border: 1px solid var(--line); padding: 0.3rem 0.6rem; }
table.plain { border-collapse: collapse; width: 100%; }
table.plain th, table.plain td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--line); }
table.plain th { color: var(--muted); font-weight: 600; font-size: 0.85rem; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
`;

export interface LayoutOptions {
  title: string;
  body: string;
  /** Current search query, shown in the header search box. */
  q?: string;
}

export function layout(opts: LayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} · notes++</title>
<style>${CSS}</style>
</head>
<body>
<header class="site">
  <div class="inner">
    <nav>
      <a class="brand" href="/">notes++</a>
      <a href="/">Home</a>
      <a href="/tags">Tags</a>
      <a href="/inbox">Inbox</a>
      <a href="/files">Files</a>
      <a href="/check">Check</a>
    </nav>
    <form method="get" action="/search" role="search">
      <input type="search" name="q" placeholder="Search" value="${escapeHtml(opts.q ?? "")}" aria-label="Search">
      <button type="submit">Search</button>
    </form>
  </div>
</header>
<main>
${opts.body}
</main>
</body>
</html>
`;
}
