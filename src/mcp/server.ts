/**
 * MCP server over the BrainClient. Tools call the REST API; resources and prompts
 * serve the conventions folder from disk so an agent always sees the current rules.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  NOTE_LIST_LIMIT,
  SEARCH_LIMIT,
  SUMMARY_MAX_CHARS,
  createTagInputSchema,
  frontmatterInputSchema,
  inboxTakeInputSchema,
  noteListLimitSchema,
  noteListOptionsSchema,
  renameInputSchema,
  requiredText,
  searchLimitSchema,
  searchOptionsSchema,
  searchPageSchema,
  writeNoteInputSchema,
} from "../core/contract/index.ts";
import type { LinkReport, NotePage, NoteSummary, SearchResult } from "../core/types.ts";
import type { BrainClient } from "./client.ts";

export interface McpServerOptions {
  /** Folder holding conventions.md, file.md, garden.md. */
  conventionsDir: string;
}

/**
 * Smaller than the REST defaults: every line lands in an agent's context. Parsed with the contract's ranges, so a
 * default the server would refuse fails as soon as this module loads.
 */
const SEARCH_DEFAULT_LIMIT = searchLimitSchema.parse(10);
const LIST_NOTES_DEFAULT_LIMIT = noteListLimitSchema.parse(50);

// Tool inputs reuse the contract's field schemas, so their ranges, patterns, and enums are the ones REST parses with.
// Only descriptions, and defaults inside the contract's ranges, belong to MCP.
const { limit: _brainLimit, ...searchFilters } = searchOptionsSchema.shape;
const listNotesInput = noteListOptionsSchema.shape;
const writeInput = writeNoteInputSchema.shape;
const frontmatterInput = frontmatterInputSchema.shape;
const inboxTakeInput = inboxTakeInputSchema.shape;

