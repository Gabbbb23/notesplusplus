/**
 * Typed HTTP client over the REST contract in docs/rest-api.md.
 * The MCP server is the only consumer. Every request carries X-Brain-Tool: mcp
 * so the git commit message names the MCP server as the author.
 */
import { config } from "../config.ts";
import type {
  InboxItem,
  InboxTakeResult,
  LinkReport,
  ListFilter,
  Note,
  NotePage,
  NoteSummary,
  RenameResult,
  SearchOptions,
  SearchPage,
  Tag,
  TagWithCount,
  WriteNoteInput,
} from "../core/types.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BrainClientOptions {
  /** Defaults to http://localhost:<config.port>. */
  baseUrl?: string;
  /** Defaults to globalThis.fetch. Inject a fake in tests. */
  fetch?: FetchLike;
}

export interface BrainStats {
  notes: number;
  files: number;
  invalid: number;
}

export class BrainClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: BrainClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? `http://localhost:${config.port}`).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** One page of notes. Omitted limit and offset take the server defaults. */
  list(filter: ListFilter & { limit?: number; offset?: number } = {}): Promise<NotePage> {
    return this.request("GET", "/api/notes", {
      query: { tag: filter.tag, type: filter.type, limit: filter.limit, offset: filter.offset },
    });
  }

  get(slug: string): Promise<Note> {
    return this.request("GET", `/api/notes/${encodeURIComponent(slug)}`);
  }

  /** POST when no slug is given (server derives it from the title), PUT to the slug otherwise. */
  write(input: WriteNoteInput): Promise<Note> {
    if (input.slug) {
      const { slug, ...rest } = input;
      return this.request("PUT", `/api/notes/${encodeURIComponent(slug)}`, { body: rest });
    }
    return this.request("POST", "/api/notes", { body: input });
  }

  delete(slug: string): Promise<void> {
    return this.request("DELETE", `/api/notes/${encodeURIComponent(slug)}`);
  }

  rename(oldSlug: string, newSlug: string): Promise<RenameResult> {
    return this.request("POST", `/api/notes/${encodeURIComponent(oldSlug)}/rename`, { body: { newSlug } });
  }

  backlinks(slug: string): Promise<NoteSummary[]> {
    return this.request("GET", `/api/notes/${encodeURIComponent(slug)}/backlinks`);
  }

  search(query: string, opts: SearchOptions = {}): Promise<SearchPage> {
    return this.request("GET", "/api/search", {
      query: {
        q: query,
        limit: opts.limit,
        tag: opts.tag,
        type: opts.type,
        mode: opts.mode,
        files: opts.includeFiles,
      },
    });
  }

  tags(): Promise<TagWithCount[]> {
    return this.request("GET", "/api/tags");
  }

  createTag(tag: Tag): Promise<Tag> {
    return this.request("POST", "/api/tags", { body: tag });
  }

  inboxList(): Promise<InboxItem[]> {
    return this.request("GET", "/api/inbox");
  }

  inboxTake(name: string, opts: { title?: string; slug?: string; summary?: string } = {}): Promise<InboxTakeResult> {
    return this.request("POST", "/api/inbox/take", { body: { name, ...opts } });
  }

  checkLinks(): Promise<LinkReport> {
    return this.request("GET", "/api/check-links");
  }

  stats(): Promise<BrainStats> {
    return this.request("GET", "/api/stats");
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { "X-Brain-Tool": "mcp", Accept: "application/json" };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), init);
    } catch {
      throw new Error(
        `Brain server not reachable at ${this.baseUrl}. Start it with "npm start" in C:\\Projects\\notesplusplus.`,
      );
    }

    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  const fallback = `Brain server returned ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
  let text: string;
  try {
    text = await res.text();
  } catch {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof parsed?.error?.message === "string") return parsed.error.message;
  } catch {
    // not JSON; fall through
  }
  return text.trim().length > 0 ? `${fallback}: ${text.trim()}` : fallback;
}
