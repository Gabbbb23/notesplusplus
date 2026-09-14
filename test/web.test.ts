import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createWeb } from "../src/web/index.ts";
import { escapeHtml, markSnippet, renderMarkdown, replaceWikilinks } from "../src/web/render.ts";
import { seededBrain, type FakeBrain } from "./helpers/fake-brain.ts";

let root: string;
let brain: FakeBrain;
let app: Hono;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "npp-web-"));
  brain = seededBrain(root);
  app = createWeb(brain);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function html(p: string, init?: RequestInit): Promise<{ status: number; text: string; res: Response }> {
  const res = await app.request(p, init);
  return { status: res.status, text: await res.text(), res };
}

describe("render helpers", () => {
  it("escapeHtml neutralises script tags and quotes", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(escapeHtml("a & 'b'")).toBe("a &amp; &#39;b&#39;");
  });

  it("replaceWikilinks converts links outside code only", () => {
    const md = "See [[foo]] and [[bar|Bar label]].\n\n```\n[[in-fence]]\n```\n\nInline `[[in-code]]` stays, [[after]] goes.";
    const out = replaceWikilinks(md);
    expect(out).toContain("[foo](/notes/foo)");
    expect(out).toContain("[Bar label](/notes/bar)");
    expect(out).toContain("[[in-fence]]");
    expect(out).toContain("`[[in-code]]`");
    expect(out).toContain("[after](/notes/after)");
  });

  it("renderMarkdown produces HTML with /notes/ links and GFM tables", () => {
    const out = renderMarkdown("# T\n\n[[foo|Foo]]\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(out).toContain("<h1>T</h1>");
    expect(out).toContain('<a href="/notes/foo">Foo</a>');
    expect(out).toContain("<table>");
  });

  it("renderMarkdown escapes raw HTML, block and inline", () => {
    const out = renderMarkdown("<script>alert(1)</script>\n\nText with <img src=x onerror=alert(2)> inline.\n");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("&lt;img src=x onerror=alert(2)&gt;");
  });

  it("renderMarkdown drops javascript: hrefs", () => {
    const out = renderMarkdown("[click](javascript:alert(1)) and [ok](https://example.com) and ![i](javascript:x)");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('<a href="https://example.com">ok</a>');
    expect(out).toContain("click");
  });

  it("markSnippet escapes first, then marks", () => {
    expect(markSnippet("a <b> «hit» here")).toBe("a &lt;b&gt; <mark>hit</mark> here");
  });
});

describe("home", () => {
  it("renders the index hub with nav and search box", async () => {
    const { status, text } = await html("/");
    expect(status).toBe(200);
    expect(text).toContain("<h1>Index</h1>");
    expect(text).toContain('<a href="/notes/ryzen-laptop-specs">Laptop specs</a>');
    expect(text).toContain('action="/search"');
    for (const link of ['href="/tags"', 'href="/inbox"', 'href="/files"']) expect(text).toContain(link);
  });

  it("tells the owner to run init-brain when the hub is missing", async () => {
    brain.notes.delete("index");
    const { status, text } = await html("/");
    expect(status).toBe(200);
    expect(text).toContain("init-brain");
  });
});

describe("note page", () => {
  it("shows metadata, converted wikilinks, sources, files, and backlinks", async () => {
    const { status, text } = await html("/notes/ryzen-laptop-specs");
    expect(status).toBe(200);
    expect(text).toContain("Ryzen laptop specs");
    expect(text).toContain('class="badge note"');
    expect(text).toContain("The laptop has a Ryzen 7 7735HS");
    expect(text).toContain('<a href="/tags/hardware">hardware</a>');
    expect(text).toContain("created 2026-09-01");
    // wikilinks -> /notes/ links, code span untouched
    expect(text).toContain('<a href="/notes/laptop-transcript">laptop-transcript</a>');
    expect(text).toContain('<a href="/notes/index">home</a>');
    expect(text).toContain("<code>[[not-a-link]]</code>");
    // sources and files
    expect(text).toContain('Sources: <a href="/notes/laptop-transcript">laptop-transcript</a>');
    expect(text).toContain('<a href="/api/files/invoice.pdf">files/invoice.pdf</a>');
    // backlinks: index links here
    expect(text).toContain("<h2>Backlinks</h2>");
    expect(text).toMatch(/Backlinks<\/h2>[\s\S]*<a href="\/notes\/index">Index<\/a>/);
  });

  it("renders a source body inside <pre> and escapes it", async () => {
    const { status, text } = await html("/notes/laptop-transcript");
    expect(status).toBe(200);
    expect(text).toContain('class="badge source"');
    expect(text).toMatch(/<pre class="source">Speaker 1: the laptop has 16 GB RAM &lt;b&gt;bold&lt;\/b&gt;/);
    expect(text).not.toContain("<b>bold</b>");
  });

  it("escapes raw HTML inside a markdown note body", async () => {
    brain.seed({
      slug: "evil",
      frontmatter: { title: "Evil <script>", type: "note", summary: "<img src=x>", tags: [] },
      body: "Hello <script>alert('xss')</script> world\n\n<div onclick=\"x()\">block</div>\n",
    });
    const { text } = await html("/notes/evil");
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("<div onclick");
    expect(text).not.toContain("<img src=x>");
    expect(text).toContain("&lt;script&gt;alert('xss')&lt;/script&gt;");
    expect(text).toContain("&lt;div onclick=&quot;x()&quot;&gt;block&lt;/div&gt;");
    expect(text).toContain("Evil &lt;script&gt;");
  });

  it("404s for a missing note", async () => {
    const { status, text } = await html("/notes/nope");
    expect(status).toBe(404);
    expect(text).toContain("Not found");
  });
});

