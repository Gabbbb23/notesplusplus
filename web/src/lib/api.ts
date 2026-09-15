/**
 * The one typed client over the REST API (docs/rest-api.md).
 * Every page goes through these functions; nothing else calls fetch.
 */
import type {
  FileEntry,
  InboxItem,
  LinkReport,
  Note,
  NoteSummary,
  NoteType,
  SearchMode,
  SearchResult,
  Tag,
} from "./types";

export interface Stats {
  notes: number;
  files: number;
  invalid: number;
}

/** An error response from the API: status plus the `error.code` / `error.message` body. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** fetch() itself threw: the server is down or unreachable. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Brain server not reachable");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new NetworkError(err);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code = "http";
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** URL for a brain-relative file path, e.g. "files/a b.pdf" -> "/api/files/a%20b.pdf". */
export function fileUrl(relPath: string): string {
  return "/api/" + relPath.split("/").map(encodeURIComponent).join("/");
}

export function noteUrl(slug: string): string {
  return `/notes/${encodeURIComponent(slug)}`;
}

export function tagUrl(tag: string): string {
  return `/tags/${encodeURIComponent(tag)}`;
}

export const api = {
  listNotes(filter: { tag?: string; type?: NoteType } = {}): Promise<NoteSummary[]> {
    return request<NoteSummary[]>(`/api/notes${query(filter)}`);
  },

  getNote(slug: string): Promise<Note> {
    return request<Note>(`/api/notes/${encodeURIComponent(slug)}`);
  },

  backlinks(slug: string): Promise<NoteSummary[]> {
    return request<NoteSummary[]>(`/api/notes/${encodeURIComponent(slug)}/backlinks`);
  },

  search(
    q: string,
    opts: { limit?: number; tag?: string; type?: NoteType; mode?: SearchMode; files?: boolean } = {},
  ): Promise<SearchResult[]> {
    return request<SearchResult[]>(`/api/search${query({ q, ...opts })}`);
  },

  tags(): Promise<Tag[]> {
    return request<Tag[]>("/api/tags");
  },

  inbox(): Promise<InboxItem[]> {
    return request<InboxItem[]>("/api/inbox");
  },

  inboxAdd(name: string, content: string): Promise<InboxItem> {
    return request<InboxItem>("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Brain-Tool": "web" },
      body: JSON.stringify({ name, content }),
    });
  },

  files(): Promise<FileEntry[]> {
    return request<FileEntry[]>("/api/files");
  },

  checkLinks(): Promise<LinkReport> {
    return request<LinkReport>("/api/check-links");
  },

  stats(): Promise<Stats> {
    return request<Stats>("/api/stats");
  },
};

export type Api = typeof api;
