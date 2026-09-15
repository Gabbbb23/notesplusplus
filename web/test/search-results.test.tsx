import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
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

function renderResults(list: SearchResult[]) {
  return render(
    <MemoryRouter>
      <SearchResults results={list} query="ryzen" />
    </MemoryRouter>,
  );
}

describe("<SearchResults>", () => {
  it("shows the count, note and file links, kind badges, marked snippets, and tags", () => {
    const { container } = renderResults(results);

    expect(screen.getByTestId("result-count").textContent).toBe("2 results for “ryzen”");

    const noteLink = screen.getByRole("link", { name: "Ryzen laptop specs" });
    expect(noteLink).toHaveAttribute("href", "/notes/ryzen-laptop-specs");

    // A file result's title is text; its path in the details carries View, Open, and Show in folder.
    const fileCard = screen.getAllByText("invoice.pdf")[0]!.closest<HTMLElement>("[data-slot='item-card']")!;
    expect(within(fileCard).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "View invoice.pdf in a new tab",
    ]);
    const fileLink = within(fileCard).getByRole("link", { name: "View invoice.pdf in a new tab" });
    expect(fileLink).toHaveAttribute("href", "/api/files/sub%20dir/invoice.pdf");
    expect(fileLink).toHaveAttribute("target", "_blank");
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

  it("shows an empty state for zero results", () => {
    renderResults([]);
    expect(screen.getByText("No results for “ryzen”.")).toBeInTheDocument();
    expect(screen.queryByTestId("result-count")).toBeNull();
  });
});
