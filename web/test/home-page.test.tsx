import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { buildDomains } from "../src/components/domains";
import type { Note, NoteSummary, TagWithCount } from "../src/lib/types";
import { apiError, callsTo, reply, resetToasts, settle, stubApi, summary, type Route } from "./api-stub";

/*
 * Home leads with the domains the root hub lists, and the navigation drawer lists them too
 * (DECISIONS.md, 2026-11-03, "Home leads with the domains; the drawer lists them too"). The brain
 * here is shaped like the owner's: four domains under `index`, and one sub-hub under College.
 */

function hub(slug: string, title: string, tags: string[], updated = "2026-11-01"): NoteSummary {
  return { ...summary(slug, title, "hub"), tags, updated };
}

const INDEX = hub("index", "Index", []);
const FIELDS = hub("fields", "Fields", ["fields"], "2026-10-30");
const COLLEGE = hub("college", "College", ["college"], "2026-11-02");
// The tag named like the slug wins over the first tag.
const CCNA = hub("ccna", "CCNA", ["networking", "ccna"]);
const DEV_SETUP = hub("dev-setup", "Dev setup", ["dev-setup"]);
const RIZAL = hub("ge09-life-and-works-of-rizal", "GE09 Life and Works of Rizal", ["college"]);
/** As GET /api/notes?type=hub returns them, by title. */
const HUBS = [CCNA, COLLEGE, DEV_SETUP, FIELDS, RIZAL, INDEX];

const TAGS: TagWithCount[] = [
  { name: "ccna", description: "", count: 2 },
  { name: "college", description: "", count: 143 },
  { name: "dev-setup", description: "", count: 2 },
  { name: "fields", description: "", count: 126 },
  { name: "networking", description: "", count: 9 },
];

function asNote(n: NoteSummary, links: string[] = [], body = "Body text."): Note {
  return {
    ...n,
    frontmatter: { title: n.title, type: n.type, summary: n.summary, tags: n.tags, created: n.created, updated: n.updated },
    body,
    raw: "",
    links,
    mentions: [],
    mtimeMs: 0,
  };
}

/** The root hub: the four domains, then a plain note and a slug with no note, which are not domains. */
const ROOT = asNote(INDEX, ["fields", "college", "ccna", "dev-setup", "readme", "gone"], "The root hub.");

const HUBS_URL = "/api/notes?type=hub&limit=500";
const page = (items: NoteSummary[]) => ({ items, total: items.length, limit: 50, offset: 0 });

const BRAIN: Record<string, Route> = {
  "/api/notes/index": () => reply(200, ROOT),
  [HUBS_URL]: () => reply(200, { ...page(HUBS), limit: 500 }),
  "/api/tags": () => reply(200, TAGS),
  "/api/stats": () => reply(200, { notes: 305, files: 71, invalid: 0 }),
  "/api/notes?sort=created&limit=50": () => reply(200, page([])),
  "/api/pins": () => reply(200, { home: [], sidebar: [] }),
  "/api/bookmarks": () => reply(200, { groups: [] }),
};

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

async function renderAt(path: string, routes: Record<string, Route> = {}) {
  const fetchMock = stubApi({ ...BRAIN, ...routes });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
  await settle();
  return fetchMock;
}

const region = (name: string) => screen.getByRole("region", { name });
const domainCards = () => Array.from(region("Domains").querySelectorAll<HTMLElement>("[data-slot='domain-card']"));
const drawer = () => document.querySelector<HTMLElement>("[data-slot='navigation-drawer']")!;
const rail = () => document.querySelector<HTMLElement>("[data-slot='navigation-rail']")!;
const topAppBar = () => document.querySelector<HTMLElement>("[data-slot='top-app-bar']")!;
const links = (root: HTMLElement) => within(root).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);

afterEach(() => {
  resetToasts();
  vi.unstubAllGlobals();
});

