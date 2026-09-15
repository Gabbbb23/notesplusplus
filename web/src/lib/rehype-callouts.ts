import type { Element, ElementContent, Root } from "hast";

/*
 * Rehype plugin: GitHub alert callouts. A blockquote whose first line is [!NOTE], [!TIP],
 * [!IMPORTANT], [!WARNING], or [!CAUTION] (any case) gets a dataCallout property (rendered as the
 * data-callout attribute) naming its kind, and loses the marker line. note-body.tsx renders marked
 * blockquotes through Notice with the tone and title from CALLOUTS. A blockquote without a marker,
 * or with text after the marker on the same line, stays a normal blockquote, as on GitHub.
 */

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

export interface CalloutStyle {
  tone: "info" | "success" | "warning" | "danger";
  title: string;
}

/** How each callout renders. Important shares the info tone and gets its own icon in note-body.tsx. */
export const CALLOUTS: Record<CalloutKind, CalloutStyle> = {
  note: { tone: "info", title: "Note" },
  tip: { tone: "success", title: "Tip" },
  important: { tone: "info", title: "Important" },
  warning: { tone: "warning", title: "Warning" },
  caution: { tone: "danger", title: "Caution" },
};

export function isCalloutKind(value: unknown): value is CalloutKind {
  return typeof value === "string" && Object.hasOwn(CALLOUTS, value);
}

/** The marker alone on the first line, then a line break or the end of the text. */
const MARKER = /^\s*\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i;

const isBlank = (node: ElementContent) => node.type === "text" && node.value.trim() === "";

/** If the blockquote starts with a marker, remove it and return the kind. */
function takeMarker(blockquote: Element): CalloutKind | null {
  const paragraph = blockquote.children.find((child) => !isBlank(child));
  if (paragraph?.type !== "element" || paragraph.tagName !== "p") return null;
  const first = paragraph.children[0];
  if (first?.type !== "text") return null;
  const match = MARKER.exec(first.value);
  if (!match) return null;

  const rest = first.value.slice(match[0].length);
  if (rest === "") paragraph.children.shift();
  else first.value = rest;
  // Drop a soft break left at the start, then the paragraph itself when nothing is left in it.
  while (paragraph.children[0] && isBlank(paragraph.children[0])) paragraph.children.shift();
  if (paragraph.children[0]?.type === "element" && paragraph.children[0].tagName === "br") paragraph.children.shift();
  if (paragraph.children.every(isBlank)) {
    blockquote.children.splice(blockquote.children.indexOf(paragraph), 1);
  }
  return match[1]!.toLowerCase() as CalloutKind;
}

function visit(node: Root | Element): void {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "blockquote") {
      const kind = takeMarker(child);
      if (kind) child.properties = { ...child.properties, dataCallout: kind };
    }
    visit(child);
  }
}

export function rehypeCallouts() {
  return (tree: Root) => {
    visit(tree);
  };
}

export default rehypeCallouts;
