import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { NoteSummary } from "../src/lib/types";
import { deferred, reply, stubApi, type Route } from "./api-stub";

beforeAll(() => {
  // Radix Select measures and captures the pointer; jsdom has neither.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

function note(i: number, type: NoteSummary["type"] = "note"): NoteSummary {
  const n = String(i).padStart(2, "0");
  return {
    slug: `college-note-${n}`,
    path: `notes/college-note-${n}.md`,
    title: `College note ${n}`,
    type,
    summary: "",
    tags: ["college"],
    created: "2026-09-15",
    updated: "2026-09-15",
  };
}

const notes = (count: number) => Array.from({ length: count }, (_, i) => note(i + 1));
const page = (items: NoteSummary[]) => reply(200, { items, total: items.length, limit: 50, offset: 0 });
const TAGS: Route = () => reply(200, [{ name: "college", description: "BSIT degree", count: 93 }]);
const listUrl = (params = "") => `/api/notes?tag=college${params}&limit=50&offset=0`;

const urls = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.map(([url]) => url);
const cards = () => Array.from(document.querySelectorAll<HTMLElement>("main [data-slot='item-card']"));
const header = () => document.querySelector<HTMLElement>("[data-slot='page-header']")!;
const field = () => screen.getByRole("searchbox", { name: "Filter notes" });

async function choose(menu: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: menu }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("Tag page filters", () => {
  it("reads q, type, and sort from the URL, asks the server for them, and counts against the tag's total", async () => {
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [listUrl("&type=hub&q=manual&sort=created")]: () => page([note(1, "hub"), note(2, "hub")]),
    });
    renderAt("/tags/college?q=manual&type=hub&sort=created");

    await screen.findByRole("link", { name: "College note 02" });
    expect(urls(fetchMock)).toContain(listUrl("&type=hub&q=manual&sort=created"));
    expect(field()).toHaveValue("manual");
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("hub");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveTextContent("Recently added");
    expect(await within(header()).findByText("2 of 93 notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("sends the filter once typing pauses, keeps the old rows until the answer, and puts q in the URL", async () => {
    const filtered = deferred();
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [listUrl()]: () => page(notes(12)),
      [listUrl("&q=note+0")]: filtered.route,
    });
    renderAt("/tags/college");
    await screen.findByRole("link", { name: "College note 12" });

    fireEvent.change(field(), { target: { value: "note 0" } });
    expect(urls(fetchMock)).not.toContain(listUrl("&q=note+0"));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/tags/college?q=note+0"));
    expect(urls(fetchMock)).toContain(listUrl("&q=note+0"));
    expect(cards()).toHaveLength(12);
    expect(document.querySelector("main [aria-busy='true']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Show more notes" })).toBeNull();

    await filtered.release(page(notes(9)));

    expect(cards()).toHaveLength(9);
    expect(document.querySelector("main [aria-busy='true']")).toBeNull();
    expect(within(header()).getByText("9 of 93 notes")).toBeInTheDocument();
    expect(field()).toHaveValue("note 0");
  });

  it("orders through the Sort menu and leaves title, the default, out of the URL", async () => {
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [listUrl()]: () => page(notes(3)),
      [listUrl("&sort=updated")]: () => page(notes(3).reverse()),
    });
    renderAt("/tags/college");
    await screen.findByRole("link", { name: "College note 03" });

    await choose("Sort", "Recently updated");

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/tags/college?sort=updated"));
    expect(urls(fetchMock)).toContain(listUrl("&sort=updated"));
    await waitFor(() => expect(cards()[0]).toHaveTextContent("College note 03"));
    // Sorting is not filtering: the count stays plain and there is nothing to clear.
    expect(within(header()).getByText("3 notes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();

    await choose("Sort", "Title A to Z");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/tags\/college$/));
  });

  it("offers any type, note, and hub, since sources carry no tags", async () => {
    stubApi({ "/api/tags": TAGS, [listUrl()]: () => page(notes(3)), [listUrl("&type=hub")]: () => page([note(1, "hub")]) });
    renderAt("/tags/college");
    await screen.findByRole("link", { name: "College note 03" });

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Type" }), { key: "Enter" });
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Any type", "note", "hub"]);
    fireEvent.click(screen.getByRole("option", { name: "hub" }));

    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByTestId("location")).toHaveTextContent("/tags/college?type=hub");
  });

  it("says when nothing matches, and Clear filters empties the field and brings every note back", async () => {
    const fetchMock = stubApi({
      "/api/tags": TAGS,
      [listUrl()]: () => page(notes(12)),
      [listUrl("&type=note&q=zzz")]: () => page([]),
    });
    renderAt("/tags/college?q=zzz&type=note");

    expect(await screen.findByText("No notes match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await screen.findByRole("link", { name: "College note 12" });
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/tags\/college$/);
    expect(field()).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Any type");
    expect(urls(fetchMock)).toContain(listUrl());
    expect(within(header()).getByText("12 notes")).toBeInTheDocument();
  });

  it("drops the old rows and shows the error alone when the filtered list fails", async () => {
    stubApi({
      "/api/tags": TAGS,
      [listUrl()]: () => page(notes(12)),
      [listUrl("&q=boom")]: () => reply(500, { error: { code: "internal", message: "index exploded" } }),
    });
    renderAt("/tags/college");
    await screen.findByRole("link", { name: "College note 12" });

    fireEvent.change(field(), { target: { value: "boom" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("index exploded");
    expect(cards()).toHaveLength(0);
  });

  it("drops the rows at once when the tag changes, instead of showing one tag's notes under another", async () => {
    const fields = deferred();
    const shared = { ...note(1), tags: ["college", "fields"] };
    stubApi({
      "/api/tags": TAGS,
      [listUrl()]: () => page([shared, ...notes(12).slice(1)]),
      "/api/notes?tag=fields&limit=50&offset=0": fields.route,
    });
    renderAt("/tags/college");
    await screen.findByRole("link", { name: "College note 12" });

    fireEvent.click(within(cards()[0]!).getByRole("link", { name: /fields/ }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/tags/fields"));
    expect(cards()).toHaveLength(0);
    await fields.release(page([shared]));
    expect(cards()).toHaveLength(1);
  });
});
