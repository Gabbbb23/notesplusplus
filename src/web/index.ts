import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { BrainError, type Brain, type NoteSummary, type NoteType, type SearchMode, type SearchOptions } from "../core/types.ts";
import { layout } from "./layout.ts";
import { escapeHtml, markSnippet, renderMarkdown } from "./render.ts";

const e = escapeHtml;

function noteHref(slug: string): string {
  return `/notes/${encodeURIComponent(slug)}`;
}

function tagHref(tag: string): string {
  return `/tags/${encodeURIComponent(tag)}`;
}

function fileHref(relPath: string): string {
  return "/api/" + relPath.split("/").map(encodeURIComponent).join("/");
}

function badge(kind: string): string {
  return `<span class="badge ${e(kind)}">${e(kind)}</span>`;
}

function tagLinks(tags: string[]): string {
  if (tags.length === 0) return "";
  return `<span class="tags">${tags.map((t) => `<a href="${tagHref(t)}">${e(t)}</a>`).join("")}</span>`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

function noteList(notes: NoteSummary[], empty = "Nothing here yet."): string {
  if (notes.length === 0) return `<p class="meta">${e(empty)}</p>`;
  return `<ul class="results">${notes
    .map(
      (n) => `<li>
  <div class="title"><a href="${noteHref(n.slug)}">${e(n.title)}</a> ${badge(n.type)}</div>
  <div class="summary">${e(n.summary)}</div>
  <div class="meta">${tagLinks(n.tags)} <span>updated ${e(n.updated)}</span></div>
</li>`,
    )
    .join("\n")}</ul>`;
}

export function notFoundPage(what = "Page"): string {
  return layout({
    title: "Not found",
    body: `<h1>Not found</h1><p>${e(what)} does not exist.</p><p><a href="/">Back home</a></p>`,
  });
}

function errorPage(status: number, message: string): string {
  return layout({
    title: `Error ${status}`,
    body: `<h1>Error ${status}</h1><p>${e(message)}</p><p><a href="/">Back home</a></p>`,
  });
}

function page(c: Context, title: string, body: string, q?: string, status: ContentfulStatusCode = 200) {
  return c.html(layout({ title, body, q }), status);
}

const NOTE_TYPES: NoteType[] = ["note", "hub", "source"];
const SEARCH_MODES: SearchMode[] = ["hybrid", "keyword", "semantic"];

export function createWeb(brain: Brain): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof BrainError) {
      return c.html(errorPage(err.status, err.message), err.status as ContentfulStatusCode);
    }
    console.error(err);
    return c.html(errorPage(500, err.message), 500);
  });

  app.notFound((c) => c.html(notFoundPage(), 404));

  // ---- home ----

  app.get("/", async (c) => {
    const hub = await brain.get("index");
    if (!hub) {
      return page(
        c,
        "Home",
        `<h1>No root hub yet</h1>
<p>The brain has no <code>notes/index.md</code>. Run <code>npm run init-brain</code> to create the brain layout, or ask the agent to write the index hub.</p>`,
      );
    }
    const body = `<h1>${e(hub.title)}</h1>
<p class="summary">${e(hub.summary)}</p>
<p class="meta">${tagLinks(hub.tags)} <span>updated ${e(hub.updated)}</span> · <a href="${noteHref(hub.slug)}">open as note</a></p>
<article class="body">${renderMarkdown(hub.body)}</article>`;
    return page(c, hub.title, body);
  });

  // ---- note ----

  app.get("/notes/:slug", async (c) => {
    const slug = c.req.param("slug");
    const note = await brain.get(slug);
    if (!note) return c.html(notFoundPage(`Note "${slug}"`), 404);
    const backlinks = await brain.backlinks(slug);
    const fm = note.frontmatter;

    const sources = fm.sources?.length
      ? `<p class="meta">Sources: ${fm.sources.map((s) => `<a href="${noteHref(s)}">${e(s)}</a>`).join(", ")}</p>`
      : "";
    const files = fm.files?.length
      ? `<p class="meta">Files: ${fm.files.map((f) => `<a href="${fileHref(f)}">${e(f)}</a>`).join(", ")}</p>`
      : "";
    const bodyHtml =
      note.type === "source"
        ? `<pre class="source">${e(note.body)}</pre>`
        : `<article class="body">${renderMarkdown(note.body)}</article>`;

    const body = `<h1>${e(note.title)} ${badge(note.type)}</h1>
<p class="summary">${e(note.summary)}</p>
<p class="meta">${tagLinks(note.tags)} <span>created ${e(note.created)} · updated ${e(note.updated)}</span> · <code>${e(note.path)}</code></p>
${sources}
${files}
${bodyHtml}
<section class="backlinks">
<h2>Backlinks</h2>
${noteList(backlinks, "No notes link here.")}
</section>`;
    return page(c, note.title, body);
  });

  // ---- search ----

  app.get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const tag = c.req.query("tag") || undefined;
    const typeRaw = c.req.query("type") || undefined;
    const modeRaw = c.req.query("mode") || undefined;
    const type = NOTE_TYPES.includes(typeRaw as NoteType) ? (typeRaw as NoteType) : undefined;
    const mode = SEARCH_MODES.includes(modeRaw as SearchMode) ? (modeRaw as SearchMode) : undefined;

    const filters = `<form method="get" action="/search" class="meta" style="margin:1rem 0">
  <input type="search" name="q" value="${e(q)}" placeholder="Search" aria-label="Search">
  <input type="text" name="tag" value="${e(tag ?? "")}" placeholder="tag" size="10" aria-label="Tag">
  <select name="type" aria-label="Type">
    <option value="">any type</option>
    ${NOTE_TYPES.map((t) => `<option value="${t}"${t === type ? " selected" : ""}>${t}</option>`).join("")}
  </select>
  <select name="mode" aria-label="Mode">
    ${SEARCH_MODES.map((m) => `<option value="${m}"${m === (mode ?? "hybrid") ? " selected" : ""}>${m}</option>`).join("")}
  </select>
  <button type="submit">Search</button>
</form>`;

    if (q === "") {
      return page(c, "Search", `<h1>Search</h1>${filters}<p class="meta">Type a query to search notes and files.</p>`, q);
    }

    const opts: SearchOptions = { limit: 50 };
    if (tag) opts.tag = tag;
    if (type) opts.type = type;
    if (mode) opts.mode = mode;
    const results = await brain.search(q, opts);

    const list =
      results.length === 0
        ? `<p class="meta">No results for “${e(q)}”.</p>`
        : `<ul class="results">${results
            .map((r) => {
              const href = r.kind === "note" ? noteHref(r.id) : fileHref(r.path);
              const kind = r.kind === "note" ? (r.type ?? "note") : "file";
              return `<li>
  <div class="title"><a href="${href}">${e(r.title)}</a> ${badge(kind)}</div>
  ${r.summary ? `<div class="summary">${e(r.summary)}</div>` : ""}
  <div class="snippet">${markSnippet(r.snippet)}</div>
  <div class="meta">${tagLinks(r.tags)} <code>${e(r.path)}</code></div>
