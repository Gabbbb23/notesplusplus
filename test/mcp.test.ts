import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BrainClient, type FetchLike } from "../src/mcp/client.ts";
import { createMcpServer, formatLinkReport } from "../src/mcp/server.ts";
import { SUMMARY_MAX_CHARS } from "../src/core/store/frontmatter.ts";
import type { Note, NoteSummary, SearchResult } from "../src/core/types.ts";

// ---- fake REST server -----------------------------------------------------------

interface Recorded {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

type Route = (req: Recorded) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

function fakeFetch(routes: Record<string, Route>, calls: Recorded[] = []): FetchLike {
  return async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const req: Recorded = { method, url, headers, body };
    calls.push(req);
    const key = `${method} ${url.pathname}`;
    const route = routes[key] ?? routes[`${method} *`];
    if (!route) return new Response(JSON.stringify({ error: { code: "not_found", message: `no route ${key}` } }), { status: 404 });
    const out = await route(req);
    const status = out.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(out.body ?? null), { status, headers: { "Content-Type": "application/json" } });
  };
}

const sampleNote: Note = {
  slug: "ryzen-laptop-specs",
  path: "notes/ryzen-laptop-specs.md",
  title: "Ryzen laptop specs",
  type: "note",
  summary: "The laptop has a Ryzen 7 7735HS, 16 GB RAM, and an RTX 4050.",
  tags: ["hardware"],
  created: "2026-09-13",
  updated: "2026-09-13",
  frontmatter: {
    title: "Ryzen laptop specs",
    type: "note",
    summary: "The laptop has a Ryzen 7 7735HS, 16 GB RAM, and an RTX 4050.",
    tags: ["hardware"],
    created: "2026-09-13",
    updated: "2026-09-13",
  },
  body: "The laptop has a Ryzen 7 7735HS.\n",
  raw: "---\ntitle: Ryzen laptop specs\ntype: note\n---\nThe laptop has a Ryzen 7 7735HS.\n",
  links: [],
  mtimeMs: 1757750000000,
};

const sampleResults: SearchResult[] = [
  {
    kind: "note",
    id: "ryzen-laptop-specs",
    path: "notes/ryzen-laptop-specs.md",
    title: "Ryzen laptop specs",
    summary: "The laptop has a Ryzen 7 7735HS, 16 GB RAM, and an RTX 4050.",
    snippet: "...has a Ryzen 7 7735HS with 16 GB...",
    score: 0.9,
    tags: ["hardware"],
    type: "note",
  },
  {
    kind: "file",
    id: "files/invoice.pdf",
    path: "files/invoice.pdf",
    title: "invoice.pdf",
    summary: "",
    snippet: "Total 62,000 PHP",
    score: 0.4,
    tags: [],
  },
];

/** 120 notes in title order; the first 10 carry the hardware tag. */
const manyNotes: NoteSummary[] = Array.from({ length: 120 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  const tags = i < 10 ? ["hardware"] : [];
  return { slug: `note-${n}`, path: `notes/note-${n}.md`, title: `Note ${n}`, type: "note", summary: `Summary ${n}.`, tags, created: "2026-09-13", updated: "2026-09-13" };
});

// ---- client -----------------------------------------------------------------------

