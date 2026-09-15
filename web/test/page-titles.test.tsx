import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { pageTitle } from "../src/lib/page-title";
import type { Note } from "../src/lib/types";

/*
 * Guards "Every page sets its own browser tab title" (DECISIONS.md, 2026-09-15). PageHeader sets it,
 * so each page gets "<name> · notes++" without writing document.title itself.
 */

/** The minimum of a fetch Response that lib/api.ts reads. */
function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body } as Response;
}

type Route = () => Response | Promise<Response>;

const notFound = () => reply(404, { error: { code: "not_found", message: "not found" } });
const serverError = () => reply(500, { error: { code: "internal", message: "Index is rebuilding" } });

function stubApi(routes: Record<string, Route>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (routes[url] ?? notFound)()),
  );
}

let navigate: NavigateFunction = () => {};
function NavigateProbe() {
  navigate = useNavigate();
  return null;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <NavigateProbe />
    </MemoryRouter>,
  );
}

function note(slug: string, title: string): Note {
  const dates = { created: "2026-09-15", updated: "2026-09-15" };
  return {
    slug,
    path: `notes/${slug}.md`,
    title,
    type: "hub",
    summary: "",
    tags: ["college"],
    ...dates,
    frontmatter: { title, type: "hub", summary: "", tags: ["college"], ...dates },
    body: "Body text.",
    raw: "",
    links: [],
    mentions: [],
    mtimeMs: 0,
  };
}

const INDEX = note("index", "Index");
const COLLEGE = note("college", "College");

const ROUTES: Record<string, Route> = {
  "/api/notes/index": () => reply(200, INDEX),
  "/api/stats": () => reply(200, { notes: 143, files: 71, invalid: 0 }),
  "/api/notes/college": () => reply(200, COLLEGE),
  "/api/notes/college/backlinks": () => reply(200, []),
  "/api/notes/college/trail": () => reply(200, { trail: [{ slug: "index", title: "Index" }], inHub: true }),
  "/api/tags": () => reply(200, [{ name: "college", description: "BSIT degree", count: 1 }]),
  "/api/search?q=rizal&limit=20&mode=hybrid": () => reply(200, { results: [], hasMore: false }),
  "/api/notes?tag=college&limit=50&offset=0": () => reply(200, { items: [], total: 0, limit: 50, offset: 0 }),
  "/api/files": () => reply(200, []),
  "/api/inbox": () => reply(200, []),
  "/api/check-links": () => reply(200, { brokenLinks: [], missingFiles: [], missingSources: [], invalidNotes: [], notesWithoutHub: [], notesInSeveralHubs: [], missingPins: [] }),
};

beforeEach(() => {
  // Proves each page sets the title rather than inheriting one.
  document.title = "stale";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pageTitle", () => {
  it("adds the app name after the page name, or gives the app name alone", () => {
    expect(pageTitle("Tags")).toBe("Tags · notes++");
    expect(pageTitle("")).toBe("notes++");
    expect(pageTitle(undefined)).toBe("notes++");
  });
});

describe("every page sets the tab title", () => {
  it.each([
    ["/", "Index", "notes++"],
    ["/notes/college", "College", "College · notes++"],
    ["/search?q=rizal", "Search", "Search: rizal · notes++"],
    ["/search", "Search", "Search · notes++"],
    ["/tags/college", "#college", "#college · notes++"],
    ["/tags", "Tags", "Tags · notes++"],
    ["/files", "Files", "Files · notes++"],
    ["/inbox", "Inbox", "Inbox · notes++"],
    ["/check", "Check", "Check · notes++"],
    ["/no-such-page", "Not found", "Not found · notes++"],
    ["/notes/no-such-note", "Note not found", "Note not found · notes++"],
  ])("%s", async (path, heading, title) => {
    stubApi(ROUTES);
    renderAt(path);
    await screen.findByRole("heading", { level: 1, name: heading });
    expect(document.title).toBe(title);
  });

  it("follows the query when a new search runs on the same page", async () => {
    stubApi({ ...ROUTES, "/api/search?q=ryzen&limit=20&mode=hybrid": () => reply(200, { results: [], hasMore: false }) });
    renderAt("/search?q=rizal");
    await screen.findByRole("heading", { level: 1, name: "Search" });
    expect(document.title).toBe("Search: rizal · notes++");
    await act(async () => navigate("/search?q=ryzen"));
    expect(document.title).toBe("Search: ryzen · notes++");
  });

  it("goes back to the app name while a note loads and when it fails, never keeping the previous page's", async () => {
    let fail: () => void = () => {};
    stubApi({ ...ROUTES, "/api/notes/broken": () => new Promise<Response>((resolve) => (fail = () => resolve(serverError()))) });
    renderAt("/tags");
    await screen.findByRole("heading", { level: 1, name: "Tags" });
    expect(document.title).toBe("Tags · notes++");

    await act(async () => navigate("/notes/broken"));
    expect(document.title).toBe("notes++");

    await act(async () => fail());
    expect(await screen.findByRole("alert")).toHaveTextContent("Index is rebuilding");
    expect(document.title).toBe("notes++");
  });
});