</li>`;
            })
            .join("\n")}</ul>`;

    return page(c, `Search: ${q}`, `<h1>Search</h1>${filters}<p class="meta">${results.length} result${results.length === 1 ? "" : "s"} for “${e(q)}”</p>${list}`, q);
  });

  // ---- tags ----

  app.get("/tags", async (c) => {
    const tags = await brain.tags();
    const rows = await Promise.all(
      tags.map(async (t) => {
        const count = (await brain.list({ tag: t.name })).length;
        return `<tr><td><a href="${tagHref(t.name)}">${e(t.name)}</a></td><td>${e(t.description)}</td><td class="num">${count}</td></tr>`;
      }),
    );
    const body =
      tags.length === 0
        ? `<h1>Tags</h1><p class="meta">No tags yet.</p>`
        : `<h1>Tags</h1>
<table class="plain"><thead><tr><th>Tag</th><th>Description</th><th class="num">Notes</th></tr></thead>
<tbody>${rows.join("\n")}</tbody></table>`;
    return page(c, "Tags", body);
  });

  app.get("/tags/:tag", async (c) => {
    const tag = c.req.param("tag");
    const notes = await brain.list({ tag });
    const desc = (await brain.tags()).find((t) => t.name === tag)?.description;
    const body = `<h1>#${e(tag)}</h1>
${desc ? `<p class="summary">${e(desc)}</p>` : ""}
${noteList(notes, "No notes carry this tag.")}`;
    return page(c, `#${tag}`, body);
  });

  // ---- inbox ----

  app.get("/inbox", async (c) => {
    const items = await brain.inboxList();
    const added = c.req.query("added");
    const error = c.req.query("error");
    const flash = added ? `<div class="flash">Added <strong>${e(added)}</strong> to the inbox.</div>` : "";
    const err = error ? `<div class="error">${e(error)}</div>` : "";
    const list =
      items.length === 0
        ? `<p class="meta">The inbox is empty.</p>`
        : `<table class="plain"><thead><tr><th>Name</th><th class="num">Size</th><th>Modified</th><th>Text</th></tr></thead>
<tbody>${items
            .map(
              (i) =>
                `<tr><td>${e(i.name)}</td><td class="num">${formatBytes(i.sizeBytes)}</td><td>${formatTime(i.mtimeMs)}</td><td>${i.isText ? "yes" : "no"}</td></tr>`,
            )
            .join("\n")}</tbody></table>`;
    const body = `<h1>Inbox</h1>
${flash}${err}
<p class="meta">Material waiting for the agent. Drop text here, then ask the agent to file it.</p>
${list}
<h2>Drop text</h2>
<form method="post" action="/inbox">
  <p><label>Name <input type="text" name="name" placeholder="optional, e.g. meeting-notes.md"></label></p>
  <p><textarea name="content" placeholder="Paste a transcript, notes, anything." required></textarea></p>
  <p><button type="submit">Add to inbox</button></p>
</form>`;
    return page(c, "Inbox", body);
  });

  app.post("/inbox", async (c) => {
    const form = await c.req.parseBody();
    const nameRaw = typeof form.name === "string" ? form.name.trim() : "";
    const content = typeof form.content === "string" ? form.content : "";
    if (content.trim() === "") {
      return c.redirect(`/inbox?error=${encodeURIComponent("Content is empty.")}`, 303);
    }
    const name = nameRaw === "" ? `note-${Date.now()}.md` : nameRaw;
    const item = await brain.inboxAdd(name, content);
    return c.redirect(`/inbox?added=${encodeURIComponent(item.name)}`, 303);
  });

  // ---- files ----

  app.get("/files", async (c) => {
    const files = await brain.files();
    const body =
      files.length === 0
        ? `<h1>Files</h1><p class="meta">No files yet.</p>`
        : `<h1>Files</h1>
<table class="plain"><thead><tr><th>Path</th><th>Type</th><th class="num">Size</th><th>Modified</th></tr></thead>
<tbody>${files
            .map(
              (f) =>
                `<tr><td><a href="${fileHref(f.path)}">${e(f.path)}</a></td><td>${e(f.ext)}</td><td class="num">${formatBytes(f.sizeBytes)}</td><td>${formatTime(f.mtimeMs)}</td></tr>`,
            )
            .join("\n")}</tbody></table>`;
    return page(c, "Files", body);
  });

  // ---- check ----

  app.get("/check", async (c) => {
    const r = await brain.checkLinks();
    const section = (title: string, rows: string[]) =>
      `<h2>${title} <span class="meta">(${rows.length})</span></h2>` +
      (rows.length === 0 ? `<p class="meta">None.</p>` : `<ul class="list">${rows.join("")}</ul>`);
    const body = `<h1>Check</h1>
<p class="meta">Problems the agent should fix. Run the <code>garden</code> prompt or fix by hand.</p>
${section(
  "Broken links",
  r.brokenLinks.map((b) => `<li><a href="${noteHref(b.from)}">${e(b.from)}</a> → <code>[[${e(b.to)}]]</code></li>`),
)}
${section(
  "Missing files",
  r.missingFiles.map((m) => `<li><a href="${noteHref(m.from)}">${e(m.from)}</a> → <code>${e(m.file)}</code></li>`),
)}
${section(
  "Missing sources",
  r.missingSources.map((m) => `<li><a href="${noteHref(m.from)}">${e(m.from)}</a> → <code>${e(m.source)}</code></li>`),
)}
${section(
  "Invalid notes",
  r.invalidNotes.map((i) => `<li><code>${e(i.path)}</code>: ${e(i.error)}</li>`),
)}`;
    return page(c, "Check", body);
  });

  return app;
}
