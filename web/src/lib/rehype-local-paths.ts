import type { Element, ElementContent, Root } from "hast";
import { isLocalAbsolutePath } from "@/lib/file-kinds";

/*
 * Rehype plugin: mark each inline code span whose text is an absolute Windows path, such as
 * `C:\Important Files\Module 1.pdf`, with a dataLocalPath property (rendered as the
 * data-local-path attribute). note-body.tsx renders marked spans through FileLink, so the path
 * gets View, Open, and Show in folder.
 *
 * Code inside a fenced block (pre) is left alone, and so is code inside a link, where buttons
 * cannot go. Run it before rehype-table-cell-text.ts, which rewrites the text inside table cells.
 */

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

function visit(node: Root | Element, skip: boolean): void {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "code" && !skip) {
      const text = textOf(child).trim();
      if (isLocalAbsolutePath(text)) child.properties = { ...child.properties, dataLocalPath: text };
      continue;
    }
    visit(child, skip || child.tagName === "pre" || child.tagName === "a");
  }
}

export function rehypeLocalPaths() {
  return (tree: Root) => {
    visit(tree, false);
  };
}

export default rehypeLocalPaths;
