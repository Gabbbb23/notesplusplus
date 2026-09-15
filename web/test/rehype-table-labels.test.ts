import type { Element, ElementContent, Root } from "hast";
import { describe, expect, it } from "vitest";
import { rehypeTableLabels } from "../src/lib/rehype-table-labels";

function el(tagName: string, children: ElementContent[] = [], properties: Element["properties"] = {}): Element {
  return { type: "element", tagName, properties, children };
}
const text = (value: string): ElementContent => ({ type: "text", value });
const nl = text("\n");

function table(headers: ElementContent[][], rows: ElementContent[][][]): Element {
  return el("table", [
    nl,
    el("thead", [nl, el("tr", headers.map((h) => el("th", h))), nl]),
    nl,
    el("tbody", rows.map((r) => el("tr", [nl, ...r.map((c) => el("td", c)), nl]))),
    nl,
  ]);
}

function run(tree: Root): Root {
  rehypeTableLabels()(tree);
  return tree;
}

/** Labels of the body cells, row by row. */
function labels(tree: Root): Array<Array<unknown>> {
  const tbl = tree.children[0] as Element;
  const tbody = tbl.children.find((c): c is Element => c.type === "element" && c.tagName === "tbody")!;
  return tbody.children
    .filter((r): r is Element => r.type === "element")
    .map((r) =>
      r.children.filter((c): c is Element => c.type === "element").map((c) => c.properties.dataLabel),
    );
}

describe("rehypeTableLabels", () => {
  it("copies each column's header text onto the body cells of that column", () => {
    const tree = run({
      type: "root",
      children: [
        table(
          [[text("Line")], [text("Pilot")], [text("Rollout")]],
          [
            [[text("API")], [text("12.00")], [text("24.00")]],
            [[text("Worker")], [text("5.00")], [text("5.00")]],
          ],
        ),
      ],
    });
    expect(labels(tree)).toEqual([
      ["Line", "Pilot", "Rollout"],
      ["Line", "Pilot", "Rollout"],
    ]);
  });

  it("reduces inline markup in a header to plain text", () => {
    const tree = run({
      type: "root",
      children: [
        table(
          [
            [el("strong", [text("Cost")]), text(" in "), el("code", [text("USD")])],
            [el("a", [el("em", [text("Link")])], { href: "/notes/x" })],
          ],
          [[[text("1")], [text("2")]]],
        ),
      ],
    });
    expect(labels(tree)).toEqual([["Cost in USD", "Link"]]);
  });

  it("leaves a cell unlabelled when its column has no header cell or an empty one", () => {
    const tree = run({
      type: "root",
      children: [table([[text("Name")], []], [[[text("a")], [text("b")], [text("c")]]])],
    });
    expect(labels(tree)).toEqual([["Name", undefined, undefined]]);
  });

  it("handles a row with fewer cells than headers", () => {
    const tree = run({
      type: "root",
      children: [table([[text("A")], [text("B")], [text("C")]], [[[text("1")]], [[text("1")], [text("2")]]])],
    });
    expect(labels(tree)).toEqual([["A"], ["A", "B"]]);
  });

  it("keeps existing cell properties and labels tables nested deeper in the tree", () => {
    const cell = el("td", [text("x")], { align: "right" });
    const nested = el("table", [el("thead", [el("tr", [el("th", [text("Amount")])])]), el("tbody", [el("tr", [cell])])]);
    run({ type: "root", children: [el("div", [el("section", [nested])])] });
    expect(cell.properties).toEqual({ align: "right", dataLabel: "Amount" });
  });
});
