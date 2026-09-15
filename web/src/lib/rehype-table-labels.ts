import type { Element, ElementContent, Root } from "hast";

/*
 * Rehype plugin: give every body cell of a table a dataLabel property (rendered as the
 * data-label attribute) holding the plain text of its column header. The shared table uses
 * it as the label beside each value when a table switches to stacked layout.
 */

const ROW_GROUPS = new Set(["thead", "tbody", "tfoot"]);

function elementChildren(node: Root | Element): Element[] {
  return (node.children as Array<Root["children"][number]>).filter(
    (child): child is Element => child.type === "element",
  );
}

/** Text content of a node with inline markup (emphasis, code, links) reduced to its text. */
function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

function cellsOf(row: Element): Element[] {
  return elementChildren(row).filter((c) => c.tagName === "th" || c.tagName === "td");
}

/** The rows of one table, in order, without descending into nested tables. */
function rowsOf(table: Element): { header: Element | undefined; body: Element[] } {
  let header: Element | undefined;
  const body: Element[] = [];
  for (const child of elementChildren(table)) {
    if (child.tagName === "tr") {
      body.push(child);
    } else if (ROW_GROUPS.has(child.tagName)) {
      const rows = elementChildren(child).filter((r) => r.tagName === "tr");
      if (child.tagName === "thead" && header === undefined) {
        header = rows[0];
        body.push(...rows.slice(1));
      } else {
        body.push(...rows);
      }
    }
  }
  // No thead: treat a leading row made only of th cells as the header.
  if (header === undefined && body[0] && cellsOf(body[0]).every((c) => c.tagName === "th")) {
    header = body.shift();
  }
  return { header, body };
}

function labelTable(table: Element): void {
  const { header, body } = rowsOf(table);
  if (!header) return;
  const labels = cellsOf(header).map((cell) => textOf(cell).replace(/\s+/g, " ").trim());
  for (const row of body) {
    cellsOf(row).forEach((cell, i) => {
      const label = labels[i];
      if (label) cell.properties = { ...cell.properties, dataLabel: label };
    });
  }
}

function visit(node: Root | Element): void {
  for (const child of elementChildren(node)) {
    if (child.tagName === "table") labelTable(child);
    visit(child);
  }
}

export function rehypeTableLabels() {
  return (tree: Root) => {
    visit(tree);
  };
}

export default rehypeTableLabels;
