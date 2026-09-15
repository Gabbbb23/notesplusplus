import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Hono } from "hono";
import type { z } from "zod";
import { createApi } from "../src/api/index.ts";
import {
  NOTE_TYPES,
  SEARCH_MODES,
  SUMMARY_MAX_CHARS,
  noteListLimitSchema,
  noteListQuerySchema,
  noteTypeSchema,
  offsetSchema,
  searchLimitSchema,
  searchModeSchema,
  searchQueryParams,
  searchQuerySchema,
  slugSchema,
  summarySchema,
  tagNameSchema,
} from "../src/core/contract/index.ts";
import type { SearchOptions } from "../src/core/types.ts";
import { BrainClient } from "../src/mcp/client.ts";
import { createMcpServer } from "../src/mcp/server.ts";
import { TempBrain } from "./helpers/temp-brain.ts";

// The contract module's rules at their boundaries, then the same values sent through REST and MCP, which must agree.

/** The messages a schema gives for a value, or [] when it accepts the value. */
const problems = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? [] : [...new Set(result.error.issues.map((i) => i.message))];
};

describe("integer ranges", () => {
  const cases: Array<[string, z.ZodType, unknown[], unknown[], string]> = [
    ["notes limit", noteListLimitSchema, [1, 100, 500], [0, 501, 2.5, -1, Number.NaN, "5", undefined], "limit must be an integer from 1 to 500"],
    ["search limit", searchLimitSchema, [1, 20, 100], [0, 101, 2.5, Infinity], "limit must be an integer from 1 to 100"],
    ["offset", offsetSchema, [0, 1, 1_000_000], [-1, 0.5, 2 ** 60], "offset must be an integer of 0 or more"],
  ];

  it.each(cases)("%s accepts its range and names the range when it refuses", (_, schema, accepted, refused, message) => {
    for (const value of accepted) expect(problems(schema, value), String(value)).toEqual([]);
    for (const value of refused) expect(problems(schema, value), String(value)).toEqual([message]);
  });
});

describe("query strings", () => {
  it("GET /api/notes: empty and absent numbers take the defaults, other strings must be integers in range", () => {
    expect(noteListQuerySchema.parse({})).toEqual({ limit: 100, offset: 0 });
    expect(noteListQuerySchema.parse({ tag: "", type: "", limit: "", offset: "" })).toEqual({ tag: undefined, type: undefined, limit: 100, offset: 0 });
    expect(noteListQuerySchema.parse({ tag: "laptop", type: "hub", limit: "7", offset: "3" })).toEqual({ tag: "laptop", type: "hub", limit: 7, offset: 3 });
    expect(problems(noteListQuerySchema, { limit: "abc", offset: "-1" })).toEqual([
      "limit must be an integer from 1 to 500",
      "offset must be an integer of 0 or more",
    ]);
    expect(problems(noteListQuerySchema, { type: "bogus" })).toEqual(["type must be one of note, hub, source"]);
  });

  it("GET /api/search: q is required, limit defaults to 20, and files is read into includeFiles", () => {
    expect(searchQuerySchema.parse({ q: "x" })).toEqual({ q: "x", limit: 20, options: { includeFiles: undefined } });
    expect(searchQuerySchema.parse({ q: "x", files: "false" }).options.includeFiles).toBe(false);
    expect(searchQuerySchema.parse({ q: "x", files: "true" }).options.includeFiles).toBe(true);
    // Documented leniency: a value other than true or false leaves files to the default.
    expect(searchQuerySchema.parse({ q: "x", files: "yes" }).options.includeFiles).toBeUndefined();
    expect(problems(searchQuerySchema, {})).toEqual(["q is required"]);
    expect(problems(searchQuerySchema, { q: "  " })).toEqual(["q is required"]);
    expect(problems(searchQuerySchema, { q: "x", limit: "abc", mode: "psychic" })).toEqual([
      "limit must be an integer from 1 to 100",
      "mode must be one of hybrid, keyword, semantic",
    ]);
  });

  it("searchQueryParams writes every search option where searchQuerySchema reads it back", () => {
    // `satisfies Required<...>` fails to compile when an option is added without a value here.
    const every = { limit: 5, tag: "laptop", type: "hub", mode: "keyword", includeFiles: false } satisfies Required<SearchOptions>;
    for (const options of [every, { ...every, includeFiles: true }]) {
      const params = Object.fromEntries(
        Object.entries(searchQueryParams("ryzen", options)).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
      );
      const { limit, ...rest } = options;
      expect(searchQuerySchema.parse(params)).toEqual({ q: "ryzen", limit, options: rest });
    }
    expect(searchQueryParams("ryzen", {})).toEqual({ q: "ryzen", files: undefined });
  });
});

