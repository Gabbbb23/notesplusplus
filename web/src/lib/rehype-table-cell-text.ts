import type { Element, ElementContent, Root } from "hast";
import { breakPieces } from "@/lib/break-points";

/*
 * Rehype plugin for the text inside note-table cells (th and td only). Browsers break lines
 * after hyphens and after a lone symbol, which splits "CU-h", "cross-region", and "≥ 20/month"
 * across lines; and one long unbroken value such as a URL keeps a table from ever fitting.
 *
 * For each whitespace-separated token in a cell:
 * - A symbol (≥ ≤ < > ~ ± $ ₱ € £ #) followed by a space and a digit keeps the number with
 *   it: that space becomes a non-breaking space.
 * - A token longer than LONG_TOKEN_LENGTH gets <wbr> at the break points BreakableText uses
 *   (lib/break-points.ts) and overflow-wrap: anywhere as a last resort, on that token only.
 * - Any other token containing a hyphen is wrapped in a nowrap span, so it never splits.
 *
 * Only the NBSP changes the text. Spans and <wbr> add no characters, so copying a cell gives
 * back its hyphens and spaces.
 */

/** A token with more characters than this, and no spaces, gets break points of its own. */
export const LONG_TOKEN_LENGTH = 30;

/** Class on a hyphenated token: it never breaks. */
export const NOWRAP_CLASS = "whitespace-nowrap";

/** Class on a long token: it breaks at its <wbr> points, and anywhere as a last resort. */
export const LONG_TOKEN_CLASS = "wrap-anywhere";

/**
 * data-cell-token on each span: "whole" for a hyphenated token, "long" for a long one.
 * data-table.tsx uses "whole" to keep a token that is wider than a stacked cell from being cut off.
 */
export type CellToken = "whole" | "long";

const NBSP = "\u00A0";

/** A symbol, then spaces, then a digit: the spaces become one NBSP. */
const SYMBOL_BEFORE_NUMBER = /([≥≤<>~±$₱€£#])[ \t]+(?=\d)/g;

/** Whitespace a line may break at: every whitespace character except the non-breaking ones. */
const BREAKING_SPACE = /([^\S\u00A0\u2007\u202F]+)/;

/** Hyphen-minus, the Unicode hyphen, and the en dash ("Mon–Fri", "2–3"). */
const HYPHEN = /[-\u2010\u2013]/;

function span(token: CellToken, className: string, children: ElementContent[]): Element {
  return { type: "element", tagName: "span", properties: { className: [className], dataCellToken: token }, children };
}

function longToken(token: string): Element {
  const children: ElementContent[] = [];
  breakPieces(token).forEach((piece, i) => {
    if (i > 0) children.push({ type: "element", tagName: "wbr", properties: {}, children: [] });
    children.push({ type: "text", value: piece });
  });
  return span("long", LONG_TOKEN_CLASS, children);
}

/** The nodes that replace one text node inside a table cell. */
export function cellTextNodes(value: string): ElementContent[] {
  const parts = value.replace(SYMBOL_BEFORE_NUMBER, `$1${NBSP}`).split(BREAKING_SPACE);
  const out: ElementContent[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ type: "text", value: plain });
    plain = "";
  };
  parts.forEach((part, i) => {
    // Odd indexes are the whitespace between tokens.
    const isToken = i % 2 === 0 && part !== "";
    if (isToken && part.length > LONG_TOKEN_LENGTH) {
      flush();
      out.push(longToken(part));
    } else if (isToken && part.length > 1 && HYPHEN.test(part)) {
      flush();
      out.push(span("whole", NOWRAP_CLASS, [{ type: "text", value: part }]));
    } else {
      plain += part;
    }
  });
  flush();
  return out;
}

/** Rewrite every text node under an element, at any depth (emphasis, links, inline code). */
function rewriteText(node: Element): void {
  node.children = node.children.flatMap((child): ElementContent[] => {
    if (child.type === "text") return cellTextNodes(child.value);
    if (child.type === "element") rewriteText(child);
    return [child];
  });
}

function visit(node: Root | Element, inTable: boolean): void {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (inTable && (child.tagName === "th" || child.tagName === "td")) {
      rewriteText(child);
    } else {
      visit(child, inTable || child.tagName === "table");
    }
  }
}

export function rehypeTableCellText() {
  return (tree: Root) => {
    visit(tree, false);
  };
}

export default rehypeTableCellText;
