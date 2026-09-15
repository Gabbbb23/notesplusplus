import { act } from "@testing-library/react";
import { toast } from "sonner";
import { vi } from "vitest";
import type { NoteRef, NoteSummary, PinnedNotes } from "../src/lib/types";

/*
 * Shared fetch stubs for the pins, menu, and print tests. Each call is matched by "METHOD /path" (GET
 * may be written as the path alone); anything unmatched answers 404 in the API's error envelope.
 */

export interface ReplyInit {
  headers?: Record<string, string>;
  blob?: Blob;
}

/** The minimum of a fetch Response that lib/api.ts reads. */
export function reply(status: number, body: unknown, init: ReplyInit = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers(init.headers),
    json: async () => body,
    blob: async () => init.blob ?? new Blob([JSON.stringify(body)]),
  } as unknown as Response;
}

export const apiError = (status: number, code: string, message: string) => reply(status, { error: { code, message } });

export type Route = (init: RequestInit | undefined) => Response | Promise<Response>;

export function stubApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const route = routes[`${method} ${url}`] ?? (method === "GET" ? routes[url] : undefined);
    return route ? route(init) : apiError(404, "not_found", `no route for ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A route that answers only when the test calls release(). */
export function deferred(): { route: Route; release: (res: Response) => Promise<void> } {
  let resolve: (res: Response) => void = () => {};
  let promise = new Promise<Response>((r) => (resolve = r));
  return {
    route: () => promise,
    release: async (res) => {
      await act(async () => {
        resolve(res);
        await promise;
      });
      promise = new Promise<Response>((r) => (resolve = r));
    },
  };
}

/**
 * Dismiss every toast. Sonner keeps toasts in module state and replays the active ones to the next
 * Toaster, so a test's toasts would otherwise show up in the next test.
 */
export function resetToasts() {
  act(() => {
    toast.dismiss();
  });
}

/** Let pending promises settle and React commit their results. */
export async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** The calls made to one "METHOD /path", with their parsed JSON bodies and headers. */
export function callsTo(fetchMock: ReturnType<typeof stubApi>, key: string) {
  return fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === key)
    .map(([, init]) => ({ body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) }));
}

export function summary(slug: string, title: string, type: NoteSummary["type"] = "note"): NoteSummary {
  return {
    slug,
    path: `notes/${slug}.md`,
    title,
    type,
    summary: "",
    tags: [],
    created: "2026-09-15",
    updated: "2026-09-15",
  };
}

export function pinned(home: NoteSummary[], sidebar: NoteSummary[] = []): PinnedNotes {
  return { home, sidebar };
}

export const refOf = ({ slug, title, type }: NoteRef): NoteRef => ({ slug, title, type });
