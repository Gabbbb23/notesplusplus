/**
 * The one typed client over the REST API (docs/rest-api.md).
 * Every page goes through these functions; nothing else calls fetch.
 */
import type {
  FileEntry,
  InboxItem,
  LinkReport,
  Note,
  NoteListPage,
  NoteSort,
  NoteSummary,
  NoteTrail,
  NoteType,
  PinnedNotes,
  PinTarget,
  SearchMode,
  SearchResponse,
  TagWithCount,
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

/** A successful response, or the ApiError its error envelope describes. */
async function send(path: string, init?: RequestInit): Promise<Response> {
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
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
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

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A write the web UI makes to the brain: JSON, sent as the web tool so the commit names it. */
function putJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Brain-Tool": "web" },
    body: JSON.stringify(body),
  });
}

export function noteUrl(slug: string): string {
  return `/notes/${encodeURIComponent(slug)}`;
}

export function tagUrl(tag: string): string {
  return `/tags/${encodeURIComponent(tag)}`;
}

/** The server's download of a note: "md" is the file as stored, "pdf" the print page printed to A4. */
export function noteExportUrl(slug: string, format: "md" | "pdf"): string {
  return `/api/notes/${encodeURIComponent(slug)}/export.${format}`;
}

/** The print page for a note. autoprint opens the browser's print dialog once the page is ready. */
export function printNoteUrl(slug: string, { autoprint = false }: { autoprint?: boolean } = {}): string {
  return `/print/notes/${encodeURIComponent(slug)}${autoprint ? "?autoprint=1" : ""}`;
}

export const api = {
  /** One page of notes, by title unless `sort` asks for newest first. The server's default limit is 100, its maximum 500. */
  listNotes(
    filter: { tag?: string; type?: NoteType; sort?: NoteSort; limit?: number; offset?: number } = {},
  ): Promise<NoteListPage> {
    return request<NoteListPage>(`/api/notes${query(filter)}`);
  },

  getNote(slug: string): Promise<Note> {
    return request<Note>(`/api/notes/${encodeURIComponent(slug)}`);
  },

  backlinks(slug: string): Promise<NoteSummary[]> {
    return request<NoteSummary[]>(`/api/notes/${encodeURIComponent(slug)}/backlinks`);
  },

  /** The hubs from index down to the hub that lists the note, for breadcrumbs. */
  noteTrail(slug: string): Promise<NoteTrail> {
    return request<NoteTrail>(`/api/notes/${encodeURIComponent(slug)}/trail`);
  },

  /** A note printed to PDF by the server, and the Content-Disposition header that names the file. */
  async exportPdf(slug: string): Promise<{ blob: Blob; contentDisposition: string | null }> {
    const res = await send(noteExportUrl(slug, "pdf"));
    return { blob: await res.blob(), contentDisposition: res.headers.get("Content-Disposition") };
  },

  /** The best `limit` results (1 to 100), and whether more exist past them. */
  search(
    q: string,
    opts: { limit?: number; tag?: string; type?: NoteType; mode?: SearchMode; files?: boolean } = {},
  ): Promise<SearchResponse> {
    return request<SearchResponse>(`/api/search${query({ q, ...opts })}`);
  },

  /** Every tag with the number of notes carrying it. */
  tags(): Promise<TagWithCount[]> {
    return request<TagWithCount[]>("/api/tags");
  },

  /** Every pinned note, per target, in pin order. */
  pins(): Promise<PinnedNotes> {
    return request<PinnedNotes>("/api/pins");
  },

  /** Pin a note to the end of a target's list (a pinned note keeps its place), or unpin it. Returns every pin after. */
  setPin(target: PinTarget, slug: string, pinned: boolean): Promise<PinnedNotes> {
    return putJson<PinnedNotes>(`/api/pins/${target}`, { slug, pinned });
  },

  /** Put a target's pins in a new order: the same slugs, rearranged. Returns every pin after. */
  orderPins(target: PinTarget, slugs: string[]): Promise<PinnedNotes> {
    return putJson<PinnedNotes>(`/api/pins/${target}/order`, { slugs });
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

  /** Open a file in its default Windows app, or a folder in File Explorer. path is brain-relative or absolute. */
  openFile(path: string): Promise<{ opened: string }> {
    return postJson<{ opened: string }>("/api/open", { path });
  },

  /** Show a file selected in File Explorer, or open a folder. path is brain-relative or absolute. */
  revealFile(path: string): Promise<{ revealed: string }> {
    return postJson<{ revealed: string }>("/api/reveal", { path });
  },

  checkLinks(): Promise<LinkReport> {
    return request<LinkReport>("/api/check-links");
  },

  stats(): Promise<Stats> {
    return request<Stats>("/api/stats");
  },
};

export type Api = typeof api;