describe("BrainClient", () => {
  it("sends X-Brain-Tool: mcp and parses a 2xx JSON body", async () => {
    const calls: Recorded[] = [];
    const client = new BrainClient({
      baseUrl: "http://localhost:4444",
      fetch: fakeFetch({ "GET /api/notes/ryzen-laptop-specs": () => ({ body: sampleNote }) }, calls),
    });
    const note = await client.get("ryzen-laptop-specs");
    expect(note.slug).toBe("ryzen-laptop-specs");
    expect(note.mtimeMs).toBe(1757750000000);
    expect(calls[0]?.headers["X-Brain-Tool"]).toBe("mcp");
    expect(calls[0]?.url.origin).toBe("http://localhost:4444");
  });

  it("builds search query strings from options and drops undefined ones", async () => {
    const calls: Recorded[] = [];
    const client = new BrainClient({
      baseUrl: "http://localhost:4444",
      fetch: fakeFetch({ "GET /api/search": () => ({ body: { results: [], hasMore: false } }) }, calls),
    });
    await client.search("ryzen", { limit: 5, tag: "hardware", mode: "keyword" });
    const params = calls[0]!.url.searchParams;
    expect(params.get("q")).toBe("ryzen");
    expect(params.get("limit")).toBe("5");
    expect(params.get("tag")).toBe("hardware");
    expect(params.get("mode")).toBe("keyword");
    expect(params.has("type")).toBe(false);
    expect(params.has("files")).toBe(false);
  });

  it("POSTs to /api/notes without a slug and PUTs to /api/notes/:slug with one", async () => {
    const calls: Recorded[] = [];
    const client = new BrainClient({
      baseUrl: "http://localhost:4444",
      fetch: fakeFetch(
        {
          "POST /api/notes": () => ({ status: 201, body: sampleNote }),
          "PUT /api/notes/ryzen-laptop-specs": () => ({ body: sampleNote }),
        },
        calls,
      ),
    });
    const fm = { title: "Ryzen laptop specs", type: "note" as const, summary: "s", tags: ["hardware"] };
    await client.write({ frontmatter: fm, body: "b" });
    await client.write({ slug: "ryzen-laptop-specs", frontmatter: fm, body: "b", expectedMtimeMs: 1 });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
    expect(calls[1]?.method).toBe("PUT");
    expect(calls[1]?.body).toEqual({ frontmatter: fm, body: "b", expectedMtimeMs: 1 });
    expect((calls[1]?.body as { slug?: string }).slug).toBeUndefined();
  });

  it("returns undefined for a 204 delete", async () => {
    const client = new BrainClient({ baseUrl: "http://localhost:4444", fetch: fakeFetch({ "DELETE /api/notes/x": () => ({ status: 204 }) }) });
    await expect(client.delete("x")).resolves.toBeUndefined();
  });

  it("throws the message from an { error: { message } } body on non-2xx", async () => {
    const client = new BrainClient({
      baseUrl: "http://localhost:4444",
      fetch: fakeFetch({ "POST /api/notes": () => ({ status: 400, body: { error: { code: "validation", message: "unknown tags: foo" } } }) }),
    });
    await expect(client.write({ frontmatter: { title: "t", type: "note", summary: "s", tags: ["foo"] }, body: "" })).rejects.toThrow(
      "unknown tags: foo",
    );
  });

  it("falls back to the status when the error body is not JSON", async () => {
    const client = new BrainClient({
      baseUrl: "http://localhost:4444",
      fetch: async () => new Response("<html>oops</html>", { status: 502, statusText: "Bad Gateway" }),
    });
    await expect(client.stats()).rejects.toThrow("Brain server returned 502 Bad Gateway: <html>oops</html>");
  });

  it("explains how to start the server when fetch rejects", async () => {
    const client = new BrainClient({
      baseUrl: "http://localhost:4444",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(client.stats()).rejects.toThrow(
      'Brain server not reachable at http://localhost:4444. Start it with "npm start" in C:\\Projects\\notesplusplus.',
    );
  });

  it("defaults the base URL to localhost on the configured port", () => {
    const client = new BrainClient();
    expect(client.baseUrl).toMatch(/^http:\/\/localhost:\d+$/);
  });
});

// ---- server, end to end in process ------------------------------------------------

describe("MCP server", () => {
  let tmp: string;
  let mcp: Client;
  let calls: Recorded[];
  let routes: Record<string, Route>;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "brain-conv-"));
    await fs.writeFile(path.join(tmp, "conventions.md"), "# Brain conventions\n\nTest conventions body.\n");
    await fs.writeFile(path.join(tmp, "file.md"), "# Skill: file this material\n\nTest file skill.\n");
    await fs.writeFile(path.join(tmp, "garden.md"), "# Skill: garden the store\n\nTest garden skill.\n");

    calls = [];
    routes = {
      // Pages like the real server: the REST default limit is 20, hasMore when results were cut.
      "GET /api/search": (req) => {
        const limit = Number(req.url.searchParams.get("limit") ?? 20);
        return { body: { results: sampleResults.slice(0, limit), hasMore: sampleResults.length > limit } };
      },
      "GET /api/notes/ryzen-laptop-specs": () => ({ body: sampleNote }),
      "GET /api/notes": (req) => {
        const params = req.url.searchParams;
        const tag = params.get("tag");
        const matching = manyNotes.filter((n) => !tag || n.tags.includes(tag));
        const limit = Number(params.get("limit") ?? 100);
        const offset = Number(params.get("offset") ?? 0);
        return { body: { items: matching.slice(offset, offset + limit), total: matching.length, limit, offset } };
      },
      "POST /api/notes": (req) => {
        const b = req.body as { frontmatter: { tags: string[] } };
        if (b.frontmatter.tags.includes("nope")) return { status: 400, body: { error: { code: "validation", message: "unknown tags: nope" } } };
        return { status: 201, body: { ...sampleNote, slug: "new-note", path: "notes/new-note.md" } };
      },
      "PUT /api/notes/ryzen-laptop-specs": () => ({ body: sampleNote }),
      "GET /api/check-links": () => ({ body: { brokenLinks: [], missingFiles: [], missingSources: [], invalidNotes: [] } }),
      "GET /api/tags": () => ({ body: [{ name: "hardware", description: "Machines the owner owns.", count: 10 }] }),
      "POST /api/inbox/take": (req) => ({
        body: { kind: "source", note: { ...sampleNote, slug: "talk-transcript", path: "sources/talk-transcript.md", type: "source", raw: "---\ntype: source\n---\nHello\n" } },
      }),
      "GET /api/stats": () => ({ body: { notes: 3, files: 1, invalid: 0 } }),
    };
    const client = new BrainClient({ baseUrl: "http://localhost:4444", fetch: fakeFetch(routes, calls) });
    const server = createMcpServer(client, { conventionsDir: tmp });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    mcp = new Client({ name: "test", version: "0.0.0" });
    await mcp.connect(clientTransport);
  });

  afterAll(async () => {
    await mcp.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const textOf = (res: Awaited<ReturnType<Client["callTool"]>>) => (res.content as Array<{ text: string }>)[0]!.text;

  it("lists the full tool surface", async () => {
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "backlinks",
        "check_links",
        "create_tag",
        "delete_note",
        "get_note",
        "inbox_list",
        "inbox_take",
        "list_notes",
        "list_tags",
        "rename_note",
        "search",
        "stats",
        "write_note",
      ].sort(),
    );
    for (const t of tools) expect(t.description, `${t.name} has a description`).toBeTruthy();
  });

  it("states the summary limit on write_note and inbox_take", async () => {
    const { tools } = await mcp.listTools();
    for (const name of ["write_note", "inbox_take"]) {
      const schema = tools.find((t) => t.name === name)?.inputSchema as { properties: Record<string, { description?: string }> };
      expect(schema.properties.summary?.description, name).toContain(`At most ${SUMMARY_MAX_CHARS} characters.`);
    }
  });

  it("search returns one line per hit with an indented snippet and structuredContent", async () => {
    const res = await mcp.callTool({ name: "search", arguments: { query: "ryzen", limit: 5 } });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text.split("\n")).toEqual([
      "[note] ryzen-laptop-specs — Ryzen laptop specs — The laptop has a Ryzen 7 7735HS, 16 GB RAM, and an RTX 4050.",
      "    ...has a Ryzen 7 7735HS with 16 GB...",
      "[file] files/invoice.pdf — invoice.pdf",
      "    Total 62,000 PHP",
    ]);
    expect(res.structuredContent).toEqual({ results: sampleResults, hasMore: false });
    const call = calls.find((c) => c.url.pathname === "/api/search");
    expect(call?.url.searchParams.get("limit")).toBe("5");
    expect(call?.headers["X-Brain-Tool"]).toBe("mcp");
  });

  it("search sends limit 10 by default and ends with a hint when more results exist", async () => {
    const plain = await mcp.callTool({ name: "search", arguments: { query: "ryzen" } });
    expect(calls.filter((c) => c.url.pathname === "/api/search").at(-1)?.url.searchParams.get("limit")).toBe("10");
    expect(textOf(plain)).not.toContain("More results exist");

    const cut = await mcp.callTool({ name: "search", arguments: { query: "ryzen", limit: 1 } });
    expect(cut.isError).toBeFalsy();
    expect(textOf(cut).split("\n")).toEqual([
      "[note] ryzen-laptop-specs — Ryzen laptop specs — The laptop has a Ryzen 7 7735HS, 16 GB RAM, and an RTX 4050.",
      "    ...has a Ryzen 7 7735HS with 16 GB...",
      "More results exist; raise limit (max 100) or refine the query.",
    ]);
    expect(cut.structuredContent).toEqual({ results: [sampleResults[0]], hasMore: true });
  });

  it("search rejects a limit over 100 in the schema, before calling the server", async () => {
    const before = calls.length;
    const res = await mcp.callTool({ name: "search", arguments: { query: "ryzen", limit: 101 } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("Input validation error");
    expect(textOf(res)).toContain("limit");
    expect(calls.length).toBe(before);
    expect((await mcp.callTool({ name: "search", arguments: { query: "ryzen", limit: 100 } })).isError).toBeFalsy();
  });

  it("list_notes asks for 50 notes and ends with the next offset while more remain", async () => {
    const res = await mcp.callTool({ name: "list_notes", arguments: {} });
    expect(res.isError).toBeFalsy();
    const lines = textOf(res).split("\n");
    expect(lines).toHaveLength(51);
    expect(lines[0]).toBe("note-001 — Note 001 — Summary 001.");
    expect(lines[49]).toBe("note-050 — Note 050 — Summary 050.");
    expect(lines[50]).toBe("Showing 1-50 of 120 notes. Call list_notes with offset=50 for the next page, or narrow it with tag or type.");
    const params = calls.filter((c) => c.url.pathname === "/api/notes").at(-1)!.url.searchParams;
    expect(params.get("limit")).toBe("50");
    expect(params.has("offset")).toBe(false);
  });

  it("list_notes follows offset to the last page, which has no footer", async () => {
    const middle = textOf(await mcp.callTool({ name: "list_notes", arguments: { offset: 50 } })).split("\n");
    expect(middle[0]).toBe("note-051 — Note 051 — Summary 051.");
    expect(middle.at(-1)).toBe("Showing 51-100 of 120 notes. Call list_notes with offset=100 for the next page, or narrow it with tag or type.");

    const custom = textOf(await mcp.callTool({ name: "list_notes", arguments: { limit: 7, offset: 10 } })).split("\n");
    expect(custom).toHaveLength(8);
    expect(custom.at(-1)).toBe("Showing 11-17 of 120 notes. Call list_notes with offset=17 for the next page, or narrow it with tag or type.");
    const params = calls.filter((c) => c.url.pathname === "/api/notes").at(-1)!.url.searchParams;
    expect([params.get("limit"), params.get("offset")]).toEqual(["7", "10"]);

    const last = textOf(await mcp.callTool({ name: "list_notes", arguments: { offset: 100 } })).split("\n");
    expect(last).toHaveLength(20);
    expect(last[0]).toBe("note-101 — Note 101 — Summary 101.");
    expect(last.at(-1)).toBe("note-120 — Note 120 — Summary 120.");

    const past = await mcp.callTool({ name: "list_notes", arguments: { offset: 500 } });
    expect(textOf(past)).toBe("No notes at offset=500. There are 120 in total.");
  });

  it("list_notes has no footer when a filter fits on one page, and checks limit and offset in the schema", async () => {
    const lines = textOf(await mcp.callTool({ name: "list_notes", arguments: { tag: "hardware" } })).split("\n");
    expect(lines).toHaveLength(10);
    expect(lines.some((l) => l.startsWith("Showing"))).toBe(false);
    expect(textOf(await mcp.callTool({ name: "list_notes", arguments: { tag: "nope" } }))).toBe("No notes.");

    const before = calls.length;
    for (const args of [{ limit: 0 }, { limit: 501 }, { offset: -1 }]) {
      const res = await mcp.callTool({ name: "list_notes", arguments: args });
      expect(res.isError, JSON.stringify(args)).toBe(true);
      expect(textOf(res)).toContain("Input validation error");
    }
    expect(calls.length).toBe(before);
  });

  it("get_note returns the raw file and mtimeMs", async () => {
    const res = await mcp.callTool({ name: "get_note", arguments: { slug: "ryzen-laptop-specs" } });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("mtimeMs: 1757750000000");
    expect(text).toContain(sampleNote.raw);
  });

  it("write_note without a slug POSTs and reports slug, path, updated", async () => {
    const res = await mcp.callTool({
      name: "write_note",
      arguments: { title: "New note", type: "note", summary: "s", tags: ["hardware"], body: "Body.", sources: ["talk-transcript"] },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("slug: new-note");
    expect(text).toContain("path: notes/new-note.md");
    expect(text).toContain("updated: 2026-09-13");
    const call = calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/notes").at(-1)!;
    expect(call.body).toEqual({
      frontmatter: { title: "New note", type: "note", summary: "s", tags: ["hardware"], sources: ["talk-transcript"] },
      body: "Body.",
    });
  });

  it("write_note with a slug and expectedMtimeMs PUTs", async () => {
    const res = await mcp.callTool({
      name: "write_note",
      arguments: { slug: "ryzen-laptop-specs", title: "Ryzen laptop specs", type: "note", summary: "s", tags: ["hardware"], body: "Body.", expectedMtimeMs: 1757750000000 },
    });
    expect(res.isError).toBeFalsy();
    const call = calls.filter((c) => c.method === "PUT").at(-1)!;
    expect(call.url.pathname).toBe("/api/notes/ryzen-laptop-specs");
    expect((call.body as { expectedMtimeMs: number }).expectedMtimeMs).toBe(1757750000000);
  });

  it("turns an API error into an isError result instead of throwing", async () => {
    const res = await mcp.callTool({
      name: "write_note",
      arguments: { title: "Bad", type: "note", summary: "s", tags: ["nope"], body: "" },
    });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe("unknown tags: nope");
  });

  it("turns a connection failure into an isError result with the npm start hint", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const dead = new BrainClient({
      baseUrl: "http://localhost:1",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await createMcpServer(dead, { conventionsDir: tmp }).connect(st);
    const c = new Client({ name: "t2", version: "0" });
    await c.connect(ct);
    const res = await c.callTool({ name: "stats", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain('Start it with "npm start"');
    await c.close();
  });

  it("check_links says No problems. when every list is empty", async () => {
    const res = await mcp.callTool({ name: "check_links", arguments: {} });
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe("No problems.");
    expect(
      formatLinkReport({
        brokenLinks: [{ from: "a", to: "b" }],
        missingFiles: [],
        missingSources: [{ from: "a", source: "s" }],
        invalidNotes: [{ path: "notes/x.md", error: "missing title" }],
      }),
    ).toBe("Broken links:\n  a -> [[b]]\nMissing sources:\n  a -> s\nInvalid notes:\n  notes/x.md: missing title");
  });

  it("inbox_take returns the source slug and its full contents", async () => {
    const res = await mcp.callTool({ name: "inbox_take", arguments: { name: "talk.txt", title: "Talk", summary: "A talk." } });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("slug: talk-transcript");
    expect(text).toContain("---\ntype: source\n---\nHello\n");
    const call = calls.filter((c) => c.url.pathname === "/api/inbox/take").at(-1)!;
    expect(call.body).toEqual({ name: "talk.txt", title: "Talk", summary: "A talk." });
  });

  it("list_tags and stats format one line per item", async () => {
    const tags = await mcp.callTool({ name: "list_tags", arguments: {} });
    expect((tags.content as Array<{ text: string }>)[0]!.text).toBe("hardware — Machines the owner owns.");
    const stats = await mcp.callTool({ name: "stats", arguments: {} });
    expect((stats.content as Array<{ text: string }>)[0]!.text).toBe("notes: 3\nfiles: 1\ninvalid: 0");
  });

  it("serves the conventions and skill resources from disk", async () => {
    const { resources } = await mcp.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["brain://conventions", "brain://skills/file", "brain://skills/garden"]);
    const conv = await mcp.readResource({ uri: "brain://conventions" });
    expect(conv.contents[0]).toMatchObject({ uri: "brain://conventions", mimeType: "text/markdown" });
    expect((conv.contents[0] as { text: string }).text).toContain("Test conventions body.");

    // Re-read after editing the file: the resource is read from disk each time.
    await fs.writeFile(path.join(tmp, "conventions.md"), "# Changed\n");
    const again = await mcp.readResource({ uri: "brain://conventions" });
    expect((again.contents[0] as { text: string }).text).toBe("# Changed\n");
  });

  it("returns the file prompt with owner instructions appended, and the garden prompt", async () => {
    const { prompts } = await mcp.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["file", "garden"]);

    const plain = await mcp.getPrompt({ name: "file", arguments: {} });
    expect(plain.messages).toHaveLength(1);
    expect(plain.messages[0]!.role).toBe("user");
    expect((plain.messages[0]!.content as { text: string }).text).toBe("# Skill: file this material\n\nTest file skill.\n");

    const withExtra = await mcp.getPrompt({ name: "file", arguments: { instructions: "Only the first inbox item." } });
    const text = (withExtra.messages[0]!.content as { text: string }).text;
    expect(text).toContain("Test file skill.");
    expect(text).toContain("## Instructions from the owner\n\nOnly the first inbox item.");

    const garden = await mcp.getPrompt({ name: "garden" });
    expect((garden.messages[0]!.content as { text: string }).text).toContain("Test garden skill.");
  });
});

describe("shipped conventions folder", () => {
  it("contains the three markdown files the server serves", async () => {
    const dir = path.resolve(import.meta.dirname, "..", "conventions");
    for (const name of ["conventions.md", "file.md", "garden.md"]) {
      const body = await fs.readFile(path.join(dir, name), "utf8");
      expect(body.length, name).toBeGreaterThan(500);
    }
  });
});
