import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { Note, NoteTrail } from "../src/lib/types";

/** The minimum of a fetch Response that lib/api.ts reads. */
function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body } as Response;
}

const notFound = () => reply(404, { error: { code: "not_found", message: "not found" } });

function note(slug: string, title: string, tags: string[], type: Note["type"] = "note"): Note {
  const dates = { created: "2026-09-15", updated: "2026-09-15" };
  return {
    slug,
    path: `notes/${slug}.md`,
    title,
    type,
    summary: "",
    tags,
    ...dates,
    frontmatter: { title, type, summary: "", tags, ...dates },
    body: "Body text.",
    raw: "",
    links: [],
    mtimeMs: 0,
  };
}

type Route = () => Response | Promise<Response>;

/** Answers each API path from routes (query string included) and everything else with a 404. */
function stubApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (url: string) => (routes[url] ?? notFound)());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/** The [text, href] of each link in the breadcrumb nav. */
function crumbs(): string[][] {
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  return within(nav)
    .getAllByRole("link")
    .map((a) => [a.textContent ?? "", a.getAttribute("href") ?? ""]);
}

/** Let pending fetch promises settle and React commit their results. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const RIZAL = note("rizal-day-is-rizals-death-anniversary", "Rizal Day is Rizal's death anniversary", ["college"]);
const NESTED_TRAIL: NoteTrail = {
  trail: [
    { slug: "index", title: "Index" },
    { slug: "college", title: "College" },
    { slug: "ge09-life-and-works-of-rizal", title: "GE09 Life and Works of Rizal" },
  ],
  inHub: true,
};

function noteRoutes(n: Note, trail: Route): Record<string, Route> {
  return {
    [`/api/notes/${n.slug}`]: () => reply(200, n),
    [`/api/notes/${n.slug}/backlinks`]: () => reply(200, []),
    [`/api/notes/${n.slug}/trail`]: trail,
  };
}

describe("note page breadcrumbs", () => {
  it("show Home while the trail loads, then the hubs above the note, without its own title", async () => {
    let finish: (res: Response) => void = () => {};
    const fetchMock = stubApi(noteRoutes(RIZAL, () => new Promise<Response>((resolve) => (finish = resolve))));
    renderAt(`/notes/${RIZAL.slug}`);

    await screen.findByRole("heading", { level: 1, name: RIZAL.title });
    expect(crumbs()).toEqual([["Home", "/"]]);
    expect(fetchMock).toHaveBeenCalledWith(`/api/notes/${RIZAL.slug}/trail`, undefined);

    await act(async () => finish(reply(200, NESTED_TRAIL)));

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["College", "/notes/college"],
      ["GE09 Life and Works of Rizal", "/notes/ge09-life-and-works-of-rizal"],
    ]);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).not.toHaveTextContent(RIZAL.title);
  });

  it("show Home › College for a college subject note", async () => {
    const college = note("itp221-networking-1", "ITP221 Networking 1", ["college"]);
    stubApi(noteRoutes(college, () => reply(200, { trail: [{ slug: "index", title: "Index" }, { slug: "college", title: "College" }], inHub: true })));
    renderAt(`/notes/${college.slug}`);

    expect(await screen.findByRole("link", { name: "College" })).toHaveAttribute("href", "/notes/college");
    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["College", "/notes/college"],
    ]);
  });

  it("fall back to Home › Tags › the first tag for a note no hub reaches", async () => {
    const orphan = note("laptop-transcript", "Laptop transcript", ["hardware", "laptop"]);
    stubApi(noteRoutes(orphan, () => reply(200, { trail: [], inHub: false })));
    renderAt(`/notes/${orphan.slug}`);

    const nav = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(await within(nav).findByRole("link", { name: "#hardware" })).toHaveAttribute("href", "/tags/hardware");
    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Tags", "/tags"],
      ["#hardware", "/tags/hardware"],
    ]);
    expect(nav.querySelector("[data-slot='tag-name']")).not.toBeNull();
  });

  it("keep Home and show no error when the trail request fails", async () => {
    stubApi(noteRoutes(RIZAL, () => reply(500, { error: { code: "internal", message: "trail exploded" } })));
    renderAt(`/notes/${RIZAL.slug}`);

    await screen.findByText("No notes link here.");
    await settle();

    expect(crumbs()).toEqual([["Home", "/"]]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("trail exploded")).toBeNull();
  });

  it("never show the previous note's trail after moving to a note whose trail fails", async () => {
    const from = { ...RIZAL, body: "See [[laptop-transcript]]." };
    const to = note("laptop-transcript", "Laptop transcript", []);
    stubApi({
      ...noteRoutes(from, () => reply(200, NESTED_TRAIL)),
      ...noteRoutes(to, () => reply(500, { error: { code: "internal", message: "trail exploded" } })),
    });
    renderAt(`/notes/${from.slug}`);

    const nav = await screen.findByRole("navigation", { name: "Breadcrumb" });
    await within(nav).findByRole("link", { name: "College" });

    fireEvent.click(screen.getByRole("link", { name: "laptop-transcript" }));
    await screen.findByRole("heading", { level: 1, name: "Laptop transcript" });
    await settle();

    expect(crumbs()).toEqual([["Home", "/"]]);
  });

  it("show Home on the note 404", async () => {
    stubApi({});
    renderAt("/notes/missing-note");

    await screen.findByRole("heading", { level: 1, name: "Note not found" });
    expect(crumbs()).toEqual([["Home", "/"]]);
  });
});

describe("other pages", () => {
  it("the Tag page shows Home › Tags", async () => {
    stubApi({
      "/api/notes?tag=college&limit=50&offset=0": () => reply(200, { items: [], total: 0, limit: 50, offset: 0 }),
      "/api/tags": () => reply(200, [{ name: "college", description: "BSIT degree", count: 0 }]),
    });
    renderAt("/tags/college");

    await screen.findByText("No notes carry this tag.");
    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Tags", "/tags"],
    ]);
  });

  it.each([
    ["/search", "Search"],
    ["/tags", "Tags"],
    ["/files", "Files"],
    ["/inbox", "Inbox"],
    ["/check", "Check"],
    ["/no-such-page", "Not found"],
  ])("%s shows Home", async (path, title) => {
    stubApi({
      "/api/tags": () => reply(200, []),
      "/api/files": () => reply(200, []),
      "/api/inbox": () => reply(200, []),
      "/api/check-links": () =>
        reply(200, { brokenLinks: [], missingFiles: [], missingSources: [], invalidNotes: [] }),
    });
    renderAt(path);

    await screen.findByRole("heading", { level: 1, name: title });
    expect(crumbs()).toEqual([["Home", "/"]]);
    await settle();
  });

  it("the Home page has no breadcrumbs", async () => {
    stubApi({
      "/api/notes/index": () => reply(200, note("index", "Index", [], "hub")),
      "/api/stats": () => reply(200, { notes: 1, files: 0, invalid: 0 }),
    });
    renderAt("/");

    await screen.findByRole("heading", { level: 1, name: "Index" });
    await settle();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });
});
