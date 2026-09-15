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
        <NoteBody markdown={markdown} mentions={[]} />
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
        <NoteBody markdown={markdown} mentions={[]} />
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
          mentions={[]}
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

describe("<NoteBody> local file paths", () => {
  const listPath = String.raw`C:\Important Files\College Files\College Junior Year\1st Sem\GE08 - Ethics\Module 1.pdf`;
  // "# 1" would get a non-breaking space from the table cell step if the path were read after it.
  const cellPath = String.raw`C:\Important Files\College Files\College Junior Year\1st Sem\GE08 - Ethics\Module # 1.pptx`;
  const fencedPath = String.raw`C:\Important Files\Syllabus.pdf`;
  const doublePath = String.raw`D:\Videos\Lecture 3.mp4`;
  const traversalPath = String.raw`C:\Important Files\Up\..\Module 1.pdf`;
  const body = [
    "Readings:",
    "",
    "- `" + listPath + "`",
    "- Run `npm test` before class.",
    "- See [`" + fencedPath + "`](https://example.com/syllabus).",
    "- Lecture: ``" + doublePath + "``",
    "- Not a mention: `" + traversalPath + "`",
    "- The syllabus again: `" + fencedPath + "`",
    "",
    "| Week | File |",
    "|---|---|",
    "| 1 | `" + cellPath + "` |",
    "",
    "```text",
    fencedPath,
    "```",
  ].join("\n");
  // What the server lists for this body: inline code outside links, as written, in body order.
  // The traversal path is not a mention, so the server never lists it.
  const mentions = [listPath, doublePath, fencedPath, cellPath];

  function renderBody() {
    return render(
      <MemoryRouter>
        <NoteBody markdown={body} mentions={mentions} />
      </MemoryRouter>,
    );
  }

  it("gives file actions only to inline code the server lists, never to a path inside a link", () => {
    renderBody();
    const [, , linkItem, doubleItem, traversalItem, againItem] = screen.getAllByRole("listitem");

    // Double backticks are code like single ones, and the server lists the path.
    expect(doubleItem!.querySelector("code")!.textContent).toBe(doublePath);
    expect(within(doubleItem!).getByRole("button", { name: "Show Lecture 3.mp4 in File Explorer" })).toBeInTheDocument();

    // The same text inside a link gets no buttons, though it is a mention further down.
    expect(within(linkItem!).queryByRole("button")).toBeNull();
    expect(within(againItem!).getByRole("button", { name: "Show Syllabus.pdf in File Explorer" })).toBeInTheDocument();

    // A path the server does not list stays plain code, however much it looks like a path.
    expect(traversalItem!.querySelector("code")!.textContent).toBe(traversalPath);
    expect(within(traversalItem!).queryByRole("button")).toBeNull();
    expect(traversalItem!.querySelector("[data-slot='file-link']")).toBeNull();
  });

  it("gives no file actions at all when the server lists no mentions", () => {
    const { container } = render(
      <MemoryRouter>
        <NoteBody markdown={body} mentions={[]} />
      </MemoryRouter>,
    );
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(container.querySelector("[data-slot='file-link']")).toBeNull();
  });

  it("gives a path in a list item the file actions, shown as code", () => {
    renderBody();
    const [pathItem, commandItem, linkItem] = screen.getAllByRole("listitem");

    const code = pathItem!.querySelector("code")!;
    expect(code.textContent).toBe(listPath);
    expect(code).toHaveAttribute("data-slot", "breakable-text");
    expect(within(pathItem!).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open Module 1.pdf in its default app",
      "Show Module 1.pdf in File Explorer",
    ]);
    // No View link: files open in their default app or in File Explorer, never in a browser tab.
    expect(within(pathItem!).queryByRole("link")).toBeNull();

    // Code that is not a path, and a path inside a link, stay plain code.
    expect(commandItem!.querySelector("code")!.textContent).toBe("npm test");
    expect(within(commandItem!).queryByRole("button")).toBeNull();
    expect(within(linkItem!).queryByRole("button")).toBeNull();
    expect(within(linkItem!).getByRole("link").querySelector("code")!.textContent).toBe(fencedPath);
  });

  it("gives a path in a table cell the file actions and keeps the cell's table behaviour", () => {
    renderBody();
    const table = screen.getByRole("table");
    const cell = within(table).getAllByRole("cell")[1]!;

    expect(cell).toHaveAttribute("data-label", "File");
    expect(cell).toHaveAttribute("data-size", "text");
    expect(cell.querySelector("code")!.textContent).toBe(cellPath);
    expect(within(cell).queryByRole("link")).toBeNull();
    expect(within(cell).getByRole("button", { name: "Open Module # 1.pptx in its default app" })).toBeInTheDocument();
    expect(within(cell).getByRole("button", { name: "Show Module # 1.pptx in File Explorer" })).toBeInTheDocument();
    expect(cell.querySelector("[data-slot='file-actions']")).toHaveAttribute("data-size", "compact");
    expect(table.innerHTML).not.toContain("overflow-x-auto");
  });

  it("leaves a path in a fenced code block alone", () => {
    const { container } = renderBody();
    const pre = container.querySelector("pre")!;
    expect(pre.querySelector("code")!.className).toBe("language-text");
    expect(pre.textContent).toBe(`${fencedPath}\n`);
    expect(within(pre).queryByRole("button")).toBeNull();
    expect(pre.querySelector("[data-slot='file-link']")).toBeNull();
  });
});

