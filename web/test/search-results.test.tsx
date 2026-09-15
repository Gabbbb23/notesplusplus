import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PinsProvider } from "../src/components/pins";
import { SearchResults } from "../src/components/search-results";
import type { SearchResult } from "../src/lib/types";

const results: SearchResult[] = [
  {
    kind: "note",
    id: "ryzen-laptop-specs",
    path: "notes/ryzen-laptop-specs.md",
    title: "Ryzen laptop specs",
    summary: "What the laptop has inside.",
    snippet: "The laptop has a «Ryzen» 7 7735HS <b>bold</b>",
    score: 1,
    tags: ["hardware", "laptop"],
    type: "note",
  },
  {
    kind: "file",
    id: "files/sub dir/invoice.pdf",
    path: "files/sub dir/invoice.pdf",
    title: "invoice.pdf",
    summary: "",
    snippet: "«Ryzen» laptop invoice",
    score: 0.5,
    tags: [],
  },
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderResults(list: SearchResult[]) {
  return render(
    <MemoryRouter initialEntries={["/search"]}>
      <PinsProvider>
        <SearchResults results={list} query="ryzen" />
      </PinsProvider>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const cardOf = (text: string) => screen.getAllByText(text)[0]!.closest<HTMLElement>("[data-slot='item-card']")!;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, statusText: "", json: async () => ({ home: [], sidebar: [] }) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<SearchResults>", () => {
  it("shows the count, note and file links, kind badges, marked snippets, and tags", () => {
    const { container } = renderResults(results);

    expect(screen.getByTestId("result-count").textContent).toBe("2 results for “ryzen”");

    const noteLink = screen.getByRole("link", { name: "Ryzen laptop specs" });
    expect(noteLink).toHaveAttribute("href", "/notes/ryzen-laptop-specs");

    // A file result's title is text; its path in the details carries Open and Show in folder, and no View link.
    const fileCard = cardOf("invoice.pdf");
    expect(within(fileCard).queryAllByRole("link")).toEqual([]);
    expect(within(fileCard).getByRole("button", { name: "Open invoice.pdf in its default app" })).toBeInTheDocument();
    expect(within(fileCard).getByRole("button", { name: "Show invoice.pdf in File Explorer" })).toBeInTheDocument();
    expect(fileCard.querySelector("[data-slot='file-link'] code")?.textContent).toBe("files/sub dir/invoice.pdf");

    expect(screen.getByText("note")).toBeInTheDocument();
    expect(screen.getByText("file")).toBeInTheDocument();

    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe("Ryzen");
    expect(container.querySelector("b")).toBeNull();
    expect(container.innerHTML).toContain("&lt;b&gt;bold&lt;/b&gt;");

    expect(screen.getByRole("link", { name: "#hardware" })).toHaveAttribute("href", "/tags/hardware");
  });

  it("gives a note result the three-dot menu and a file result none", () => {
    renderResults(results);
    const noteCard = cardOf("Ryzen laptop specs");
    const menu = within(noteCard).getByRole("button", { name: "More actions for Ryzen laptop specs" });
    expect(menu.closest("[data-slot='item-card-actions']")).not.toBeNull();
    // The menu sits beside the title link, never inside it.
    expect(menu.closest("a")).toBeNull();
    expect(within(cardOf("invoice.pdf")).queryByRole("button", { name: /^More actions/ })).toBeNull();
  });

  it("opens the menu without following the card's title link", async () => {
    renderResults(results);
    const menu = screen.getByRole("button", { name: "More actions for Ryzen laptop specs" });
    fireEvent.pointerDown(menu, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(menu);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/search");
  });

  it("shows an empty state for zero results", () => {
    renderResults([]);
    expect(screen.getByText("No results for “ryzen”.")).toBeInTheDocument();
    expect(screen.queryByTestId("result-count")).toBeNull();
  });
});
