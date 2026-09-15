import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { Note, NoteSummary } from "../src/lib/types";
import { callsTo, deferred, pinned, reply, resetToasts, settle, stubApi, summary, type Route } from "./api-stub";

const RIZAL = summary("rizal-day", "Rizal Day");
const BUDGET = summary("fields-budget", "Fields budget", "hub");
const LONG = summary(
  "ge09-life-and-works-of-rizal-module-3",
  "GE09 Life and Works of Rizal: Module 3, the Noli Me Tangere and the novels that followed it",
  "source",
);

function note(n: NoteSummary, body = "Body text."): Note {
  return {
    ...n,
    frontmatter: { title: n.title, type: n.type, summary: n.summary, tags: n.tags, created: n.created, updated: n.updated },
    body,
    raw: "",
    links: [],
    mentions: [],
    mtimeMs: 0,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderAt(path: string, routes: Record<string, Route>) {
  const fetchMock = stubApi({
    "/api/stats": () => reply(200, { notes: 3, files: 0, invalid: 0 }),
    "/api/notes/index": () => reply(200, note(summary("index", "Index", "hub"), "The root hub.")),
    ...routes,
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
  return fetchMock;
}

const noteRoutes = (n: NoteSummary, backlinks: NoteSummary[] = []): Record<string, Route> => ({
  [`/api/notes/${n.slug}`]: () => reply(200, note(n)),
  [`/api/notes/${n.slug}/backlinks`]: () => reply(200, backlinks),
  [`/api/notes/${n.slug}/trail`]: () => reply(200, { trail: [], inHub: false }),
});

const location = () => screen.getByTestId("location").textContent;

/** The cards in Home's Pinned section, by title. */
function pinnedCards() {
  const section = screen.getByRole("region", { name: "Pinned" });
  return Array.from(section.querySelectorAll<HTMLElement>("[data-slot='item-card']"));
}
const titles = (cards: HTMLElement[]) => cards.map((c) => within(c).getAllByRole("link")[0]!.textContent);

async function openMenuOf(title: string, root: HTMLElement = document.body) {
  const button = within(root).getByRole("button", { name: `More actions for ${title}` });
  act(() => button.focus());
  fireEvent.keyDown(button, { key: "Enter" });
  await screen.findByRole("menu");
  return button;
}

afterEach(() => {
  resetToasts();
  vi.unstubAllGlobals();
});

describe("Home: Pinned", () => {
  it("lists the Home pins at the top as compact cards in pin order, each with its menu", async () => {
    renderAt("/", { "/api/pins": () => reply(200, pinned([BUDGET, RIZAL, LONG])) });

    const heading = await screen.findByRole("heading", { level: 2, name: "Pinned" });
    expect(heading).toHaveAttribute("data-slot", "section-heading");
    const cards = pinnedCards();
    expect(titles(cards)).toEqual([BUDGET.title, RIZAL.title, LONG.title]);
    expect(within(cards[0]!).getByRole("link")).toHaveAttribute("href", "/notes/fields-budget");
    expect(within(cards[0]!).getByText("hub")).toBeInTheDocument();
    // Compact: no summary, tags, or dates.
    expect(cards[0]!.querySelector("[data-slot='meta-row']")).toBeNull();
    for (const card of cards) {
      expect(within(card).getByRole("button", { name: /^More actions for / })).toBeInTheDocument();
    }

    // Above the stats and the root hub's content.
    const section = heading.closest("section")!;
    const stats = screen.getByLabelText("Stats");
    expect(section.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(screen.getByText("The root hub.")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows nothing without Home pins", async () => {
    renderAt("/", { "/api/pins": () => reply(200, pinned([], [RIZAL])) });
    await screen.findByText("The root hub.");
    await settle();
    expect(screen.queryByRole("heading", { name: "Pinned" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Pinned" })).toBeNull();
  });

  it("shows nothing when the pins fail to load", async () => {
    renderAt("/", {});
    await screen.findByText("The root hub.");
    await settle();
    expect(screen.queryByRole("region", { name: "Pinned" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moves a card up from its menu, keeps focus on that card's button, and puts the new order", async () => {
    const order = deferred();
    const fetchMock = renderAt("/", {
      "/api/pins": () => reply(200, pinned([BUDGET, RIZAL, LONG])),
      "PUT /api/pins/home/order": order.route,
    });
    await screen.findByRole("region", { name: "Pinned" });

    const button = await openMenuOf(RIZAL.title, pinnedCards()[1]!);
    expect(screen.getByRole("menuitem", { name: "Move up" })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));

    expect(titles(pinnedCards())).toEqual([RIZAL.title, BUDGET.title, LONG.title]);
    await waitFor(() => expect(button).toHaveFocus());
    await settle();
    expect(callsTo(fetchMock, "PUT /api/pins/home/order").map((c) => c.body)).toEqual([
      { slugs: [RIZAL.slug, BUDGET.slug, LONG.slug] },
    ]);

    await order.release(reply(200, pinned([RIZAL, BUDGET, LONG])));
    expect(titles(pinnedCards())).toEqual([RIZAL.title, BUDGET.title, LONG.title]);
  });

  it("moves focus to the next card's menu when a card unpins itself", async () => {
    renderAt("/", {
      "/api/pins": () => reply(200, pinned([BUDGET, RIZAL, LONG])),
      "PUT /api/pins/home": () => reply(200, pinned([BUDGET, LONG])),
    });
    await screen.findByRole("region", { name: "Pinned" });

    await openMenuOf(RIZAL.title, pinnedCards()[1]!);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Pin to Home" }));

    expect(titles(pinnedCards())).toEqual([BUDGET.title, LONG.title]);
    await waitFor(() => expect(screen.getByRole("button", { name: `More actions for ${LONG.title}` })).toHaveFocus());
    expect(await screen.findByText("Unpinned from Home")).toBeInTheDocument();
  });
});

describe("Sidebar: Pinned", () => {
  const pinnedNav = (root: HTMLElement = document.body) => within(root).queryByRole("navigation", { name: "Pinned" });

  it("lists the sidebar pins under the page links, in pin order, with a type icon and the full title as the name", async () => {
    renderAt("/tags", { "/api/pins": () => reply(200, pinned([], [LONG, RIZAL, BUDGET])), "/api/tags": () => reply(200, []) });

    const nav = await screen.findByRole("navigation", { name: "Pinned" });
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      [LONG.title, `/notes/${LONG.slug}`],
      [RIZAL.title, `/notes/${RIZAL.slug}`],
      [BUDGET.title, `/notes/${BUDGET.slug}`],
    ]);
    // Two lines at most, cut with an ellipsis; the whole title stays the link's name and its tooltip.
    const long = within(nav).getByRole("link", { name: LONG.title });
    expect(long.querySelector("span")).toHaveClass("line-clamp-2");
    expect(long).toHaveAttribute("title", LONG.title);
    expect(long.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(nav.innerHTML).not.toMatch(/overflow-x-(auto|scroll)/);

    for (const title of [LONG.title, RIZAL.title, BUDGET.title]) {
      expect(within(nav).getByRole("button", { name: `More actions for ${title}` })).toBeInTheDocument();
    }
  });

  it("gives the current note's link the nav's active style", async () => {
    renderAt(`/notes/${RIZAL.slug}`, { "/api/pins": () => reply(200, pinned([], [BUDGET, RIZAL])), ...noteRoutes(RIZAL) });

    const nav = await screen.findByRole("navigation", { name: "Pinned" });
    const active = within(nav).getByRole("link", { name: RIZAL.title });
    const other = within(nav).getByRole("link", { name: BUDGET.title });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("bg-sidebar-accent", "text-sidebar-accent-foreground");
    expect(other).not.toHaveAttribute("aria-current");
    expect(other).not.toHaveClass("bg-sidebar-accent");

    // The same classes the page links use when theirs is the current page.
    const tagsLink = within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Tags" });
    fireEvent.click(tagsLink);
    await waitFor(() => expect(tagsLink).toHaveClass("bg-sidebar-accent", "text-sidebar-accent-foreground"));
  });

  it("shows nothing without sidebar pins", async () => {
    renderAt("/tags", { "/api/pins": () => reply(200, pinned([RIZAL], [])), "/api/tags": () => reply(200, []) });
    await screen.findByRole("heading", { level: 1, name: "Tags" });
    await settle();
    expect(pinnedNav()).toBeNull();
  });

  it("appears in the mobile menu too, and a link there closes it", async () => {
    renderAt("/tags", {
      "/api/pins": () => reply(200, pinned([], [RIZAL, BUDGET])),
      "/api/tags": () => reply(200, []),
      ...noteRoutes(RIZAL),
    });
    await screen.findByRole("navigation", { name: "Pinned" });

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const sheet = await screen.findByRole("dialog");
    // Opening the menu focuses Close, as before pins, rather than the first pin's menu button.
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "Close" })).toHaveFocus());
    const nav = pinnedNav(sheet)!;
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([RIZAL.title, BUDGET.title]);

    fireEvent.click(within(nav).getByRole("link", { name: RIZAL.title }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(location()).toBe(`/notes/${RIZAL.slug}`);
  });

  it("offers Move down from a sidebar link's menu", async () => {
    const fetchMock = renderAt("/tags", {
      "/api/pins": () => reply(200, pinned([], [RIZAL, BUDGET])),
      "/api/tags": () => reply(200, []),
      "PUT /api/pins/sidebar/order": () => reply(200, pinned([], [BUDGET, RIZAL])),
    });
    const nav = await screen.findByRole("navigation", { name: "Pinned" });

    await openMenuOf(RIZAL.title, nav);
    expect(screen.getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Move down" }));

    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([BUDGET.title, RIZAL.title]);
    await settle();
    expect(callsTo(fetchMock, "PUT /api/pins/sidebar/order").map((c) => c.body)).toEqual([{ slugs: [BUDGET.slug, RIZAL.slug] }]);
  });
});

describe("the menu on the note page and on note cards", () => {
  it("sits at the right of the note page's title row and opens without navigating", async () => {
    renderAt(`/notes/${RIZAL.slug}`, { "/api/pins": () => reply(200, pinned([RIZAL])), ...noteRoutes(RIZAL) });

    const heading = await screen.findByRole("heading", { level: 1, name: RIZAL.title });
    const header = heading.closest("header")!;
    const actions = header.querySelector("[data-slot='page-header-actions']")!;
    const button = within(actions as HTMLElement).getByRole("button", { name: `More actions for ${RIZAL.title}` });
    // Same row as the title: the actions and the title's block are siblings in one flex row.
    expect(actions.parentElement).toBe(heading.parentElement!.parentElement!.parentElement);

    fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(button);
    expect(await screen.findByRole("menuitemcheckbox", { name: "Pin to Home" })).toHaveAttribute("aria-checked", "true");
    expect(location()).toBe(`/notes/${RIZAL.slug}`);
  });

  it("is on every Backlinks card, and opening it does not follow the card's link", async () => {
    renderAt(`/notes/${RIZAL.slug}`, { "/api/pins": () => reply(200, pinned([])), ...noteRoutes(RIZAL, [BUDGET]) });

    const section = (await screen.findByRole("heading", { level: 2, name: "Backlinks" })).closest("section")!;
    const card = (await within(section).findByRole("link", { name: BUDGET.title })).closest<HTMLElement>("[data-slot='item-card']")!;
    const button = within(card).getByRole("button", { name: `More actions for ${BUDGET.title}` });

    fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(button);
    await screen.findByRole("menu");
    expect(location()).toBe(`/notes/${RIZAL.slug}`);
  });

  it("is on every Tag page card", async () => {
    renderAt("/tags/college", {
      "/api/pins": () => reply(200, pinned([])),
      "/api/tags": () => reply(200, [{ name: "college", description: "", count: 2 }]),
      "/api/notes?tag=college&limit=50&offset=0": () => reply(200, { items: [RIZAL, BUDGET], total: 2, limit: 50, offset: 0 }),
    });

    await screen.findByRole("link", { name: RIZAL.title });
    const cards = Array.from(document.querySelectorAll<HTMLElement>("main [data-slot='item-card']"));
    expect(cards.map((c) => within(c).getByRole("button", { name: /^More actions for / }).getAttribute("aria-label"))).toEqual([
      `More actions for ${RIZAL.title}`,
      `More actions for ${BUDGET.title}`,
    ]);

    const button = within(cards[0]!).getByRole("button", { name: `More actions for ${RIZAL.title}` });
    fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(button);
    await screen.findByRole("menu");
    expect(location()).toBe("/tags/college");
  });
});