export function createMcpServer(client: BrainClient, opts: McpServerOptions): McpServer {
  const server = new McpServer({ name: "brain", version: "0.1.0" });
  const readConvention = (name: string) => fs.readFile(path.join(opts.conventionsDir, `${name}.md`), "utf8");

  // ---- tools ----------------------------------------------------------------

  server.registerTool(
    "search",
    {
      title: "Search the brain",
      description:
        `Find notes and files by meaning or keyword. Use this first whenever you need a fact or want to know whether a note already exists. Returns the best ${SEARCH_DEFAULT_LIMIT} hits by default, each with slug, title, summary, and a snippet; open the few that matter with get_note. When more hits exist, the last line says so; raise limit (max ${SEARCH_LIMIT.max}) or refine the query.`,
      inputSchema: {
        query: requiredText("query").describe("What to look for. Specific terms work best."),
        limit: searchLimitSchema.optional().describe(`Max results, 1 to ${SEARCH_LIMIT.max}. Default ${SEARCH_DEFAULT_LIMIT}.`),
        // Every other search option (tag, type, mode, includeFiles), as the contract defines and describes it.
        ...searchFilters,
      },
      outputSchema: searchPageSchema.shape,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ query, limit, ...filters }) => {
      const { results, hasMore } = await client.search(query, { ...filters, limit: limit ?? SEARCH_DEFAULT_LIMIT });
      const lines = results.map(formatSearchResult);
      if (hasMore) lines.push(`More results exist; raise limit (max ${SEARCH_LIMIT.max}) or refine the query.`);
      return {
        content: [{ type: "text", text: results.length === 0 ? "No results." : lines.join("\n") }],
        structuredContent: { results, hasMore },
      };
    }),
  );

  server.registerTool(
    "get_note",
    {
      title: "Read a note",
      description:
        "Return the full markdown file for a slug (frontmatter and body) plus its mtimeMs. Pass that mtimeMs as expectedMtimeMs to write_note when updating so a concurrent change is not overwritten.",
      inputSchema: { slug: z.string().describe("The note or source slug.") },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ slug }) => {
      const note = await client.get(slug);
      return text(`slug: ${note.slug}\npath: ${note.path}\nmtimeMs: ${note.mtimeMs}\n\n${note.raw}`);
    }),
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        `List notes with slug, title, and summary, sorted by title, optionally filtered by tag or type. Returns ${LIST_NOTES_DEFAULT_LIMIT} notes per page by default; when more remain, the last line gives the offset for the next page. Use it to see a whole domain or all hubs; use search when you are looking for a specific fact.`,
      inputSchema: {
        ...listNotesInput,
        limit: listNotesInput.limit.describe(`Notes per page, 1 to ${NOTE_LIST_LIMIT.max}. Default ${LIST_NOTES_DEFAULT_LIMIT}.`),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ limit, ...rest }) => {
      const page = await client.list({ ...rest, limit: limit ?? LIST_NOTES_DEFAULT_LIMIT });
      return text(formatNotePage(page));
    }),
  );

  server.registerTool(
    "backlinks",
    {
      title: "Backlinks to a note",
      description:
        "List the notes that link to a slug. Use it to find surrounding context. To find notes no hub lists, read check_links instead of calling this for every note.",
      inputSchema: { slug: z.string().describe("The target slug.") },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ slug }) => {
      const notes = await client.backlinks(slug);
      return text(notes.length === 0 ? `No backlinks to ${slug}.` : notes.map(formatSummary).join("\n"));
    }),
  );

  server.registerTool(
    "write_note",
    {
      title: "Create or replace a note",
      description:
        "Write a whole note: frontmatter fields plus the markdown body. Omit slug to create one derived from the title; give a slug to create or replace that file. Tags must already exist (see list_tags). Every write is a git commit. Search before creating to avoid duplicates.",
      inputSchema: {
        slug: writeInput.slug.describe("Target slug. Omit to derive from title."),
        title: frontmatterInput.title.describe("A claim or a noun phrase."),
        type: frontmatterInput.type.describe("note, hub, or source."),
        summary: frontmatterInput.summary.describe(
          `One sentence containing the fact, for an agent deciding whether to open the note. At most ${SUMMARY_MAX_CHARS} characters.`,
        ),
        tags: frontmatterInput.tags.describe("Tags from list_tags. Usually one, sometimes two."),
        body: writeInput.body.describe("Markdown body without the frontmatter block. Lead with the fact; end with a ## Related section of wikilinks."),
        sources: frontmatterInput.sources.describe("Slugs of source notes this was derived from."),
        files: frontmatterInput.files.describe("Brain-relative attachment paths, e.g. files/invoice.pdf."),
        expectedMtimeMs: writeInput.expectedMtimeMs.describe("mtimeMs from get_note. The write fails if the file changed since."),
      },
      annotations: { destructiveHint: true },
    },
    guard(async ({ slug, title, type, summary, tags, body, sources, files, expectedMtimeMs }) => {
      const note = await client.write({
        slug,
        frontmatter: { title, type, summary, tags, ...(sources ? { sources } : {}), ...(files ? { files } : {}) },
        body,
        expectedMtimeMs,
      });
      return text(`slug: ${note.slug}\npath: ${note.path}\nupdated: ${note.updated}\nmtimeMs: ${note.mtimeMs}`);
    }),
  );

  server.registerTool(
    "rename_note",
    {
      title: "Rename a note",
      description: "Move a note to a new slug and rewrite every [[wikilink]] and sources entry that pointed at the old one. One commit.",
      inputSchema: {
        oldSlug: z.string().describe("Current slug."),
        newSlug: renameInputSchema.shape.newSlug.describe("New slug: lowercase a-z0-9, hyphen-separated."),
      },
      annotations: { destructiveHint: true },
    },
    guard(async ({ oldSlug, newSlug }) => {
      const result = await client.rename(oldSlug, newSlug);
      const rewritten = result.rewritten.length === 0 ? "No other notes referenced it." : `Rewritten links in: ${result.rewritten.join(", ")}`;
      return text(`Renamed ${oldSlug} to ${result.note.slug} (${result.note.path}).\n${rewritten}`);
    }),
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete a note",
      description: "Delete a note or source by slug. Check backlinks first and repoint them, or check_links will report broken links. Reversible through git.",
      inputSchema: { slug: z.string().describe("The slug to delete.") },
      annotations: { destructiveHint: true },
    },
    guard(async ({ slug }) => {
      await client.delete(slug);
      return text(`Deleted ${slug}.`);
    }),
  );

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description: "The tag registry: name and description of every tag a note may use. Call it before tagging or creating a tag.",
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const tags = await client.tags();
      return text(tags.length === 0 ? "No tags." : tags.map((t) => `${t.name} — ${t.description}`).join("\n"));
    }),
  );

  server.registerTool(
    "create_tag",
    {
      title: "Create a tag",
      description: "Add a tag to the registry. Tags are few and broad (a whole domain, not a topic). Create one only when list_tags has nothing that fits.",
      inputSchema: {
        name: createTagInputSchema.shape.name.describe("Lowercase, short, hyphenated if needed."),
        description: createTagInputSchema.shape.description.describe("One line saying what belongs under this tag."),
      },
    },
    guard(async ({ name, description }) => {
      const tag = await client.createTag({ name, description });
      return text(`Created tag ${tag.name} — ${tag.description}`);
    }),
  );

  server.registerTool(
    "inbox_list",
    {
      title: "List the inbox",
      description: "Items the owner dropped in inbox/ that have not been filed. Text items can become source notes with inbox_take; other files move to files/.",
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const items = await client.inboxList();
      return text(
        items.length === 0
          ? "Inbox is empty."
          : items.map((i) => `${i.name} — ${i.sizeBytes} bytes — ${i.isText ? "text" : "binary"}`).join("\n"),
      );
    }),
  );

  server.registerTool(
    "inbox_take",
    {
      title: "Take an inbox item",
      description:
        "Move an inbox item out of the inbox. A text item becomes a source note in sources/ with its contents verbatim; give it a real title and a one-line summary. A binary item moves to files/. Returns the source slug and full contents so you can read it at once.",
      inputSchema: {
        name: inboxTakeInput.name.describe("The item name from inbox_list."),
        title: inboxTakeInput.title.describe("Title for the source note. Default: the filename."),
        slug: inboxTakeInput.slug.describe("Slug for the source note. Default: derived from the title."),
        summary: inboxTakeInput.summary.describe(`One line: what the material is and where it came from. At most ${SUMMARY_MAX_CHARS} characters.`),
      },
      annotations: { destructiveHint: true },
    },
    guard(async ({ name, title, slug, summary }) => {
      const result = await client.inboxTake(name, { title, slug, summary });
      if (result.kind === "file" || !result.note) {
        return text(`Moved ${name} to ${result.filePath ?? "files/"}. Attach it to a note with files: [${result.filePath ?? ""}].`);
      }
      const note = result.note;
      return text(`slug: ${note.slug}\npath: ${note.path}\nmtimeMs: ${note.mtimeMs}\n\n${note.raw}`);
    }),
  );

  server.registerTool(
    "check_links",
    {
      title: "Check links and files",
      description:
        "Report broken wikilinks, missing attachments, missing sources, files that fail to parse, notes of type note that no hub lists, and notes listed by more than one hub. Run it after filing or gardening and fix everything it lists.",
      annotations: { readOnlyHint: true },
    },
    guard(async () => text(formatLinkReport(await client.checkLinks()))),
  );

  server.registerTool(
    "stats",
    {
      title: "Store statistics",
      description: "Counts of indexed notes, files, and invalid files. Cheap way to confirm the server is reachable.",
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const s = await client.stats();
      return text(`notes: ${s.notes}\nfiles: ${s.files}\ninvalid: ${s.invalid}`);
    }),
  );

  // ---- resources ------------------------------------------------------------

  const markdownResource = (name: string, uri: string, file: string, description: string) => {
    server.registerResource(name, uri, { title: name, description, mimeType: "text/markdown" }, async () => ({
      contents: [{ uri, mimeType: "text/markdown", text: await readConvention(file) }],
    }));
  };
  markdownResource("conventions", "brain://conventions", "conventions", "How the brain is organized. Read at the start of any session that touches notes.");
  markdownResource("file", "brain://skills/file", "file", "The 'file this material' procedure.");
  markdownResource("garden", "brain://skills/garden", "garden", "The 'tidy the store' procedure.");

  // ---- prompts --------------------------------------------------------------

  server.registerPrompt(
    "file",
    {
      title: "File material into the brain",
      description: "Process the inbox or material given in conversation: take sources, write atomic notes, update hubs, check links.",
      argsSchema: { instructions: z.string().optional().describe("Anything the owner wants done differently this time.") },
    },
    async ({ instructions }) => ({
      messages: [{ role: "user", content: { type: "text", text: withInstructions(await readConvention("file"), instructions) } }],
    }),
  );

  server.registerPrompt(
    "garden",
    {
      title: "Garden the brain",
      description: "Fix broken links, merge duplicates, link orphans, refresh hubs, tighten summaries.",
    },
    async () => ({
      messages: [{ role: "user", content: { type: "text", text: await readConvention("garden") } }],
    }),
  );

  return server;
}

