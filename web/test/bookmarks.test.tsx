import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupActionsMenu, NoteActionsMenu } from "../src/components/note-actions-menu";
import { PinsProvider } from "../src/components/pins";
import type { BookmarkLists, NoteSummary } from "../src/lib/types";
import { BookmarksPage } from "../src/pages/bookmarks";
import { apiError, callsTo, pinned, reply, resetToasts, settle, stubApi, summary, type Route } from "./api-stub";

const RIZAL = summary("rizal-day", "Rizal Day");
const GROUPS = { groups: [{ name: "college", slugs: ["rizal-day"] }, { name: "to-read", slugs: [] }] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Bookmark dialog", () => {
  async function openFromMenu() {
    stubApi({ "/api/pins": () => reply(200, pinned([], [])), "/api/bookmarks": () => reply(200, GROUPS) });
    render(
      <MemoryRouter>
        <PinsProvider>
          <NoteActionsMenu note={RIZAL} />
        </PinsProvider>
      </MemoryRouter>,
    );
    await settle();
    const trigger = screen.getByRole("button", { name: "More actions for Rizal Day" });
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("button", { name: "Bookmark" }));
    return screen.findByRole("dialog", { name: "Bookmark “Rizal Day”" });
  }

  it("lists each group as a checkbox, checked where the note is bookmarked", async () => {
    const dialog = await openFromMenu();
    await waitFor(() => expect(within(dialog).getByRole("checkbox", { name: "college" })).toBeChecked());
    expect(within(dialog).getByRole("checkbox", { name: "to read" })).not.toBeChecked();
    expect(within(dialog).getByRole("textbox", { name: "New bookmark group" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(["", "Cancel", "Save"]);
    expect(within(dialog).getByRole("button", { name: "Add to new group" })).toBeDisabled();
  });

  it("leaves the field and its caret alone when the pointer moves over it, though the menu item around the button would take focus", async () => {
    const dialog = await openFromMenu();
    const field = within(dialog).getByRole<HTMLInputElement>("textbox", { name: "New bookmark group" });
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "Readings" } });
    field.setSelectionRange(8, 8);
    fireEvent.pointerMove(field, { pointerType: "mouse" });
    expect(field).toHaveFocus();
    // Focus pulled out and back by the dialog's focus trap would select the whole text.
    expect([field.selectionStart, field.selectionEnd]).toEqual([8, 8]);
  });

  it("Cancel closes it", async () => {
    const dialog = await openFromMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("<GroupActionsMenu>", () => {
  async function open(index: number, count: number, onMove = vi.fn()) {
    render(<GroupActionsMenu name="to read" index={index} count={count} onMove={onMove} />);
    const trigger = screen.getByRole("button", { name: "More actions for to read" });
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen.findByRole("menu");
  }

  it("offers Move up and Move down, the first disabled for the top group", async () => {
    const menu = await open(0, 2);
    expect(within(menu).getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Move down" })).not.toHaveAttribute("aria-disabled");
  });

  it("Move down calls onMove", async () => {
    const onMove = vi.fn();
    const menu = await open(0, 2, onMove);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Move down" }));
    expect(onMove).toHaveBeenCalledWith("down");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("disables Move down for the bottom group", async () => {
    const menu = await open(1, 2);
    expect(within(menu).getByRole("menuitem", { name: "Move down" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Move up" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("the Bookmarks page", () => {
  const PREFERENCES_KEY = "notesplusplus.bookmarks.preferences";
  const LEADS: NoteSummary = {
    ...summary("lead-list", "Lead list"),
    summary: "Who to call this week",
    tags: ["sales"],
    created: "2026-09-01",
    updated: "2026-10-02",
  };
  const PRICING = summary("pricing", "Pricing sheet", "source");
  const PAGE_GROUPS: BookmarkLists = { groups: [{ name: "fields-sales", slugs: ["lead-list", "pricing"] }, { name: "college", slugs: [] }] };
  const NOTES = () => reply(200, { items: [LEADS, PRICING], total: 2, limit: 500, offset: 0 });
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let scrolled: string[];

  beforeEach(() => {
    window.localStorage.clear();
    scrolled = [];
    // jsdom has no scrollIntoView. Each call records the element and how many links it held at that moment.
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(`${this.id}:${this.querySelectorAll("a").length}`);
    });
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    resetToasts();
  });

  function savePreferences(preferences: object) {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }

  function savedPreferences() {
    return JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}");
  }

  function renderPage({ path = "/bookmarks", routes = {} }: { path?: string; routes?: Record<string, Route> } = {}) {
    const fetchMock = stubApi({
      "/api/pins": () => reply(200, pinned([], [])),
      "/api/bookmarks": () => reply(200, PAGE_GROUPS),
      "/api/notes?limit=500": NOTES,
      ...routes,
    });
    render(
      <MemoryRouter initialEntries={[path]}>
        <PinsProvider>
          <BookmarksPage />
        </PinsProvider>
        <Toaster />
      </MemoryRouter>,
    );
    return fetchMock;
  }

  async function renderLoaded(options?: Parameters<typeof renderPage>[0]) {
    const fetchMock = renderPage(options);
    await screen.findByRole("button", { name: /^fields sales/ });
    return fetchMock;
  }

  const groupButton = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
  const panelOf = (group: string) => document.getElementById(`bookmark-group-${group}-notes`)!;

  it("shows the group count and each group as a heading whose row opens and closes it, remembering that", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { level: 1, name: "Bookmarks" })).toBeInTheDocument();
    expect(screen.getByText("2 groups")).toBeInTheDocument();
    // jsdom applies no CSS, so it joins the name and the count with no space; a browser separates the flex items.
    expect(screen.getByRole("heading", { level: 2, name: /^fields sales/ })).toContainElement(groupButton("fields sales"));
    expect(groupButton("fields sales")).toHaveTextContent(/^fields sales2$/);
    // With nothing saved, every group starts open.
    expect(groupButton("fields sales")).toHaveAttribute("aria-expanded", "true");
    expect(groupButton("fields sales")).toHaveAttribute("aria-controls", "bookmark-group-fields-sales-notes");
    expect(document.getElementById("bookmark-group-fields-sales")?.tagName).toBe("SECTION");

    fireEvent.click(groupButton("fields sales"));
    expect(groupButton("fields sales")).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("bookmark-group-fields-sales-notes")).toBeNull();
    expect(savedPreferences().openGroups).toEqual(["college"]);
  });

  it("New group opens a dialog whose Create waits for a name, creates the group, opens it, and returns focus", async () => {
    // Every group saved closed, so the new group opening is the page's doing.
    savePreferences({ openGroups: [] });
    const created: BookmarkLists = { groups: [...PAGE_GROUPS.groups, { name: "readings", slugs: [] }] };
    const fetchMock = await renderLoaded({ routes: { "POST /api/bookmarks/groups": () => reply(200, created) } });
    const trigger = screen.getByRole("button", { name: "New group" });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "New group" });
    const field = within(dialog).getByRole("textbox", { name: "Group name" });
    await waitFor(() => expect(field).toHaveFocus());
    const create = within(dialog).getByRole("button", { name: "Create" });
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel", "Create"]);
    expect(create).toBeDisabled();
    fireEvent.change(field, { target: { value: "   " } });
    expect(create).toBeDisabled();
    fireEvent.change(field, { target: { value: "Readings" } });
    expect(create).toBeEnabled();

    // Enter in the field submits the form, as Create does.
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo(fetchMock, "POST /api/bookmarks/groups").map((c) => c.body)).toEqual([{ name: "Readings" }]);
    expect(groupButton("readings")).toHaveAttribute("aria-expanded", "true");
    expect(groupButton("fields sales")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("3 groups")).toBeInTheDocument();
    expect(await screen.findByText("Bookmark group created")).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps the dialog open with the server's message when the group cannot be created", async () => {
    await renderLoaded({ routes: { "POST /api/bookmarks/groups": () => apiError(409, "conflict", "A group named college already exists") } });
    fireEvent.click(screen.getByRole("button", { name: "New group" }));
    const dialog = await screen.findByRole("dialog", { name: "New group" });
    const field = within(dialog).getByRole("textbox", { name: "Group name" });
    fireEvent.change(field, { target: { value: "college" } });
    fireEvent.submit(field.closest("form")!);
    expect(await screen.findByText("A group named college already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New group" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("opens the group a #bookmark-group-<name> link names, though it was saved closed, and scrolls to it once its notes show", async () => {
    savePreferences({ openGroups: [] });
    await renderLoaded({ path: "/bookmarks#bookmark-group-fields-sales" });
    expect(groupButton("fields sales")).toHaveAttribute("aria-expanded", "true");
    expect(groupButton("college")).toHaveAttribute("aria-expanded", "false");
    // It scrolled once, with the group's two note links already in it.
    expect(scrolled).toEqual(["bookmark-group-fields-sales:2"]);

    // Closing it afterwards sticks.
    fireEvent.click(groupButton("fields sales"));
    await settle();
    expect(groupButton("fields sales")).toHaveAttribute("aria-expanded", "false");
    expect(scrolled).toHaveLength(1);
  });

  it("shows a different amount of each note in each view, and remembers the view", async () => {
    await renderLoaded();
    const panel = () => panelOf("fields-sales");
    const slots = (slot: string) => panel().querySelectorAll(`[data-slot='${slot}']`).length;

    // List: one row per note, the title alone.
    expect(panel()).toHaveAttribute("data-view", "list");
    expect(slots("link-row")).toBe(2);
    expect(within(panel()).getByRole("link", { name: "Lead list" })).toHaveAttribute("href", "/notes/lead-list");
    expect(panel()).not.toHaveTextContent("Who to call this week");
    expect(panel()).not.toHaveTextContent("2026-10-02");

    // Details: rows with the summary under the title and the updated date at the end.
    fireEvent.click(screen.getByRole("radio", { name: "Details" }));
    expect(slots("link-row")).toBe(2);
    expect(within(panel()).getAllByText("Who to call this week")).toHaveLength(1);
    expect(within(panel()).getByText("updated 2026-10-02")).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent("#sales");
    expect(savedPreferences().view).toBe("details");

    // Tiles: compact cards in a grid, the title and kind only.
    fireEvent.click(screen.getByRole("radio", { name: "Tiles" }));
    expect(slots("link-row")).toBe(0);
    expect(slots("item-card")).toBe(2);
    expect(panel().firstElementChild).toHaveClass("grid", "medium:grid-cols-2", "large:grid-cols-3");
    expect(within(panel()).getByText("source")).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent("Who to call this week");
    expect(panel()).not.toHaveTextContent("2026-10-02");

    // Content: cards with the summary once, the tags, and both dates.
    fireEvent.click(screen.getByRole("radio", { name: "Content" }));
    expect(slots("item-card")).toBe(2);
    expect(within(panel()).getAllByText("Who to call this week")).toHaveLength(1);
    expect(within(panel()).getByRole("link", { name: "#sales" })).toBeInTheDocument();
    expect(within(panel()).getByText("created 2026-09-01")).toBeInTheDocument();
    expect(within(panel()).getByText("updated 2026-10-02")).toBeInTheDocument();
    // Every view keeps each note's menu.
    expect(within(panel()).getByRole("button", { name: "More actions for Lead list" })).toBeInTheDocument();
  });

  it("tells how to add a note to an empty group", async () => {
    await renderLoaded();
    const panel = panelOf("college");
    expect(panel).toHaveTextContent("No notes in this group.");
    expect(panel).toHaveTextContent("Choose Bookmark in a note's three-dot menu to add it here.");
  });

  it("with no groups, says so and still offers New group, with no sort or view controls", async () => {
    renderPage({ routes: { "/api/bookmarks": () => reply(200, { groups: [] }) } });
    expect(await screen.findByText("No bookmark groups yet.")).toBeInTheDocument();
    expect(screen.getByText("0 groups")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New group" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "View" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Sort bookmarks" })).toBeNull();
  });

  it("shows an error with Try again when the groups cannot load, never the empty state", async () => {
    let fail = true;
    renderPage({ routes: { "/api/bookmarks": () => (fail ? apiError(500, "internal", "bookmarks.yml is unreadable") : reply(200, PAGE_GROUPS)) } });
    expect(await screen.findByText("bookmarks.yml is unreadable")).toBeInTheDocument();
    expect(screen.queryByText("No bookmark groups yet.")).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /^fields sales/ })).toBeInTheDocument();
  });
});
