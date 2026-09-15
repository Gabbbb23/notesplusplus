import type { Element, ElementContent, Root } from "hast";

/*
 * Rehype plugin: mark each inline code span whose text is one of the note's mentions, the paths
 * the server lists in the note's `mentions`, with a dataLocalPath property (rendered as the
 * data-local-path attribute). note-body.tsx renders marked spans through FileLink, so the path gets
 * View, Open, and Show in folder. The web has no path rule of its own: the server decides what a
 * mention is (src/core/graph/note-body.ts) and opens only those paths.
 *
 * Code inside a code block (pre) is left alone, and so is code inside a link, where buttons cannot
 * go, even when the same text is a mention elsewhere in the note. Run it before
 * rehype-table-cell-text.ts, which rewrites the text inside table cells.
 */

export interface LocalPathOptions {
  /** The note's mentions from the server, exactly as written in the body. */
  mentions: readonly string[];
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

function visit(node: Root | Element, skip: boolean, mentions: ReadonlySet<string>): void {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "code" && !skip) {
      const text = textOf(child);
      if (mentions.has(text)) child.properties = { ...child.properties, dataLocalPath: text };
      continue;
    }
    visit(child, skip || child.tagName === "pre" || child.tagName === "a", mentions);
  }
}

export function rehypeLocalPaths(options: LocalPathOptions) {
  const mentions = new Set(options.mentions);
  return (tree: Root) => {
    visit(tree, false, mentions);
  };
}

export default rehypeLocalPaths;