// ---- helpers ------------------------------------------------------------------

function text(value: string): CallToolResult {
  return { content: [{ type: "text", text: value }] };
}

/** Wrap a tool handler so any thrown error becomes an isError result instead of a protocol failure. */
function guard<Args>(fn: (args: Args) => Promise<CallToolResult>): (args: Args) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  };
}

function withInstructions(body: string, instructions: string | undefined): string {
  const extra = instructions?.trim();
  return extra ? `${body.trimEnd()}\n\n## Instructions from the owner\n\n${extra}\n` : body;
}

function formatSearchResult(r: SearchResult): string {
  const kind = r.kind === "note" ? (r.type ?? "note") : "file";
  const head = `[${kind}] ${r.id} — ${r.title}${r.summary ? ` — ${r.summary}` : ""}`;
  const snippet = r.snippet.replace(/\s+/g, " ").trim();
  return snippet ? `${head}\n    ${snippet}` : head;
}

function formatSummary(n: NoteSummary): string {
  return `${n.slug} — ${n.title} — ${n.summary}`;
}

/** One line per note, then a line pointing at the next page when more remain. */
function formatNotePage(page: NotePage): string {
  if (page.items.length === 0) {
    return page.total === 0 ? "No notes." : `No notes at offset=${page.offset}. There are ${page.total} in total.`;
  }
  const lines = page.items.map(formatSummary);
  const end = page.offset + page.items.length;
  if (end < page.total) {
    lines.push(
      `Showing ${page.offset + 1}-${end} of ${page.total} notes. Call list_notes with offset=${end} for the next page, or narrow it with tag or type.`,
    );
  }
  return lines.join("\n");
}

