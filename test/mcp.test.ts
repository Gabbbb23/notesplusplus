import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Hono } from "hono";
import { createApi } from "../src/api/index.ts";
import type { Launcher } from "../src/api/launcher.ts";
import { BrainClient, type FetchLike } from "../src/mcp/client.ts";
import { createMcpServer, formatLinkReport } from "../src/mcp/server.ts";
import { SUMMARY_MAX_CHARS } from "../src/core/store/frontmatter.ts";
import type { Brain, SearchPage } from "../src/core/types.ts";
import { TempBrain, type NoteFixture } from "./helpers/temp-brain.ts";

// BrainClient and the MCP server run against the real REST app over a real brain, so a change on either side of the
// REST contract fails here. Requests go straight into the app's fetch handler: no network, no port.

const meta = { tool: "test" };
const RYZEN_SUMMARY = "The laptop has a Ryzen 7 7735HS, 16 GB RAM, and an RTX 4050.";

/** A request as the REST app received it. */
interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

/** Nothing in these tests opens or reveals files. */
const noLauncher: Launcher = {
  open: async () => {
    throw new Error("tests never open files");
  },
  reveal: async () => {
    throw new Error("tests never reveal files");
  },
};

let conventionsDir: string;

/** The REST app over `brain`, and a BrainClient whose fetch is that app's own fetch handler, recording each request. */
function clientFor(brain: Brain, calls: Recorded[] = []): { app: Hono; client: BrainClient } {
  const app = createApi(brain, { conventionsDir, launcher: noLauncher });
  const fetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: request.method, url: new URL(request.url), headers: request.headers, body });
    return app.fetch(request);
  };
  return { app, client: new BrainClient({ baseUrl: "http://localhost:4444", fetch }) };
}

async function connectMcp(client: BrainClient): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer(client, { conventionsDir }).connect(serverTransport);
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(clientTransport);
  return mcp;
}

const textOf = (res: Awaited<ReturnType<Client["callTool"]>>) => (res.content as Array<{ text: string }>)[0]!.text;

/**
 * Built once through the real brain; each describe works on a copy.
 *   tags: hardware
 *   index (hub, from init), ryzen-laptop-specs (note, hardware), laptop-transcript (source)
 *   files/invoice.txt, whose text mentions Ryzen
 *   inbox/talk.txt
 */
let seeded: TempBrain;

beforeAll(async () => {
  conventionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-conv-"));
  await fs.writeFile(path.join(conventionsDir, "conventions.md"), "# Brain conventions\n\nTest conventions body.\n");
  await fs.writeFile(path.join(conventionsDir, "file.md"), "# Skill: file this material\n\nTest file skill.\n");
  await fs.writeFile(path.join(conventionsDir, "garden.md"), "# Skill: garden the store\n\nTest garden skill.\n");

  seeded = await TempBrain.create();
  const b = seeded.brain;
  await b.createTag({ name: "hardware", description: "Machines the owner owns." }, meta);
  await b.write(
    {
      slug: "ryzen-laptop-specs",
      frontmatter: { title: "Ryzen laptop specs", type: "note", summary: RYZEN_SUMMARY, tags: ["hardware"] },
      body: "The laptop has a Ryzen 7 7735HS.\n",
    },
    meta,
  );
  await b.write(
    {
      slug: "laptop-transcript",
      frontmatter: { title: "Laptop transcript", type: "source", summary: "Raw talk about the laptop.", tags: [] },
      body: "Speaker 1: it came with 16 GB RAM.\n",
    },
    meta,
  );
  await seeded.addFile("files/invoice.txt", "Invoice for one Ryzen laptop. Total 62,000 PHP.");
  await b.inboxAdd("talk.txt", "Hello\n");
});

afterAll(async () => {
  await seeded.dispose();
  await fs.rm(conventionsDir, { recursive: true, force: true });
});

// ---- client -----------------------------------------------------------------------