describe("buildDomains", () => {
  it("takes the hubs the root hub links to, in its order, skipping links that are not hubs", () => {
    const domains = buildDomains(ROOT.links, HUBS, TAGS);
    expect(domains.map((d) => d.slug)).toEqual(["fields", "college", "ccna", "dev-setup"]);
    expect(domains[1]).toEqual({
      slug: "college",
      title: "College",
      updated: "2026-11-02",
      tag: "college",
      count: 143,
      subHubs: [{ slug: RIZAL.slug, title: RIZAL.title, type: "hub" }],
    });
    expect(domains[2]!.tag).toBe("ccna");
  });

  it("lists as sub-hubs the other hubs carrying the domain's tag, by title, never another domain or the root", () => {
    const tagged = (slug: string, title: string) => hub(slug, title, ["college"]);
    // Fields also carries #college, but it is a domain of its own.
    const fields = hub("fields", "Fields", ["fields", "college"]);
    const hubs = [COLLEGE, fields, tagged("thesis", "Thesis"), tagged("ge09", "GE09"), { ...INDEX, tags: ["college"] }];
    const college = buildDomains(["college", "fields"], hubs, TAGS)[0]!;
    expect(college.subHubs.map((h) => h.title)).toEqual(["GE09", "Thesis"]);
  });

  it("falls back to the first tag, and leaves the tag, count, and sub-hubs empty for a hub without tags", () => {
    const work = hub("work", "Work", ["projects", "fields"]);
    const bare = hub("misc", "Misc", []);
    const [first, second] = buildDomains(["work", "misc"], [work, bare, FIELDS], TAGS);
    expect(first).toMatchObject({ tag: "projects", count: undefined, subHubs: [] });
    expect(second).toMatchObject({ tag: undefined, count: undefined, subHubs: [] });
  });
});

