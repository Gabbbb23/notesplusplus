import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { ErrorAlert } from "../src/components/page-state";
import { ApiError, NetworkError } from "../src/lib/api";
import type { Note } from "../src/lib/types";

/*
 * Guards "failed loads offer Try again" (DECISIONS.md, 2026-09-15): ErrorAlert's onRetry, and every
 * page that loads data passing its reload.
 */

/** The minimum of a fetch Response that lib/api.ts reads. */
function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body } as Response;
}

const serverError = () => reply(500, { error: { code: "internal", message: "Index is rebuilding" } });

/** Answers each path with its responses in order, repeating the last one; anything else is a 404. */
function stubApi(routes: Record<string, Array<() => Response>>) {
  const calls: Record<string, number> = {};
  const fetchMock = vi.fn(async (url: string) => {
    const answers = routes[url];
    if (!answers) return reply(404, { error: { code: "not_found", message: url } });
    const n = (calls[url] = (calls[url] ?? 0) + 1);
    return answers[Math.min(n, answers.length) - 1]!();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const callsTo = (fetchMock: ReturnType<typeof stubApi>, url: string) => fetchMock.mock.calls.filter(([u]) => u === url).length;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function clickTryAgain() {
  const alert = await screen.findByRole("alert");
  await act(async () => {
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<ErrorAlert> retry", () => {
  it("shows no button without onRetry", () => {
    render(<ErrorAlert error={new ApiError("boom", 500, "internal")} />);
    expect(within(screen.getByRole("alert")).queryByRole("button")).toBeNull();
  });

  it("puts a Try again button inside the notice that calls onRetry", () => {
    const onRetry = vi.fn();
    render(<ErrorAlert error={new ApiError("boom", 500, "internal")} onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Error 500");
    expect(alert).toHaveTextContent("boom");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers Try again for an unreachable server too, instead of asking for a reload", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorAlert error={new NetworkError(new TypeError("Failed to fetch"))} />);
    expect(screen.getByRole("alert")).toHaveTextContent("reload this page");
    rerender(<ErrorAlert error={new NetworkError(new TypeError("Failed to fetch"))} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("then try again");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("pages re-run the failed request and show the result", () => {
  it("Tags (useAsync)", async () => {
    const fetchMock = stubApi({
      "/api/tags": [serverError, () => reply(200, [{ name: "college", description: "BSIT degree", count: 93 }])],
    });
    renderAt("/tags");
    expect(await screen.findByRole("alert")).toHaveTextContent("Index is rebuilding");

    await clickTryAgain();

    expect(await screen.findByText("BSIT degree")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(callsTo(fetchMock, "/api/tags")).toBe(2);
  });

  it("a note, reloading its backlinks when they failed with it", async () => {
    const dates = { created: "2026-09-15", updated: "2026-09-15" };
    const college: Note = {
      slug: "college",
      path: "notes/college.md",
      title: "College",
      type: "hub",
      summary: "",
      tags: [],
      ...dates,
      frontmatter: { title: "College", type: "hub", summary: "", tags: [], ...dates },
      body: "Body text.",
      raw: "",
      links: [],
      mentions: [],
      mtimeMs: 0,
    };
    const fetchMock = stubApi({
      "/api/notes/college": [serverError, () => reply(200, college)],
      "/api/notes/college/backlinks": [serverError, () => reply(200, [])],
      "/api/notes/college/trail": [() => reply(200, { trail: [], inHub: false })],
    });
    renderAt("/notes/college");
    expect(await screen.findByRole("alert")).toHaveTextContent("Index is rebuilding");

    await clickTryAgain();

    expect(await screen.findByRole("heading", { level: 1, name: "College" })).toBeInTheDocument();
    expect(await screen.findByText("No notes link here.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(callsTo(fetchMock, "/api/notes/college")).toBe(2);
    expect(callsTo(fetchMock, "/api/notes/college/backlinks")).toBe(2);
    // The trail loaded the first time, so it is not fetched again.
    expect(callsTo(fetchMock, "/api/notes/college/trail")).toBe(1);
  });

  it("the Tag page's first page (usePagedList)", async () => {
    const url = "/api/notes?tag=college&limit=50&offset=0";
    const summary = { slug: "rizal", path: "notes/rizal.md", title: "Rizal Day", type: "note", summary: "", tags: ["college"], created: "2026-09-15", updated: "2026-09-15" };
    const fetchMock = stubApi({
      "/api/tags": [() => reply(200, [])],
      [url]: [serverError, () => reply(200, { items: [summary], total: 1, limit: 50, offset: 0 })],
    });
    renderAt("/tags/college");
    expect(await screen.findByRole("alert")).toHaveTextContent("Index is rebuilding");

    await clickTryAgain();

    expect(await screen.findByRole("link", { name: "Rizal Day" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(callsTo(fetchMock, url)).toBe(2);
  });
});