describe("search page", () => {
  it("shows only the form for an empty query", async () => {
    const { status, text } = await html("/search");
    expect(status).toBe(200);
    expect(text).toContain("Type a query");
    expect(text).not.toContain('class="results"');
  });

  it("lists results with marked snippets and the query in the box", async () => {
    const { status, text } = await html("/search?q=ryzen");
    expect(status).toBe(200);
    expect(text).toContain('value="ryzen"');
    expect(text).toContain('<a href="/notes/ryzen-laptop-specs">Ryzen laptop specs</a>');
    expect(text).toContain("<mark>Ryzen</mark>");
    expect(text).not.toContain("«");
  });

  it("escapes HTML in snippets before marking, and passes filters through", async () => {
    brain.seed({
      slug: "snip",
      frontmatter: { title: "Snip", type: "note", summary: "", tags: ["laptop"] },
      body: "zebra <b>tag</b> here",
    });
    const { text } = await html("/search?q=zebra&tag=laptop&type=note&mode=keyword");
    expect(text).toContain("<mark>zebra</mark> &lt;b&gt;tag&lt;/b&gt;");
    expect(text).toContain('<option value="note" selected>');
    expect(text).toContain('<option value="keyword" selected>');
  });
});

describe("tags", () => {
  it("lists tags with descriptions and counts", async () => {
    const { status, text } = await html("/tags");
    expect(status).toBe(200);
    expect(text).toContain('<a href="/tags/hardware">hardware</a>');
    expect(text).toContain("Physical machines and parts");
    expect(text).toMatch(/hardware<\/a><\/td><td>[^<]*<\/td><td class="num">1<\/td>/);
    expect(text).toMatch(/laptop<\/a><\/td><td>[^<]*<\/td><td class="num">2<\/td>/);
  });

  it("lists notes for one tag", async () => {
    const { status, text } = await html("/tags/laptop");
    expect(status).toBe(200);
    expect(text).toContain("#laptop");
    expect(text).toContain("Portable computers");
    expect(text).toContain('href="/notes/ryzen-laptop-specs"');
    expect(text).toContain('href="/notes/laptop-transcript"');
    expect(text).not.toContain('href="/notes/index"');
  });
});

describe("inbox", () => {
  it("shows an empty inbox with the drop form", async () => {
    const { status, text } = await html("/inbox");
    expect(status).toBe(200);
    expect(text).toContain('<form method="post" action="/inbox">');
    expect(text).toContain('name="content"');
    expect(text).toContain("The inbox is empty.");
  });

  it("POST adds an item, redirects 303, and the item appears with a flash", async () => {
    const body = new URLSearchParams({ name: "meeting.md", content: "we discussed <things>" });
    const res = await app.request("/inbox", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/inbox?added=meeting.md");
    expect(brain.inbox.get("meeting.md")?.content).toBe("we discussed <things>");

    const { text } = await html(res.headers.get("location")!);
    expect(text).toContain("Added <strong>meeting.md</strong>");
    expect(text).toContain("<td>meeting.md</td>");
  });

  it("POST without a name generates one", async () => {
    const res = await app.request("/inbox", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ content: "x" }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/inbox\?added=note-\d+\.md$/);
    expect([...brain.inbox.keys()][0]).toMatch(/^note-\d+\.md$/);
  });

  it("POST with empty content redirects back with an error", async () => {
    const res = await app.request("/inbox", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ content: "   " }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("error=");
    expect(brain.inbox.size).toBe(0);
  });
});

describe("files and check", () => {
  it("lists files with links to /api/files", async () => {
    brain.addFile("files/sub dir/a b.txt", "x");
    const { status, text } = await html("/files");
    expect(status).toBe(200);
    expect(text).toContain('<a href="/api/files/invoice.pdf">files/invoice.pdf</a>');
    expect(text).toContain('<a href="/api/files/sub%20dir/a%20b.txt">files/sub dir/a b.txt</a>');
  });

  it("renders the link report as four sections", async () => {
    brain.seed({
      slug: "dangling",
      frontmatter: { title: "Dangling", type: "note", summary: "s", tags: [], sources: ["gone"], files: ["files/missing.pdf"] },
      body: "[[nowhere]]",
    });
    brain.invalidNotes.push({ path: "notes/broken.md", error: "missing title" });
    const { status, text } = await html("/check");
    expect(status).toBe(200);
    for (const h of ["Broken links", "Missing files", "Missing sources", "Invalid notes"]) expect(text).toContain(h);
    expect(text).toContain("<code>[[nowhere]]</code>");
    expect(text).toContain("files/missing.pdf");
    expect(text).toContain("<code>gone</code>");
    expect(text).toContain("missing title");
  });
});

describe("errors", () => {
  it("404 page for unknown paths", async () => {
    const { status, text } = await html("/no/such/page");
    expect(status).toBe(404);
    expect(text).toContain("<h1>Not found</h1>");
  });

  it("500 page for unexpected errors", async () => {
    brain.failures.set("tags", new Error("boom"));
    const { status, text } = await html("/tags");
    expect(status).toBe(500);
    expect(text).toContain("Error 500");
    expect(text).toContain("boom");
  });
});