export function formatLinkReport(report: LinkReport): string {
  const lines: string[] = [];
  if (report.brokenLinks.length > 0) {
    lines.push("Broken links:");
    for (const b of report.brokenLinks) lines.push(`  ${b.from} -> [[${b.to}]]`);
  }
  if (report.missingFiles.length > 0) {
    lines.push("Missing files:");
    for (const m of report.missingFiles) lines.push(`  ${m.from} -> ${m.file}`);
  }
  if (report.missingSources.length > 0) {
    lines.push("Missing sources:");
    for (const m of report.missingSources) lines.push(`  ${m.from} -> ${m.source}`);
  }
  if (report.invalidNotes.length > 0) {
    lines.push("Invalid notes:");
    for (const i of report.invalidNotes) lines.push(`  ${i.path}: ${i.error}`);
  }
  if (report.notesWithoutHub.length > 0) {
    lines.push("Notes no hub lists:");
    for (const n of report.notesWithoutHub) lines.push(`  ${n.slug}`);
  }
  if (report.notesInSeveralHubs.length > 0) {
    lines.push("Notes listed by more than one hub:");
    for (const n of report.notesInSeveralHubs) lines.push(`  ${n.slug} <- ${n.hubs.join(", ")}`);
  }
  return lines.length === 0 ? "No problems." : lines.join("\n");
}
