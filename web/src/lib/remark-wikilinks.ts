import type { Nodes, PhrasingContent, Root, Text } from "mdast";
import { noteUrl } from "@/lib/api";

/*
 * Remark plugin: turn [[slug]] and [[slug|label]] into links to /notes/slug.
 *
 * It works on the markdown syntax tree that react-markdown and remark-gfm build, and only on text
 * nodes, so code is never touched: inline code with any number of backticks, ``` and ~~~ fences,
 * and indented blocks hold their text in a value, not in text nodes. Text inside a markdown link is
 * left alone too. The server reads links with the same rule (src/core/graph/note-body.ts), so a
 * rendered link is exactly a link the server counts for backlinks, trails, and hub membership.
 */

const WIKILINK = /\[\[([^\][|]+)(\|[^\]]*)?\]\]/g;

function split(node: Text): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let last = 0;
  for (const m of node.value.matchAll(WIKILINK)) {
    const slug = m[1]!.trim();
    if (slug === "") continue;
    if (m.index > last) out.push({ type: "text", value: node.value.slice(last, m.index) });
    const label = m[2]?.slice(1).trim() || slug;
    out.push({ type: "link", url: noteUrl(slug), children: [{ type: "text", value: label }] });
    last = m.index + m[0].length;
  }
  if (last === 0) return [node];
  if (last < node.value.length) out.push({ type: "text", value: node.value.slice(last) });
  return out;
}

function visit(node: Nodes): void {
  if (node.type === "link" || node.type === "linkReference" || !("children" in node)) return;
  const children: Nodes[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      children.push(...split(child));
    } else {
      visit(child);
      children.push(child);
    }
  }
  (node as { children: Nodes[] }).children = children;
}

export function remarkWikilinks() {
  return (tree: Root) => {
    visit(tree);
  };
}

export default remarkWikilinks;
