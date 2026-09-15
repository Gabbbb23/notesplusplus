import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { NoteBody } from "../src/components/note-body";

const markdown = `Intro with [[other-note]].

| Line | **Pilot** | Rollout |
|---|---|--:|
| API (DigitalOcean) | 1 x 1 vCPU | 24.00 |
| Worker | 1 x 512 MB | 5.00 |
`;

describe("<NoteBody> tables", () => {
  it("renders GFM tables through the shared responsive table with labelled cells", () => {
    const { container } = render(
      <MemoryRouter>
        <NoteBody markdown={markdown} />
      </MemoryRouter>,
    );

    const wrapper = container.querySelector(".prose-note > [data-slot='responsive-table']");
    expect(wrapper).not.toBeNull();
    expect(container.innerHTML).not.toContain("overflow-x-auto");

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Line",
      "Pilot",
      "Rollout",
    ]);

    const rows = within(table).getAllByRole("row").slice(1);
    const cells = within(rows[0]!).getAllByRole("cell");
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual(["Line", "Pilot", "Rollout"]);
    expect(cells[0]).toHaveAttribute("data-primary");
    expect(cells[1]).not.toHaveAttribute("data-primary");
    expect(cells[2]).toHaveAttribute("data-align", "end");

    // Note-table cells wrap at spaces only, so "24.00" and "Pilot" are never split.
    expect(cells[1]).toHaveAttribute("data-size", "text");
    expect(cells[1]).toHaveClass("wrap-break-word");
    expect(cells[1]).not.toHaveClass("wrap-anywhere");
    expect(cells[2]!.textContent).toBe("24.00");

    // Wikilinks elsewhere in the body still become router links.
    expect(screen.getByRole("link", { name: "other-note" })).toHaveAttribute("href", "/notes/other-note");
  });

  it("gives every text column header the 6rem minimum width", () => {
    render(
      <MemoryRouter>
        <NoteBody markdown={markdown} />
      </MemoryRouter>,
    );
    for (const header of screen.getAllByRole("columnheader")) {
      const min = header.querySelector<HTMLElement>("[data-slot='column-min-width']");
      expect(min?.style.minWidth).toBe("6rem");
    }
  });

  it("keeps hyphenated words and symbol-number pairs whole, and gives long values break points", () => {
    const url = "https://example.com/reports/2026-09-14/cloud_hosting_budget.pdf";
    render(
      <MemoryRouter>
        <NoteBody
          markdown={`| Item | Note |
|---|---|
| Compute | ~72 CU-h per 7-day week, off-hours |
| Target | ≥ 20/month cross-region |
| Link | ${url} |
`}
        />
      </MemoryRouter>,
    );
    const cells = screen.getAllByRole("cell");
    const nowrap = (cell: HTMLElement) =>
      Array.from(cell.querySelectorAll(".whitespace-nowrap"), (s) => s.textContent);

    expect(nowrap(cells[1]!)).toEqual(["CU-h", "7-day", "off-hours"]);
    // Tagged so stacked layout can cap a whole token at the cell width (data-table.tsx).
    expect(cells[1]!.querySelectorAll("[data-cell-token='whole']")).toHaveLength(3);
    expect(cells[1]!.textContent).toBe("~72 CU-h per 7-day week, off-hours");

    expect(nowrap(cells[3]!)).toEqual(["cross-region"]);
    // The space after ≥ is now a non-breaking space; everything else copies back unchanged.
    expect(cells[3]!.textContent).toBe("≥\u00A020/month cross-region");

    const long = cells[5]!.querySelector("[data-cell-token='long']")!;
    expect(long).toHaveClass("wrap-anywhere");
    expect(long.textContent).toBe(url);
    expect(long.querySelectorAll("wbr").length).toBeGreaterThan(3);
    // The file name keeps its extension.
    expect(long.lastChild?.textContent).toBe("budget.pdf");
  });
});

describe("<NoteBody> links and headings", () => {
  it("renders links through TextLink and h2 through SectionHeading", () => {
    render(
      <MemoryRouter>
        <NoteBody markdown={"## Budget\n\nSee [[other-note]] and [the site](https://example.com)."} />
      </MemoryRouter>,
    );
    const internal = screen.getByRole("link", { name: "other-note" });
    expect(internal).toHaveAttribute("data-slot", "text-link");
    expect(internal).not.toHaveAttribute("target");

    const external = screen.getByRole("link", { name: "the site" });
    expect(external).toHaveAttribute("data-slot", "text-link");
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
    expect(external.querySelector("[data-slot='external-link-icon']")).not.toBeNull();

    expect(screen.getByRole("heading", { level: 2, name: "Budget" })).toHaveAttribute("data-slot", "section-heading");
  });
});