describe("Home", () => {
  it("is titled Home, keeps the app name as the tab title, and no longer renders the root hub's text", async () => {
    await renderAt("/");
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(document.title).toBe("notes++");
    expect(screen.queryByText("The root hub.")).toBeNull();
    expect(within(region("Domains")).getByRole("link", { name: "Open index" })).toHaveAttribute("href", "/notes/index");
  });

  it("shows a card per domain in the root hub's order, each linking to its hub, its sub-hubs, and its tag", async () => {
    await renderAt("/");
    const cards = domainCards();
    expect(cards.map((c) => within(c).getByRole("heading", { level: 3 }).textContent)).toEqual(["Fields", "College", "CCNA", "Dev setup"]);

    const college = cards[1]!;
    const title = within(college).getByRole("link", { name: "College" });
    expect(title).toHaveAttribute("href", "/notes/college");
    // The title link stretches over the card, so the whole card opens the hub.
    expect(title).toHaveAttribute("data-card-link");
    expect(within(college).getByText("updated 2026-11-02")).toBeInTheDocument();
    expect(within(college).getByRole("link", { name: RIZAL.title })).toHaveAttribute("href", `/notes/${RIZAL.slug}`);
    expect(within(college).getByRole("link", { name: "143 notes" })).toHaveAttribute("href", "/tags/college");
    expect(within(cards[2]!).getByRole("link", { name: "2 notes" })).toHaveAttribute("href", "/tags/ccna");
    // Fields has no sub-hubs, so no chips.
    expect(cards[0]!.querySelector("[data-slot='note-chip']")).toBeNull();
    expect(college.querySelector("[data-slot='note-chip']")).not.toBeNull();
  });

  it("puts the domains and pins first, then Recent, Bookmarks, and Stats", async () => {
    const pin = { ...summary("rizal-day", "Rizal Day"), tags: ["college"] };
    await renderAt("/", {
      "/api/pins": () => reply(200, { home: [pin], sidebar: [] }),
      "/api/notes?sort=created&limit=50": () => reply(200, page([pin])),
      "/api/bookmarks": () => reply(200, { groups: [{ name: "thesis", slugs: ["rizal-day"] }] }),
    });
    const order = ["Domains", "Pinned", "Recent", "Bookmarks", "Stats"].map(region);
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("shows the No root hub yet notice in the Domains spot and asks for nothing else of the domains", async () => {
    const fetchMock = await renderAt("/", { "/api/notes/index": () => apiError(404, "not_found", "no note index") });
    const notice = within(region("Domains")).getByRole("alert");
    expect(notice).toHaveTextContent("No root hub yet");
    expect(within(region("Domains")).queryByRole("link", { name: "Open index" })).toBeNull();
    expect(callsTo(fetchMock, `GET ${HUBS_URL}`)).toHaveLength(0);
    expect(callsTo(fetchMock, "GET /api/tags")).toHaveLength(0);
    expect(within(drawer()).queryByRole("navigation", { name: "Domains" })).toBeNull();
  });

  it("offers one Try again for domains and stats that failed together, and reloads both", async () => {
    let hubAttempts = 0;
    let statAttempts = 0;
    const fetchMock = await renderAt("/", {
      [HUBS_URL]: () => (++hubAttempts === 1 ? apiError(500, "internal", "Index is rebuilding") : reply(200, { ...page(HUBS), limit: 500 })),
      "/api/stats": () => (++statAttempts === 1 ? apiError(500, "internal", "Stats exploded") : reply(200, { notes: 305, files: 71, invalid: 0 })),
    });
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(region("Domains")).toContainElement(alerts[0]!);
    expect(screen.queryByRole("region", { name: "Stats" })).toBeNull();

    await act(async () => {
      fireEvent.click(within(alerts[0]!).getByRole("button", { name: "Try again" }));
    });
    await settle();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(domainCards()).toHaveLength(4);
    expect(within(region("Stats")).getByRole("link", { name: "Notes" })).toBeInTheDocument();
    expect(callsTo(fetchMock, `GET ${HUBS_URL}`)).toHaveLength(2);
    expect(callsTo(fetchMock, "GET /api/stats")).toHaveLength(2);
  });

  it("puts the notice in the Stats spot when only the stats fail, and Try again reloads only them", async () => {
    let attempts = 0;
    const fetchMock = await renderAt("/", {
      "/api/stats": () => (++attempts === 1 ? apiError(500, "internal", "Stats exploded") : reply(200, { notes: 305, files: 71, invalid: 0 })),
    });
    const alert = screen.getByRole("alert");
    expect(region("Domains")).not.toContainElement(alert);
    expect(domainCards()).toHaveLength(4);

    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    });
    await settle();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(region("Stats")).toBeInTheDocument();
    expect(callsTo(fetchMock, "GET /api/notes/index")).toHaveLength(1);
  });
});

