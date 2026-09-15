import type { Element, ElementContent, Root } from "hast";
import { describe, expect, it } from "vitest";
import { breakPieces } from "../src/lib/break-points";
import {
  cellTextNodes,
  LONG_TOKEN_CLASS,
  LONG_TOKEN_LENGTH,
  NOWRAP_CLASS,
  rehypeTableCellText,
} from "../src/lib/rehype-table-cell-text";

const NBSP = "\u00A0";

function el(tagName: string, children: ElementContent[] = [], properties: Element["properties"] = {}): Element {
  return { type: "element", tagName, properties, children };
}
const text = (value: string): ElementContent => ({ type: "text", value });

/** What a copy of the nodes gives: text only, <wbr> adds nothing. */
function textOf(nodes: ElementContent[]): string {
  return nodes.map((n) => (n.type === "text" ? n.value : n.type === "element" ? textOf(n.children) : "")).join("");
}

/** A compact picture of the nodes: plain text as is, spans as [class: text], <wbr> as |. */
function shape(nodes: ElementContent[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return n.value;
      if (n.type !== "element") return "";
      if (n.tagName === "wbr") return "|";
      const cls = (n.properties.className as string[] | undefined)?.join(" ");
      return cls ? `[${cls}: ${shape(n.children)}]` : shape(n.children);
    })
    .join("");
}

describe("cellTextNodes", () => {
  it("wraps each hyphenated token in a nowrap span", () => {
    expect(shape(cellTextNodes("~72 CU-h per 7-day week, off-hours"))).toBe(
      `~72 [${NOWRAP_CLASS}: CU-h] per [${NOWRAP_CLASS}: 7-day] week, [${NOWRAP_CLASS}: off-hours]`,
    );
    expect(shape(cellTextNodes("cross-region Proposal-to-contract Non-compliance"))).toBe(
      `[${NOWRAP_CLASS}: cross-region] [${NOWRAP_CLASS}: Proposal-to-contract] [${NOWRAP_CLASS}: Non-compliance]`,
    );
  });

  it("leaves a lone dash and words without hyphens as plain text", () => {
    expect(cellTextNodes("API - worker")).toEqual([text("API - worker")]);
    expect(cellTextNodes("24.00")).toEqual([text("24.00")]);
  });

  it("keeps a symbol with the number after it using a non-breaking space", () => {
    expect(cellTextNodes("≥ 20/month")).toEqual([text(`≥${NBSP}20/month`)]);
    for (const symbol of ["≥", "≤", "<", ">", "~", "±", "$", "₱", "€", "£", "#"]) {
      expect(textOf(cellTextNodes(`${symbol} 5`))).toBe(`${symbol}${NBSP}5`);
    }
    // Only when a digit follows.
    expect(textOf(cellTextNodes("# of leads"))).toBe("# of leads");
    expect(textOf(cellTextNodes("a > b"))).toBe("a > b");
  });

  it("gives a token longer than 30 characters the shared break points and a last-resort wrap", () => {
    const url = "https://example.com/reports/2026-09-14/cloud_hosting?view=full&page=2";
    expect(url.length).toBeGreaterThan(LONG_TOKEN_LENGTH);
    const nodes = cellTextNodes(`See ${url} now`);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toEqual(text("See "));
    expect(nodes[2]).toEqual(text(" now"));
    const token = nodes[1] as Element;
    expect(token.properties).toEqual({ className: [LONG_TOKEN_CLASS], dataCellToken: "long" });
    expect(shape(token.children)).toBe(breakPieces(url).join("|"));
    expect(token.children.filter((c) => c.type === "element" && c.tagName === "wbr")).toHaveLength(
      breakPieces(url).length - 1,
    );
  });

  it("does not treat a 30-character token as long", () => {
    const token = "abcdefghij-abcdefghij-abcdefgh";
    expect(token).toHaveLength(30);
    expect(shape(cellTextNodes(token))).toBe(`[${NOWRAP_CLASS}: ${token}]`);
    expect((cellTextNodes(token)[0] as Element).properties.dataCellToken).toBe("whole");
  });

  it("copies back as the original text, apart from the non-breaking space", () => {
    const value = "Budget ≥ 20/month for cross-region https://example.com/a-very-long/path_to/file.pdf";
    expect(textOf(cellTextNodes(value))).toBe(value.replace("≥ 20", `≥${NBSP}20`));
  });
});

describe("rehypeTableCellText", () => {
  function table(cell: Element): Root {
    return {
      type: "root",
      children: [
        el("p", [text("cross-region outside a table")]),
        el("table", [el("thead", [el("tr", [el("th", [text("Non-compliance")])])]), el("tbody", [el("tr", [cell])])]),
      ],
    };
  }

  it("rewrites text in header and body cells, at any depth, and nothing outside tables", () => {
    const cell = el("td", [text("~72 "), el("strong", [text("CU-h")]), text(" "), el("a", [text("off-hours")], { href: "/x" })]);
    const tree = table(cell);
    rehypeTableCellText()(tree);

    const paragraph = tree.children[0] as Element;
    expect(paragraph.children).toEqual([text("cross-region outside a table")]);

    const th = ((((tree.children[1] as Element).children[0] as Element).children[0] as Element).children[0] as Element);
    expect(shape(th.children)).toBe(`[${NOWRAP_CLASS}: Non-compliance]`);

    expect(shape(cell.children)).toBe(`~72 [${NOWRAP_CLASS}: CU-h] [${NOWRAP_CLASS}: off-hours]`);
    expect((cell.children[3] as Element).properties).toEqual({ href: "/x" });
  });
});