describe("<NoteBody> wikilinks", () => {
  // The same code rule as the server's parser (test/note-body.test.ts at the repo root): a link is
  // [[slug]] in text, never in code of any kind or inside a markdown link.
  function renderMarkdown(markdown: string) {
    return render(
      <MemoryRouter>
        <NoteBody markdown={markdown} mentions={[]} />
      </MemoryRouter>,
    );
  }

  const linked: Array<[string, string, string, string]> = [
    ["a plain link", "See [[alpha]].", "alpha", "/notes/alpha"],
    ["a labelled link, trimmed", "See [[ beta | Beta label ]].", "Beta label", "/notes/beta"],
    ["a slug that needs encoding", "See [[a b]].", "a b", "/notes/a%20b"],
    ["a labelled link in a table cell with an escaped pipe", "| Term | Note |\n|---|---|\n| X | [[t\\|the t]] |", "the t", "/notes/t"],
  ];

  it.each(linked)("links %s", (_label, markdown, name, href) => {
    renderMarkdown(markdown);
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  });

  const inCode: Array<[string, string]> = [
    ["single-backtick code", "Inline `[[in-code]]` here."],
    ["a double-backtick span", "Inline ``[[in-code]]`` here."],
    ["a ``` fence", "```\n[[in-code]]\n```"],
    ["a ~~~ fence", "~~~\n[[in-code]]\n~~~"],
    ["an indented code block", "Para.\n\n    [[in-code]]\n"],
  ];

  it.each(inCode)("does not link [[x]] in %s and shows it as written", (_label, markdown) => {
    const { container } = renderMarkdown(markdown);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("code")!.textContent).toContain("[[in-code]]");
  });

  it("does not link [[x]] inside a markdown link's text", () => {
    renderMarkdown("[see [[inside]]](https://example.com) and [[outside]]");
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["https://example.com", "/notes/outside"]);
    expect(screen.getByRole("link", { name: /see \[\[inside\]\]/ })).toBeInTheDocument();
  });
});

describe("<NoteBody> callouts", () => {
  it("renders each GitHub alert as a Notice with its tone and title, without the marker, and keeps plain blockquotes", () => {
    const markers = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];
    const { container } = render(
      <MemoryRouter>
        <NoteBody
          markdown={[...markers.map((m) => `> [!${m}]\n> About ${m.toLowerCase()}, see [[other-note]].`), "> Just a quote."].join("\n\n")}
          mentions={[]}
        />
      </MemoryRouter>,
    );

    // Static notes, not alerts: a note's callouts are never announced when the page loads.
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    const notices = screen.getAllByRole("note");
    expect(notices.map((n) => [n.getAttribute("data-tone"), n.querySelector("[data-slot='alert-title']")?.textContent])).toEqual([
      ["info", "Note"],
      ["success", "Tip"],
      ["info", "Important"],
      ["warning", "Warning"],
      ["danger", "Caution"],
    ]);
    for (const [i, notice] of notices.entries()) {
      expect(notice).toHaveTextContent(`About ${markers[i]!.toLowerCase()}, see other-note.`);
      expect(notice.textContent).not.toContain("[!");
      expect(within(notice).getByRole("link", { name: "other-note" })).toHaveAttribute("href", "/notes/other-note");
    }
    // Important shares the info tone but not Note's icon.
    const icon = (n: HTMLElement) => n.querySelector("svg")?.getAttribute("class");
    expect(icon(notices[2]!)).not.toBe(icon(notices[0]!));

    const quotes = container.querySelectorAll("blockquote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toHaveTextContent("Just a quote.");
  });
});

describe("<NoteBody> links and headings", () => {
  it("renders links through TextLink and h2 through SectionHeading", () => {
    render(
      <MemoryRouter>
        <NoteBody markdown={"## Budget\n\nSee [[other-note]] and [the site](https://example.com)."} mentions={[]} />
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
