import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { NoteSummary, SearchResult } from "../src/lib/types";

/** The minimum of a fetch Response that lib/api.ts reads. */
function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body } as Response;
}

type Route = () => Response | Promise<Response>;

/** Answers each API path from routes (query string included) and everything else with a 404. */
function stubApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn(
    async (url: string) => (routes[url] ?? (() => reply(404, { error: { code: "not_found", message: url } })))(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A route that answers only when the test calls release(). */
function deferred(): { route: Route; release: (res: Response) => Promise<void> } {
  let resolve: (res: Response) => void = () => {};
  const promise = new Promise<Response>((r) => (resolve = r));
  return {
    route: () => promise,
    release: async (res) => {
      await act(async () => resolve(res));
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const urls = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.map(([url]) => url);
const cards = () => Array.from(document.querySelectorAll<HTMLElement>("main [data-slot='item-card']"));

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function result(i: number): SearchResult {
  return {
    kind: "note",
    id: `result-${i}`,
    path: `notes/result-${i}.md`,
    title: `Result ${i}`,
    summary: "",
    snippet: "",
    score: 1 / i,
    tags: [],
    type: "note",
  };
}

const results = (count: number) => Array.from({ length: count }, (_, i) => result(i + 1));
const searchUrl = (limit: number) => `/api/search?q=ryzen&limit=${limit}&mode=hybrid`;
const TAGS: Route = () => reply(200, [{ name: "college", description: "BSIT degree", count: 93 }]);

describe("Search page", () => {
  it("asks for 20 results and shows no button when there are no more", async () => {
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [searchUrl(20)]: () => reply(200, { results: results(7), hasMore: false }),
    });
    renderAt("/search?q=ryzen");

    expect(await screen.findByTestId("result-count")).toHaveTextContent("7 results for “ryzen”");
    expect(urls(fetchMock)).toContain(searchUrl(20));
    expect(cards()).toHaveLength(7);
    expect(screen.queryByRole("button", { name: "Show more results" })).toBeNull();
    expect(screen.queryByText(/Showing the top/)).toBeNull();
  });

  it("offers Show more when hasMore, re-queries with 40 keeping the rows, focuses the first new result, and puts n in the URL", async () => {
    const more = deferred();
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [searchUrl(20)]: () => reply(200, { results: results(20), hasMore: true }),
      [searchUrl(40)]: more.route,
    });
    renderAt("/search?q=ryzen");

    expect(await screen.findByTestId("result-count")).toHaveTextContent("More than 20 results for “ryzen”");
    const button = screen.getByRole("button", { name: "Show more results" });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    // The next batch is loading: the 20 rows stay, and the button stays in place, disabled.
    expect(await screen.findByTestId("location")).toHaveTextContent("/search?q=ryzen&n=40");
    expect(urls(fetchMock)).toContain(searchUrl(40));
    expect(cards()).toHaveLength(20);
    expect(document.querySelector("main [aria-label='Loading']")).toBeNull();
    expect(screen.getByRole("button", { name: "Show more results" })).toBeDisabled();

    await more.release(reply(200, { results: results(40), hasMore: true }));

    expect(cards()).toHaveLength(40);
    expect(screen.getByTestId("result-count")).toHaveTextContent("More than 40 results for “ryzen”");
    expect(screen.getByRole("link", { name: "Result 21" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Show more results" })).toBeEnabled();
  });

  it("shows the count without More than once everything is loaded, and hides the button", async () => {
    stubApi({
      "/api/tags": TAGS,
      [searchUrl(20)]: () => reply(200, { results: results(20), hasMore: true }),
      [searchUrl(40)]: () => reply(200, { results: results(31), hasMore: false }),
    });
    renderAt("/search?q=ryzen");

    fireEvent.click(await screen.findByRole("button", { name: "Show more results" }));

    await screen.findByRole("link", { name: "Result 31" });
    expect(screen.getByTestId("result-count")).toHaveTextContent("31 results for “ryzen”");
    expect(screen.getByRole("link", { name: "Result 21" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Show more results" })).toBeNull();
  });

  it("restores the longer list from n in the URL", async () => {
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [searchUrl(60)]: () => reply(200, { results: results(60), hasMore: true }),
    });
    renderAt("/search?q=ryzen&n=60");

    await screen.findByRole("link", { name: "Result 60" });
    expect(urls(fetchMock).filter((u) => u.startsWith("/api/search"))).toEqual([searchUrl(60)]);
    expect(screen.getByRole("button", { name: "Show more results" })).toBeEnabled();
  });

  it("stops at 100: no button, and a muted line to refine the search", async () => {
    stubApi({
      "/api/tags": TAGS,
      [searchUrl(80)]: () => reply(200, { results: results(80), hasMore: true }),
      [searchUrl(100)]: () => reply(200, { results: results(100), hasMore: true }),
    });
    renderAt("/search?q=ryzen&n=80");

    fireEvent.click(await screen.findByRole("button", { name: "Show more results" }));

    const cap = await screen.findByText("Showing the top 100. Refine the search to narrow it.");
    expect(cap).toHaveClass("text-muted-foreground");
    expect(cards()).toHaveLength(100);
    expect(screen.getByTestId("location")).toHaveTextContent("/search?q=ryzen&n=100");
    expect(screen.queryByRole("button", { name: "Show more results" })).toBeNull();
    expect(screen.getByRole("link", { name: "Result 81" })).toHaveFocus();
  });

  it("clamps n to the 100 cap", async () => {
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [searchUrl(100)]: () => reply(200, { results: results(100), hasMore: true }),
    });
    renderAt("/search?q=ryzen&n=500");

    await screen.findByText("Showing the top 100. Refine the search to narrow it.");
    expect(urls(fetchMock)).toContain(searchUrl(100));
  });

  it("starts a new search at 20 and shows placeholders instead of the old rows", async () => {
    const next = deferred();
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [searchUrl(40)]: () => reply(200, { results: results(40), hasMore: true }),
      "/api/search?q=laptop&limit=20&mode=hybrid": next.route,
    });
    renderAt("/search?q=ryzen&n=40");
    await screen.findByRole("link", { name: "Result 40" });

    const box = screen.getByRole("searchbox", { name: "Query" });
    fireEvent.change(box, { target: { value: "laptop" } });
    fireEvent.submit(box.closest("form")!);

    expect(await screen.findByTestId("location")).toHaveTextContent(/^\/search\?q=laptop$/);
    expect(urls(fetchMock)).toContain("/api/search?q=laptop&limit=20&mode=hybrid");
    expect(cards()).toHaveLength(0);
    expect(document.querySelector("main [aria-label='Loading']")).not.toBeNull();

    await next.release(reply(200, { results: [result(1)], hasMore: false }));
    expect(screen.getByTestId("result-count")).toHaveTextContent("1 result for “laptop”");
    expect(cards()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tag and Tags
// ---------------------------------------------------------------------------

function noteSummary(i: number): NoteSummary {
  const n = String(i).padStart(2, "0");
  return {
    slug: `college-note-${n}`,
    path: `notes/college-note-${n}.md`,
    title: `College note ${n}`,
    type: "note",
    summary: "",
    tags: ["college"],
    created: "2026-09-15",
    updated: "2026-09-15",
  };
}

const notes = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => noteSummary(from + i));
const notesUrl = (offset: number) => `/api/notes?tag=college&limit=50&offset=${offset}`;

describe("Tag page", () => {
  it("shows the total in the heading and Showing 50 of 93 beside the button", async () => {
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [notesUrl(0)]: () => reply(200, { items: notes(1, 50), total: 93, limit: 50, offset: 0 }),
    });
    renderAt("/tags/college");

    const button = await screen.findByRole("button", { name: "Show more notes" });
    const header = document.querySelector<HTMLElement>("[data-slot='page-header']")!;
    expect(within(header).getByText("93 notes")).toBeInTheDocument();
    expect(button).toHaveAccessibleDescription("Showing 50 of 93");
    expect(screen.getByText("Showing 50 of 93")).toBeInTheDocument();
    expect(cards()).toHaveLength(50);
    expect(urls(fetchMock)).toContain(notesUrl(0));
  });

  it("appends the next page from offset 50, focuses its first note, and hides the button when every note is loaded", async () => {
    const page2 = deferred();
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [notesUrl(0)]: () => reply(200, { items: notes(1, 50), total: 93, limit: 50, offset: 0 }),
      [notesUrl(50)]: page2.route,
    });
    renderAt("/tags/college");

    fireEvent.click(await screen.findByRole("button", { name: "Show more notes" }));

    expect(urls(fetchMock)).toContain(notesUrl(50));
    expect(cards()).toHaveLength(50);
    expect(screen.getByRole("button", { name: "Show more notes" })).toBeDisabled();

    await page2.release(reply(200, { items: notes(51, 93), total: 93, limit: 50, offset: 50 }));

    expect(cards()).toHaveLength(93);
    expect(cards().map((c) => within(c).getByRole("link", { name: /^College note/ }).textContent)).toEqual(
      notes(1, 93).map((n) => n.title),
    );
    expect(screen.getByRole("link", { name: "College note 51" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Show more notes" })).toBeNull();
    expect(screen.queryByText(/Showing \d+ of/)).toBeNull();
    expect(within(document.querySelector<HTMLElement>("[data-slot='page-header']")!).getByText("93 notes")).toBeInTheDocument();
  });

  it("shows no button when the first page holds every note", async () => {
    stubApi({
      "/api/tags": TAGS,
      [notesUrl(0)]: () => reply(200, { items: notes(1, 12), total: 12, limit: 50, offset: 0 }),
    });
    renderAt("/tags/college");

    await screen.findByRole("link", { name: "College note 12" });
    expect(screen.getByText("12 notes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more notes" })).toBeNull();
  });

  it("keeps the loaded notes and offers the button again when the next page fails", async () => {
    stubApi({
      "/api/tags": TAGS,
      [notesUrl(0)]: () => reply(200, { items: notes(1, 50), total: 93, limit: 50, offset: 0 }),
      [notesUrl(50)]: () => reply(500, { error: { code: "internal", message: "index exploded" } }),
    });
    renderAt("/tags/college");

    fireEvent.click(await screen.findByRole("button", { name: "Show more notes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("index exploded");
    expect(cards()).toHaveLength(50);
    expect(screen.getByRole("button", { name: "Show more notes" })).toBeEnabled();
  });
});

describe("Tags page", () => {
  it("makes one request and shows each tag's count", async () => {
    const fetchMock = stubApi({
      "/api/tags": () =>
        reply(200, [
          { name: "college", description: "BSIT degree", count: 93 },
          { name: "hardware", description: "Laptops and parts", count: 4 },
        ]),
    });
    renderAt("/tags");

    const table = await screen.findByRole("table", { name: "Tags" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["#college", "BSIT degree", "93"],
      ["#hardware", "Laptops and parts", "4"],
    ]);
    // The layout loads the pins once for every page; the Tags page itself asks for the tags alone.
    expect(urls(fetchMock).filter((u) => u !== "/api/pins")).toEqual(["/api/tags"]);
  });
});
