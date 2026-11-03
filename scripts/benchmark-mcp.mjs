import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.ts";

const notes = Array.from({ length: 120 }, (_, index) => ({
  slug: `note-${String(index + 1).padStart(3, "0")}`,
  title: `Note ${String(index + 1).padStart(3, "0")}`,
  type: "note",
  summary: "A practical note about the Fields Group project and BSIT subjects.",
  tags: ["project"],
  path: `notes/note-${String(index + 1).padStart(3, "0")}.md`,
  created: "2026-09-21",
  updated: "2026-09-21",
}));

const fakeClient = {
  async search() {
    return {
      results: notes.slice(0, 10).map((note) => ({
        kind: "note",
        id: note.slug,
        title: note.title,
        summary: note.summary,
        snippet: "Fields Group project context with BSIT subject notes.",
        path: note.path,
        score: 1,
        tags: note.tags,
        type: note.type,
      })),
      hasMore: true,
    };
  },
  async get(slug) {
    return { ...notes[0], slug, path: `notes/${slug}.md`, mtimeMs: 1, raw: `---\ntitle: ${slug}\n---\nA note body.\n` };
  },
  async list({ limit = 50, offset = 0 } = {}) {
    return { items: notes.slice(offset, offset + limit), total: notes.length, limit, offset };
  },
  async backlinks() { return notes.slice(0, 4); },
  async write() { return { slug: "new-note", path: "notes/new-note.md", updated: "2026-09-21", mtimeMs: 1 }; },
  async rename(oldSlug, newSlug) { return { note: { slug: newSlug, path: `notes/${newSlug}.md` }, rewritten: [oldSlug] }; },
  async delete() {},
  async tags() { return [{ name: "project", description: "Project notes", count: 120 }]; },
  async createTag() { return { name: "new-tag", description: "New notes" }; },
  async pins() { return { home: notes.slice(0, 3), sidebar: notes.slice(3, 5) }; },
  async setPin() { return { home: notes.slice(0, 3), sidebar: notes.slice(3, 5) }; },
  async inboxList() { return [{ name: "transcript.txt", sizeBytes: 2048, isText: true }]; },
  async inboxTake() { return { kind: "source", note: await this.get("transcript") }; },
  async checkLinks() { return { brokenLinks: [], missingFiles: [], missingSources: [], invalidNotes: [], missingPins: [], notesWithoutHub: notes.slice(0, 5).map(({ slug }) => ({ slug })), notesInSeveralHubs: [] }; },
  async stats() { return { notes: 120, files: 8, invalid: 0 }; },
};

const calls = [
  ["search", { query: "project" }], ["get_note", { slug: "note-001" }], ["list_notes", {}],
  ["backlinks", { slug: "note-001" }], ["list_tags", {}], ["list_pins", {}], ["inbox_list", {}],
  ["check_links", {}], ["stats", {}], ["write_note", { title: "New note", type: "note", summary: "A note.", tags: ["project"], body: "Body." }],
];

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await createMcpServer(fakeClient, { conventionsDir: new URL("../conventions/", import.meta.url).pathname }).connect(serverTransport);
const client = new Client({ name: "mcp-benchmark", version: "1.0.0" });
await client.connect(clientTransport);

const sizes = [];
const toolsStart = performance.now();
const toolList = await client.listTools();
const toolsMs = performance.now() - toolsStart;
for (const [name, args] of calls) {
  const samples = [];
  let last;
  for (let i = 0; i < 5; i += 1) {
    const started = performance.now();
    last = await client.callTool({ name, arguments: args });
    samples.push(performance.now() - started);
  }
  const text = last.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "";
  sizes.push({ name, avgMs: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2)), textChars: text.length, estimatedTokens: Math.ceil(text.length / 4), hasStructuredContent: Boolean(last.structuredContent) });
}

const totalTextChars = sizes.reduce((sum, sample) => sum + sample.textChars, 0);
const totalEstimatedTokens = sizes.reduce((sum, sample) => sum + sample.estimatedTokens, 0);
const structuredCalls = sizes.filter((sample) => sample.hasStructuredContent).length;
console.log(JSON.stringify({ toolCount: toolList.tools.length, toolSchemaChars: JSON.stringify(toolList).length, listToolsMs: Number(toolsMs.toFixed(2)), totalTextChars, totalEstimatedTokens, structuredCalls, calls: sizes }, null, 2));
await client.close();