describe("BrainClient", () => {
  let tb: TempBrain;
  let client: BrainClient;
  const calls: Recorded[] = [];

  beforeAll(async () => {
    tb = await seeded.copy();
    client = clientFor(tb.brain, calls).client;
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterAll(async () => {
    await tb.dispose();
  });

  it("sends X-Brain-Tool: mcp and parses a 2xx JSON body", async () => {
    const note = await client.get("ryzen-laptop-specs");
    expect(note.slug).toBe("ryzen-laptop-specs");
    expect(note.mtimeMs).toBe((await tb.brain.get("ryzen-laptop-specs"))!.mtimeMs);
    expect(calls[0]?.headers.get("X-Brain-Tool")).toBe("mcp");
    expect(calls[0]?.url.origin).toBe("http://localhost:4444");
  });

  it("builds search query strings from options and drops undefined ones", async () => {
    const page = await client.search("ryzen", { limit: 5, tag: "hardware", mode: "keyword" });
    const params = calls[0]!.url.searchParams;
    expect(params.get("q")).toBe("ryzen");
    expect(params.get("limit")).toBe("5");
    expect(params.get("tag")).toBe("hardware");
    expect(params.get("mode")).toBe("keyword");
    expect(params.has("type")).toBe(false);
    expect(params.has("files")).toBe(false);
    expect(page).toEqual({ results: [expect.objectContaining({ kind: "note", id: "ryzen-laptop-specs" })], hasMore: false });
  });

  it("POSTs to /api/notes without a slug and PUTs to /api/notes/:slug with one", async () => {
    const fm = { title: "Client write", type: "note" as const, summary: "s", tags: ["hardware"] };
    const created = await client.write({ frontmatter: fm, body: "b" });
    expect(created.slug).toBe("client-write");
    await client.write({ slug: "client-write", frontmatter: fm, body: "b2", expectedMtimeMs: created.mtimeMs });

    expect([calls[0]?.method, calls[0]?.url.pathname]).toEqual(["POST", "/api/notes"]);
    expect(calls[0]?.headers.get("Content-Type")).toBe("application/json");
    expect([calls[1]?.method, calls[1]?.url.pathname]).toEqual(["PUT", "/api/notes/client-write"]);
    expect(calls[1]?.body).toEqual({ frontmatter: fm, body: "b2", expectedMtimeMs: created.mtimeMs });
    expect((await tb.brain.get("client-write"))?.body).toBe("b2");
    // X-Brain-Tool: mcp names the MCP server in each commit.
    expect((await tb.commits()).slice(0, 2)).toEqual(["mcp: write client-write", "mcp: write client-write"]);
  });

  it("returns undefined for a 204 delete", async () => {
    await tb.writeNotes([{ slug: "doomed", frontmatter: { title: "Doomed", type: "note", summary: "s", tags: [] }, body: "" }]);
    await expect(client.delete("doomed")).resolves.toBeUndefined();
    expect(await tb.brain.get("doomed")).toBeNull();
  });

  it("throws the message from an { error: { message } } body on non-2xx", async () => {
    await expect(client.write({ frontmatter: { title: "t", type: "note", summary: "s", tags: ["foo"] }, body: "" })).rejects.toThrow(
      "unknown tags: foo. Create them with createTag first.",
    );
  });

  // The REST app always answers in JSON and never drops a connection, so these two stand in for a proxy and a stopped server.

  it("falls back to the status when the error body is not JSON", async () => {
    const proxied = new BrainClient({
      baseUrl: "http://localhost:4444",
      fetch: async () => new Response("<html>oops</html>", { status: 502, statusText: "Bad Gateway" }),
    });
    await expect(proxied.stats()).rejects.toThrow("Brain server returned 502 Bad Gateway: <html>oops</html>");
  });

  it("explains how to start the server when fetch rejects", async () => {
    const stopped = new BrainClient({
      baseUrl: "http://localhost:4444",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(stopped.stats()).rejects.toThrow(
      'Brain server not reachable at http://localhost:4444. Start it with "npm start" in C:\\Projects\\notesplusplus.',
    );
  });

  it("defaults the base URL to localhost on the configured port", () => {
    const defaults = new BrainClient();
    expect(defaults.baseUrl).toMatch(/^http:\/\/localhost:\d+$/);
  });
});

// ---- server, end to end in process ------------------------------------------------

describe("MCP server", () => {
  let tb: TempBrain;
  let app: Hono;
  let mcp: Client;
  const calls: Recorded[] = [];

  beforeAll(async () => {
    tb = await seeded.copy();
    const wired = clientFor(tb.brain, calls);
    app = wired.app;
    mcp = await connectMcp(wired.client);
  });

  afterAll(async () => {
    await mcp.close();
    await tb.dispose();
  });

  /** What REST itself answers for a search, to compare with what the MCP tool passed on. */
  const restSearch = async (query: string) => (await (await app.request(`/api/search?${query}`)).json()) as SearchPage;

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
    expect(textOf(res).split("\n")).toEqual([
      `[note] ryzen-laptop-specs — Ryzen laptop specs — ${RYZEN_SUMMARY}`,
      "    «Ryzen» laptop specs",
      "[file] files/invoice.txt — invoice.txt",
      "    Invoice for one «Ryzen» laptop. Total 62,000 PHP.",
    ]);
    expect(res.structuredContent).toEqual(await restSearch("q=ryzen&limit=5"));
    const call = calls.find((c) => c.url.pathname === "/api/search");
    expect(call?.url.searchParams.get("limit")).toBe("5");
    expect(call?.headers.get("X-Brain-Tool")).toBe("mcp");
  });

  it("search sends limit 10 by default and ends with a hint when more results exist", async () => {
    const plain = await mcp.callTool({ name: "search", arguments: { query: "ryzen" } });
    expect(calls.filter((c) => c.url.pathname === "/api/search").at(-1)?.url.searchParams.get("limit")).toBe("10");
    expect(textOf(plain)).not.toContain("More results exist");

    const cut = await mcp.callTool({ name: "search", arguments: { query: "ryzen", limit: 1 } });
    expect(cut.isError).toBeFalsy();
    expect(textOf(cut).split("\n")).toEqual([
      `[note] ryzen-laptop-specs — Ryzen laptop specs — ${RYZEN_SUMMARY}`,
      "    «Ryzen» laptop specs",
      "More results exist; raise limit (max 100) or refine the query.",
    ]);
    expect(cut.structuredContent).toEqual(await restSearch("q=ryzen&limit=1"));
    expect((cut.structuredContent as SearchPage).hasMore).toBe(true);
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

  it("get_note returns the raw file and mtimeMs", async () => {
    const note = (await tb.brain.get("ryzen-laptop-specs"))!;
    const res = await mcp.callTool({ name: "get_note", arguments: { slug: "ryzen-laptop-specs" } });
    expect(textOf(res)).toBe(`slug: ryzen-laptop-specs\npath: notes/ryzen-laptop-specs.md\nmtimeMs: ${note.mtimeMs}\n\n${note.raw}`);
  });

  it("write_note without a slug POSTs and reports slug, path, updated", async () => {
    const res = await mcp.callTool({
      name: "write_note",
      arguments: { title: "New note", type: "note", summary: "s", tags: ["hardware"], body: "Body.", sources: ["laptop-transcript"] },
    });
    expect(res.isError).toBeFalsy();
    const note = (await tb.brain.get("new-note"))!;
    expect(note.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(textOf(res)).toBe(`slug: new-note\npath: notes/new-note.md\nupdated: ${note.updated}\nmtimeMs: ${note.mtimeMs}`);
    const call = calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/notes").at(-1)!;
    expect(call.body).toEqual({
      frontmatter: { title: "New note", type: "note", summary: "s", tags: ["hardware"], sources: ["laptop-transcript"] },
      body: "Body.",
    });
    expect((await tb.commits())[0]).toBe("mcp: write new-note");
  });

  it("write_note with a slug and expectedMtimeMs PUTs, and a stale expectedMtimeMs is an isError result", async () => {
    const { mtimeMs } = (await tb.brain.get("ryzen-laptop-specs"))!;
    const args = {
      slug: "ryzen-laptop-specs",
      title: "Ryzen laptop specs",
      type: "note",
      summary: RYZEN_SUMMARY,
      tags: ["hardware"],
      body: "The laptop has a Ryzen 7 7735HS.\n",
      expectedMtimeMs: mtimeMs,
    };
    const res = await mcp.callTool({ name: "write_note", arguments: args });
    expect(res.isError).toBeFalsy();
    const call = calls.filter((c) => c.method === "PUT").at(-1)!;
    expect(call.url.pathname).toBe("/api/notes/ryzen-laptop-specs");
    expect((call.body as { expectedMtimeMs: number }).expectedMtimeMs).toBe(mtimeMs);

    const stale = await mcp.callTool({ name: "write_note", arguments: args });
    expect(stale.isError).toBe(true);
    expect(textOf(stale)).toBe("notes/ryzen-laptop-specs.md changed on disk since it was read; re-read it and try again");
  });

  it("turns an API error into an isError result instead of throwing", async () => {
    const res = await mcp.callTool({
      name: "write_note",
      arguments: { title: "Bad", type: "note", summary: "s", tags: ["nope"], body: "" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("unknown tags: nope. Create them with createTag first.");
  });

  it("turns a connection failure into an isError result with the npm start hint", async () => {
    const dead = new BrainClient({
      baseUrl: "http://localhost:1",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const c = await connectMcp(dead);
    const res = await c.callTool({ name: "stats", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('Start it with "npm start"');
    await c.close();
  });

  it("check_links says No problems. when every list is empty", async () => {
    const res = await mcp.callTool({ name: "check_links", arguments: {} });
    expect(textOf(res)).toBe("No problems.");
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
    expect(res.isError).toBeFalsy();
    const note = (await tb.brain.get("talk"))!;
    expect(note.raw).toMatch(/^---\ntitle: Talk\ntype: source\n[\s\S]*\n---\nHello\n$/);
    expect(textOf(res)).toBe(`slug: talk\npath: sources/talk.md\nmtimeMs: ${note.mtimeMs}\n\n${note.raw}`);
    const call = calls.filter((c) => c.url.pathname === "/api/inbox/take").at(-1)!;
    expect(call.body).toEqual({ name: "talk.txt", title: "Talk", summary: "A talk." });
  });

  it("list_tags and stats format one line per item", async () => {
    const tags = await mcp.callTool({ name: "list_tags", arguments: {} });
    expect(textOf(tags)).toBe("hardware — Machines the owner owns.");
    const s = await tb.brain.stats();
    expect(s.files).toBe(1);
    const stats = await mcp.callTool({ name: "stats", arguments: {} });
    expect(textOf(stats)).toBe(`notes: ${s.notes}\nfiles: 1\ninvalid: 0`);
  });

  it("serves the conventions and skill resources from disk", async () => {
    const { resources } = await mcp.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["brain://conventions", "brain://skills/file", "brain://skills/garden"]);
    const conv = await mcp.readResource({ uri: "brain://conventions" });
    expect(conv.contents[0]).toMatchObject({ uri: "brain://conventions", mimeType: "text/markdown" });
    expect((conv.contents[0] as { text: string }).text).toContain("Test conventions body.");

    // Re-read after editing the file: the resource is read from disk each time.
    await fs.writeFile(path.join(conventionsDir, "conventions.md"), "# Changed\n");
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

describe("list_notes paging", () => {
  // 120 notes titled Note 001 to Note 120, the first 10 tagged hardware, plus the root hub Index, which sorts first.
  let tb: TempBrain;
  let mcp: Client;
  const calls: Recorded[] = [];

  beforeAll(async () => {
    tb = await TempBrain.create();
    await tb.brain.createTag({ name: "hardware", description: "Machines the owner owns." }, meta);
    await tb.writeNotes(
      Array.from({ length: 120 }, (_, i): NoteFixture => {
        const n = String(i + 1).padStart(3, "0");
        return { slug: `note-${n}`, frontmatter: { title: `Note ${n}`, type: "note", summary: `Summary ${n}.`, tags: i < 10 ? ["hardware"] : [] }, body: "" };
      }),
    );
    mcp = await connectMcp(clientFor(tb.brain, calls).client);
  });

  afterAll(async () => {
    await mcp.close();
    await tb.dispose();
  });

  const listNotes = async (args: Record<string, unknown>) => textOf(await mcp.callTool({ name: "list_notes", arguments: args })).split("\n");
  const lastListParams = () => calls.filter((c) => c.url.pathname === "/api/notes").at(-1)!.url.searchParams;

  it("asks for 50 notes and ends with the next offset while more remain", async () => {
    const lines = await listNotes({});
    expect(lines).toHaveLength(51);
    expect(lines[0]).toBe("index — Index — Root hub. Lists every domain hub.");
    expect(lines[1]).toBe("note-001 — Note 001 — Summary 001.");
    expect(lines[49]).toBe("note-049 — Note 049 — Summary 049.");
    expect(lines[50]).toBe("Showing 1-50 of 121 notes. Call list_notes with offset=50 for the next page, or narrow it with tag or type.");
    expect(lastListParams().get("limit")).toBe("50");
    expect(lastListParams().has("offset")).toBe(false);
  });

  it("follows offset to the last page, which has no footer", async () => {
    const middle = await listNotes({ offset: 50 });
    expect(middle[0]).toBe("note-050 — Note 050 — Summary 050.");
    expect(middle.at(-1)).toBe("Showing 51-100 of 121 notes. Call list_notes with offset=100 for the next page, or narrow it with tag or type.");

    const custom = await listNotes({ limit: 7, offset: 10 });
    expect(custom).toHaveLength(8);
    expect(custom.at(-1)).toBe("Showing 11-17 of 121 notes. Call list_notes with offset=17 for the next page, or narrow it with tag or type.");
    expect([lastListParams().get("limit"), lastListParams().get("offset")]).toEqual(["7", "10"]);

    const last = await listNotes({ offset: 100 });
    expect(last).toHaveLength(21);
    expect(last[0]).toBe("note-100 — Note 100 — Summary 100.");
    expect(last.at(-1)).toBe("note-120 — Note 120 — Summary 120.");

    expect(await listNotes({ offset: 500 })).toEqual(["No notes at offset=500. There are 121 in total."]);
  });

  it("has no footer when a filter fits on one page, and checks limit and offset in the schema", async () => {
    const lines = await listNotes({ tag: "hardware" });
    expect(lines).toHaveLength(10);
    expect(lines.some((l) => l.startsWith("Showing"))).toBe(false);
    expect(await listNotes({ tag: "nope" })).toEqual(["No notes."]);

    const before = calls.length;
    for (const args of [{ limit: 0 }, { limit: 501 }, { offset: -1 }]) {
      const res = await mcp.callTool({ name: "list_notes", arguments: args });
      expect(res.isError, JSON.stringify(args)).toBe(true);
      expect(textOf(res)).toContain("Input validation error");
    }
    expect(calls.length).toBe(before);
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
