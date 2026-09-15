import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "../src/components/data-table";

interface FileRow {
  path: string;
  size: string;
}

const rows: FileRow[] = [
  { path: "files/fields/Cloud Hosting/V2/Cloud-Hosting-Budget-Proposal.pdf", size: "1.2 MB" },
  { path: "files/invoice.pdf", size: "88 KB" },
];

const columns: Column<FileRow>[] = [
  { id: "path", header: "Path", size: "fill", primary: true, cell: (r) => r.path },
  { id: "size", header: "Size", align: "end", cell: (r) => r.size },
  { id: "open", header: "Open", hideHeader: true, cell: () => <a href="#open">Open</a> },
];

function renderTable(layout: "table" | "stacked" | "auto") {
  return render(
    <DataTable columns={columns} rows={rows} rowKey={(r) => r.path} caption="Files" layout={layout} />,
  );
}

describe("<DataTable>", () => {
  for (const layout of ["table", "stacked"] as const) {
    describe(`layout="${layout}"`, () => {
      it("keeps table roles, labels, the primary cell, and an unlabelled action column", () => {
        const { container } = renderTable(layout);

        const wrapper = container.querySelector("[data-slot='responsive-table']")!;
        expect(wrapper).toHaveAttribute("data-layout", layout);
        expect(wrapper.className).toContain("data-[layout=stacked]:**:data-[cell-token=whole]:max-w-full");
        expect(container.innerHTML).not.toContain("overflow-x-auto");

        const table = screen.getByRole("table", { name: "Files" });
        expect(within(table).getAllByRole("rowgroup")).toHaveLength(2);
        expect(within(table).getAllByRole("row")).toHaveLength(3);
        expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Path", "Size", "Open"]);

        const cells = within(table).getAllByRole("cell");
        expect(cells).toHaveLength(6);
        const [path, size, open] = cells;
        expect(path).toHaveAttribute("data-label", "Path");
        expect(path).toHaveAttribute("data-primary");
        expect(path).toHaveAttribute("data-size", "fill");
        expect(size).toHaveAttribute("data-label", "Size");
        expect(size).not.toHaveAttribute("data-primary");
        expect(size).toHaveAttribute("data-align", "end");
        expect(size).toHaveClass("tabular-nums");
        expect(open).not.toHaveAttribute("data-label");
        expect(within(open!).getByRole("link", { name: "Open" })).toBeInTheDocument();

        // The hidden header keeps its text for screen readers only.
        const openHeader = within(table).getAllByRole("columnheader")[2]!;
        expect(openHeader.querySelector(".sr-only")?.textContent).toBe("Open");
      });
    });
  }

  it("fit cells stay on one line, fill cells wrap", () => {
    renderTable("table");
    const [path, size] = screen.getAllByRole("cell");
    expect(size).toHaveClass("whitespace-nowrap");
    expect(path).not.toHaveClass("whitespace-nowrap");
    expect(path).toHaveClass("whitespace-normal", "wrap-anywhere");
  });

  it("gives fill column headers a 10rem minimum and leaves fit columns to their content", () => {
    renderTable("table");
    const [path, size, open] = screen.getAllByRole("columnheader");
    const min = (header: HTMLElement | undefined) =>
      header?.querySelector<HTMLElement>("[data-slot='column-min-width']")?.style.minWidth;
    expect(min(path)).toBe("10rem");
    expect(min(size)).toBeUndefined();
    expect(min(open)).toBeUndefined();
  });

  it("defaults the primary cell to the first column", () => {
    render(
      <DataTable
        columns={[
          { id: "a", header: "A", cell: (r: { a: string; b: string }) => r.a },
          { id: "b", header: "B", cell: (r) => r.b },
        ]}
        rows={[{ a: "1", b: "2" }]}
        rowKey={(r) => r.a}
        layout="stacked"
      />,
    );
    const [a, b] = screen.getAllByRole("cell");
    expect(a).toHaveAttribute("data-primary");
    expect(b).not.toHaveAttribute("data-primary");
  });

  it("shows the empty state instead of a table when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.path} empty="No files yet." />);
    expect(screen.getByText("No files yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("falls back to table layout when ResizeObserver is missing (jsdom)", () => {
    const { container } = renderTable("auto");
    expect(container.querySelector("[data-slot='responsive-table']")).toHaveAttribute("data-layout", "table");
  });
});

describe("<DataTable layout='auto'> with ResizeObserver", () => {
  const restore: Array<() => void> = [];

  afterEach(() => {
    while (restore.length) restore.pop()!();
    vi.unstubAllGlobals();
  });

  function stubProperty(proto: object, name: string, get: (this: HTMLElement) => number) {
    const original = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, get });
    restore.push(() => {
      if (original) Object.defineProperty(proto, name, original);
    });
  }

  it("stacks when the table overflows and returns only once the wrapper is wide enough", () => {
    let wrapperWidth = 400;
    const tableWidth = 600;
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: () => void) {
          observers.push(() => this.cb());
        }
        observe() {}
        disconnect() {}
      },
    );
    stubProperty(HTMLElement.prototype, "clientWidth", function () {
      return this.dataset.slot === "responsive-table" ? wrapperWidth : 0;
    });
    stubProperty(HTMLElement.prototype, "scrollWidth", function () {
      return this.dataset.slot === "table" ? Math.max(tableWidth, wrapperWidth) : 0;
    });
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { ...rect.call(this), width: 200 } as DOMRect;
    };
    restore.push(() => {
      HTMLElement.prototype.getBoundingClientRect = rect;
    });

    const { container } = renderTable("auto");
    const wrapper = () => container.querySelector("[data-slot='responsive-table']")!;
    const resize = (w: number) =>
      act(() => {
        wrapperWidth = w;
        observers.forEach((notify) => notify());
      });

    // Measured before paint: 600px of table in 400px. Recorded width: 600 + 24 slack.
    expect(wrapper()).toHaveAttribute("data-layout", "stacked");

    // Wide enough for the table, but inside the hysteresis band: stays stacked.
    resize(610);
    expect(wrapper()).toHaveAttribute("data-layout", "stacked");

    resize(624);
    expect(wrapper()).toHaveAttribute("data-layout", "table");

    // Back inside the band from the other side: the table still fits, so it stays a table.
    resize(610);
    expect(wrapper()).toHaveAttribute("data-layout", "table");

    resize(599);
    expect(wrapper()).toHaveAttribute("data-layout", "stacked");
  });

  it("lays stacked pairs out in a grid in a wide box and one per line in a narrow one", () => {
    let wrapperWidth = 700;
    const tableWidth = 900;
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: () => void) {
          observers.push(() => this.cb());
        }
        observe() {}
        disconnect() {}
      },
    );
    stubProperty(HTMLElement.prototype, "clientWidth", function () {
      return this.dataset.slot === "responsive-table" ? wrapperWidth : 0;
    });
    stubProperty(HTMLElement.prototype, "scrollWidth", function () {
      return this.dataset.slot === "table" ? Math.max(tableWidth, wrapperWidth) : 0;
    });
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { ...rect.call(this), width: 128 } as DOMRect;
    };
    restore.push(() => {
      HTMLElement.prototype.getBoundingClientRect = rect;
    });

    type Row = { subject: string; code: string; day: string; time: string; room: string; units: string; teacher: string };
    const text = (id: keyof Row, header: string): Column<Row> => ({ id, header, cell: (r) => r[id] });
    const seven: Column<Row>[] = [
      text("subject", "Subject"),
      text("code", "Code"),
      text("day", "Day"),
      text("time", "Time"),
      text("room", "Room"),
      text("units", "Units"),
      text("teacher", "Teacher"),
    ];
    const { container } = render(
      <DataTable
        columns={seven}
        rows={[{ subject: "ITE410 Capstone Project 1", code: "149413", day: "Monday", time: "4:30-9:30 PM", room: "", units: "3", teacher: "TBA" }]}
        rowKey={(r) => r.code}
      />,
    );
    const wrapper = () => container.querySelector("[data-slot='responsive-table']")!;
    const resize = (w: number) =>
      act(() => {
        wrapperWidth = w;
        observers.forEach((notify) => notify());
      });

    // 900px of table in a 700px box: stacked, and 700px is at least 36rem, so a grid.
    expect(wrapper()).toHaveAttribute("data-layout", "stacked");
    expect(wrapper()).toHaveAttribute("data-stack", "grid");

    const table = screen.getByRole("table");
    const row = within(table).getAllByRole("row")[1]!;
    expect(row.className).toContain("group-data-[stack=grid]/table:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]");
    expect(row.className).toContain("group-data-[stack=list]/table:flex-col");
    const cells = within(row).getAllByRole("cell");
    // The title spans the grid; labelled pairs put the label above the value; the empty Room cell stays hidden.
    expect(cells[0]).toHaveAttribute("data-primary");
    expect(cells[0]!.className).toContain("group-data-[stack=grid]/table:col-span-full");
    expect(cells[1]).toHaveAttribute("data-label", "Code");
    expect(cells[1]!.className).toContain("group-data-[stack=grid]/table:before:block");
    expect(cells[4]).toHaveAttribute("data-empty");
    expect(cells[4]!.className).toContain("group-data-[layout=stacked]/table:hidden");
    expect(cells[4]!.className).not.toMatch(/stack=(?:list|grid)\]\/table:(?:grid|block|flex)(?:\s|$)/);

    resize(500);
    expect(wrapper()).toHaveAttribute("data-layout", "stacked");
    expect(wrapper()).toHaveAttribute("data-stack", "list");

    resize(1000);
    expect(wrapper()).toHaveAttribute("data-layout", "table");
    expect(wrapper()).not.toHaveAttribute("data-stack");
  });
});