describe("slug pattern", () => {
  it("accepts lowercase letters and digits joined by single hyphens", () => {
    for (const slug of ["a", "0", "a-b-1", "ge09-life-and-works-of-rizal"]) expect(problems(slugSchema, slug), slug).toEqual([]);
  });

  it("refuses anything else, quoting the value and the pattern", () => {
    for (const slug of ["", "A", "-a", "a-", "a--b", "a b", "a_b", "café"]) {
      expect(problems(slugSchema, slug), slug).toEqual([`slug "${slug}" must match /^[a-z0-9]+(-[a-z0-9]+)*$/`]);
    }
    expect(problems(tagNameSchema, "GPU")).toEqual(['tag name "GPU" must match /^[a-z0-9]+(-[a-z0-9]+)*$/']);
  });
});

describe("summary limit", () => {
  const tooLong = (chars: number) =>
    `summary must be at most ${SUMMARY_MAX_CHARS} characters (got ${chars}). Name the one or two facts the note is about and leave lists of values to the body.`;

  it(`accepts ${SUMMARY_MAX_CHARS} characters and refuses ${SUMMARY_MAX_CHARS + 1}`, () => {
    expect(SUMMARY_MAX_CHARS).toBe(240);
    expect(problems(summarySchema, "a".repeat(240))).toEqual([]);
    expect(problems(summarySchema, "a".repeat(241))).toEqual([tooLong(241)]);
  });

  it("counts code points after trimming", () => {
    expect(problems(summarySchema, `  ${"a".repeat(240)}\n`)).toEqual([]);
    expect(problems(summarySchema, "🚀".repeat(240))).toEqual([]);
    expect(problems(summarySchema, "🚀".repeat(241))).toEqual([tooLong(241)]);
  });
});

describe("enums", () => {
  it("note types and search modes", () => {
    expect(NOTE_TYPES).toEqual(["note", "hub", "source"]);
    expect(SEARCH_MODES).toEqual(["hybrid", "keyword", "semantic"]);
    for (const type of NOTE_TYPES) expect(noteTypeSchema.parse(type)).toBe(type);
    for (const mode of SEARCH_MODES) expect(searchModeSchema.parse(mode)).toBe(mode);
    expect(noteTypeSchema.safeParse("page").success).toBe(false);
    expect(searchModeSchema.safeParse("psychic").success).toBe(false);
  });
});

// ---- REST and MCP agree ------------------------------------------------------------------------------------------