describe("Home's Bookmarks pane", () => {
  it("lists each group with its note count, opening that group on the Bookmarks page", async () => {
    await renderAt("/", {
      "/api/bookmarks": () =>
        reply(200, {
          groups: [
            { name: "fields-meetings", slugs: ["a", "b", "c"] },
            { name: "thesis", slugs: [] },
          ],
        }),
    });
    const rows = Array.from(region("Bookmarks").querySelectorAll<HTMLElement>("[data-slot='link-row']"));
    expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual(["fields meetings", "thesis"]);
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", "/bookmarks#bookmark-group-fields-meetings");
    expect(within(rows[1]!).getByRole("link")).toHaveAttribute("href", "/bookmarks#bookmark-group-thesis");
    expect(rows[0]).toHaveTextContent("3");
    expect(rows[1]).toHaveTextContent("0");
  });

  it("is left out when there are no groups", async () => {
    await renderAt("/");
    expect(screen.queryByRole("region", { name: "Bookmarks" })).toBeNull();
  });

  it("is left out quietly when the bookmarks fail to load", async () => {
    await renderAt("/", { "/api/bookmarks": () => apiError(500, "internal", "bookmarks.yml is broken") });
    expect(screen.queryByRole("region", { name: "Bookmarks" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Home's stats", () => {
  /** The number at the end of a stat's row. */
  const value = (name: string, text: string) =>
    within(within(region("Stats")).getByRole("link", { name }).closest<HTMLElement>("[data-slot='link-row']")!).getByText(text);

  it("lists notes, files, and invalid notes, each opening the page behind it", async () => {
    await renderAt("/");
    expect(links(region("Stats"))).toEqual([
      ["Notes", "/tags"],
      ["Files", "/files"],
      ["Invalid notes", "/check"],
    ]);
    expect(value("Notes", "305")).not.toHaveClass("text-error");
    expect(value("Files", "71")).not.toHaveClass("text-error");
    expect(value("Invalid notes", "0")).not.toHaveClass("text-error");
  });

  it("paints the invalid count in the error colour once there are any", async () => {
    await renderAt("/", { "/api/stats": () => reply(200, { notes: 305, files: 71, invalid: 3 }) });
    expect(value("Invalid notes", "3")).toHaveClass("text-error");
    expect(value("Notes", "305")).not.toHaveClass("text-error");
  });
});

describe("the navigation drawer's Domains", () => {
  const domainsNav = (root: HTMLElement) => within(root).queryByRole("navigation", { name: "Domains" });

  it("lists the domains between the destinations and the pins, each with its letter, linking to its hub", async () => {
    await renderAt("/tags", { "/api/pins": () => reply(200, { home: [], sidebar: [summary("rizal-day", "Rizal Day")] }) });
    const nav = domainsNav(drawer())!;
    const rows = within(nav).getAllByRole("link");
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["/notes/fields", "/notes/college", "/notes/ccna", "/notes/dev-setup"]);
    // The letter is decoration; each link is named by the title alone.
    ["Fields", "College", "CCNA", "Dev setup"].forEach((name, i) => expect(rows[i]).toHaveAccessibleName(name));
    expect(rows[3]!.querySelector("[aria-hidden='true']")).toHaveTextContent("D");

    const main = within(drawer()).getByRole("navigation", { name: "Main" });
    const pins = within(drawer()).getByRole("navigation", { name: "Pinned" });
    expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(pins) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The rail keeps the destinations alone.
    expect(domainsNav(rail())).toBeNull();
  });

  it("marks the domain whose hub is open with the active colours", async () => {
    await renderAt("/notes/college", {
      "/api/notes/college": () => reply(200, asNote(COLLEGE)),
      "/api/notes/college/backlinks": () => reply(200, []),
      "/api/notes/college/trail": () => reply(200, { trail: [{ slug: "index", title: "Index" }], inHub: true }),
    });
    const nav = domainsNav(drawer())!;
    const active = within(nav).getByRole("link", { name: "College" });
    const other = within(nav).getByRole("link", { name: "Fields" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("bg-secondary-container", "text-on-secondary-container");
    expect(other).not.toHaveAttribute("aria-current");
    expect(other).toHaveClass("text-on-surface-variant");
  });

  it("shows nothing while the domains fail to load", async () => {
    await renderAt("/tags", { [HUBS_URL]: () => apiError(500, "internal", "Index is rebuilding") });
    expect(domainsNav(drawer())).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("appears in the modal drawer too, and a domain there closes it", async () => {
    await renderAt("/tags", {
      "/api/notes/fields": () => reply(200, asNote(FIELDS)),
      "/api/notes/fields/backlinks": () => reply(200, []),
      "/api/notes/fields/trail": () => reply(200, { trail: [{ slug: "index", title: "Index" }], inHub: true }),
    });
    fireEvent.click(within(topAppBar()).getByRole("button", { name: "Open menu" }));
    const sheet = await screen.findByRole("dialog");
    const nav = domainsNav(sheet)!;
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/notes/fields",
      "/notes/college",
      "/notes/ccna",
      "/notes/dev-setup",
    ]);

    fireEvent.click(within(nav).getByRole("link", { name: "Fields" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("location").textContent).toBe("/notes/fields");
  });
});