describe("empty cells", () => {
  it("detects blank content", async () => {
    const { isEmptyCellContent } = await import("../src/components/data-table");
    expect(isEmptyCellContent(undefined)).toBe(true);
    expect(isEmptyCellContent(null)).toBe(true);
    expect(isEmptyCellContent("   ")).toBe(true);
    expect(isEmptyCellContent(["", null, false])).toBe(true);
    expect(isEmptyCellContent("0.00")).toBe(false);
    expect(isEmptyCellContent(0 as unknown as string)).toBe(false);
  });

  it("marks empty non-primary cells so stacked layout skips them", () => {
    type Row = { line: string; spec: string; cost: string };
    const columns: Column<Row>[] = [
      { id: "line", header: "Line", cell: (r) => r.line },
      { id: "spec", header: "Spec", cell: (r) => r.spec },
      { id: "cost", header: "Cost", cell: (r) => r.cost, align: "end" },
    ];
    render(<DataTable columns={columns} rows={[{ line: "Expected", spec: "", cost: "29.08" }]} rowKey={(r) => r.line} layout="stacked" />);
    const cells = screen.getAllByRole("cell");
    expect(cells[0]).not.toHaveAttribute("data-empty");
    expect(cells[1]).toHaveAttribute("data-empty");
    expect(cells[1]!.className).toContain("group-data-[layout=stacked]/table:hidden");
    expect(cells[2]).not.toHaveAttribute("data-empty");
  });
});