describe("REST and MCP accept and refuse the same values", () => {
  let tb: TempBrain;
  let app: Hono;
  let mcp: Client;
  let conventionsDir: string;
  let restCalls = 0;

  beforeAll(async () => {
    conventionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "npp-conventions-"));
    tb = await TempBrain.create();
    app = createApi(tb.brain, {
      conventionsDir,
      launcher: {
        open: async () => {
          throw new Error("tests never open files");
        },
        reveal: async () => {
          throw new Error("tests never reveal files");
        },
      },
    });
    const client = new BrainClient({
      baseUrl: "http://localhost:4444",
      fetch: async (input, init) => {
        restCalls++;
        return app.fetch(new Request(input, init));
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMcpServer(client, { conventionsDir }).connect(serverTransport);
    mcp = new Client({ name: "drift", version: "0.0.0" });
    await mcp.connect(clientTransport);
  });

  afterAll(async () => {
    await mcp.close();
    await tb.dispose();
    await fs.rm(conventionsDir, { recursive: true, force: true });
  });

  const json = (method: string, url: string, body: unknown) =>
    app.request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const query = (url: string, params: Record<string, unknown>) =>
    app.request(`${url}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`);

  /** For each tool, the MCP arguments and the REST request that carry `value` in `field`, with every other field valid. */
  const surfaces: Record<string, { mcp: (field: string, value: unknown) => Record<string, unknown>; rest: (field: string, value: unknown) => Response | Promise<Response> }> = {
    search: {
      mcp: (field, value) => ({ query: "ryzen", [field]: value }),
      rest: (field, value) => query("/api/search", { q: "ryzen", [({ query: "q", includeFiles: "files" } as Record<string, string>)[field] ?? field]: value }),
    },
    list_notes: {
      mcp: (field, value) => ({ [field]: value }),
      rest: (field, value) => query("/api/notes", { [field]: value }),
    },
    write_note: {
      mcp: (field, value) => ({ title: "Drift note", type: "note", summary: "s", tags: [], body: "", [field]: value }),
      rest: (field, value) => {
        const frontmatter = { title: "Drift note", type: "note", summary: "s", tags: [] };
        return json("POST", "/api/notes", field === "slug" ? { slug: value, frontmatter, body: "" } : { frontmatter: { ...frontmatter, [field]: value }, body: "" });
      },
    },
    rename_note: {
      // No note has this slug, so an accepted newSlug gets 404.
      mcp: (field, value) => ({ oldSlug: "no-such-note", [field]: value }),
      rest: (field, value) => json("POST", "/api/notes/no-such-note/rename", { [field]: value }),
    },
    inbox_take: {
      // No inbox item has this name, so accepted values get 404.
      mcp: (field, value) => ({ name: "no-such-item.txt", [field]: value }),
      rest: (field, value) => json("POST", "/api/inbox/take", { name: "no-such-item.txt", [field]: value }),
    },
    create_tag: {
      mcp: (field, value) => ({ name: "drift", description: "d", [field]: value }),
      rest: (field, value) => json("POST", "/api/tags", { name: "drift", description: "d", [field]: value }),
    },
  };

  const summary240 = "s".repeat(SUMMARY_MAX_CHARS);
  const summary241 = "s".repeat(SUMMARY_MAX_CHARS + 1);

  /** tool, field, values both accept, values both refuse. */
  const table: Array<[string, string, unknown[], unknown[]]> = [
    ["search", "query", ["ryzen"], ["", "   "]],
    ["search", "limit", [1, 100], [0, 101, 2.5]],
    ["search", "type", [...NOTE_TYPES], ["bogus"]],
    ["search", "mode", [...SEARCH_MODES], ["psychic"]],
    ["search", "includeFiles", [true, false], []],
    ["list_notes", "limit", [1, 500], [0, 501, 2.5]],
    ["list_notes", "offset", [0, 3], [-1, 2.5]],
    ["list_notes", "type", [...NOTE_TYPES], ["bogus"]],
    ["write_note", "slug", ["drift-note", "drift-2"], ["", "Drift", "drift--note", "-drift"]],
    ["write_note", "summary", [summary240], [summary241]],
    ["write_note", "type", ["note", "hub"], ["bogus"]],
    ["rename_note", "newSlug", ["new-name"], ["New Name", "new_name"]],
    ["inbox_take", "slug", ["talk-source"], ["Talk Source"]],
    ["inbox_take", "summary", [summary240], [summary241]],
    ["create_tag", "name", ["gpu"], ["GPU", "a b"]],
  ];

  const cases = table.flatMap(([tool, field, accepted, refused]) => [
    ...accepted.map((value) => ({ tool, field, value, ok: true })),
    ...refused.map((value) => ({ tool, field, value, ok: false })),
  ]);

  const label = (value: unknown) => (typeof value === "string" && value.length > 20 ? `${value.length} characters` : JSON.stringify(value));

  it.each(cases.map((c) => [`${c.tool} ${c.field}=${label(c.value)} ${c.ok ? "accepted" : "refused"}`, c] as const))("%s", async (_, c) => {
    const surface = surfaces[c.tool]!;

    const res = await surface.rest(c.field, c.value);
    const restRefused = res.status === 400;
    expect(restRefused, `REST answered ${res.status}: ${await res.text()}`).toBe(!c.ok);

    const before = restCalls;
    const result = await mcp.callTool({ name: c.tool, arguments: surface.mcp(c.field, c.value) });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const mcpRefused = result.isError === true && text.includes("Input validation error");
    expect(mcpRefused, `MCP answered: ${text}`).toBe(!c.ok);
    // A refused value never reaches the server.
    if (!c.ok) expect(restCalls).toBe(before);
  });
});
