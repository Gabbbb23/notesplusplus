// @vitest-environment node
import type { Element, ElementContent, Root } from "hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { CALLOUTS, isCalloutKind, rehypeCallouts } from "../src/lib/rehype-callouts";

/** Markdown to hast through the same remark steps react-markdown runs, then the callout step. */
function toHast(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeCallouts);
  return processor.runSync(processor.parse(markdown)) as Root;
}

const elements = (nodes: Array<Root["children"][number] | ElementContent>) =>
  nodes.filter((n): n is Element => n.type === "element");

function textOf(node: ElementContent | Root): string {
  if (node.type === "text") return node.value;
  if (node.type === "element" || node.type === "root") return node.children.map((c) => textOf(c as ElementContent)).join("");
  return "";
}

/** The first blockquote in the tree. */
function blockquote(tree: Root): Element {
  const found = elements(tree.children).find((n) => n.tagName === "blockquote");
  if (!found) throw new Error("no blockquote");
  return found;
}

describe("rehypeCallouts", () => {
  it.each([
    ["NOTE", "note", "info", "Note"],
    ["TIP", "tip", "success", "Tip"],
    ["IMPORTANT", "important", "info", "Important"],
    ["WARNING", "warning", "warning", "Warning"],
    ["CAUTION", "caution", "danger", "Caution"],
  ] as const)("marks [!%s] as %s (%s tone, titled %s) and removes the marker", (marker, kind, tone, title) => {
    const quote = blockquote(toHast(`> [!${marker}]\n> Pay the fee by **Friday**.`));
    expect(quote.properties.dataCallout).toBe(kind);
    expect(CALLOUTS[kind]).toEqual({ tone, title });
    expect(textOf(quote).trim()).toBe("Pay the fee by Friday.");
    expect(textOf(quote)).not.toMatch(/\[!/);
    // The emphasis survives the marker removal.
    const paragraph = elements(quote.children)[0]!;
    expect(elements(paragraph.children).map((e) => e.tagName)).toEqual(["strong"]);
  });

  it("matches the marker in any case", () => {
    expect(blockquote(toHast("> [!warning]\n> Bring the printed form.")).properties.dataCallout).toBe("warning");
    expect(blockquote(toHast("> [!Tip]\n> Arrive early.")).properties.dataCallout).toBe("tip");
  });

  it("drops the marker's own paragraph when the text starts in the next one", () => {
    const quote = blockquote(toHast("> [!IMPORTANT]\n>\n> First paragraph.\n>\n> Second paragraph."));
    expect(quote.properties.dataCallout).toBe("important");
    expect(elements(quote.children).map((p) => textOf(p))).toEqual(["First paragraph.", "Second paragraph."]);
  });

  it("leaves a plain blockquote, and one with text after the marker on the same line, unchanged", () => {
    const plain = toHast("> Rizal was born in Calamba.");
    expect(blockquote(plain).properties.dataCallout).toBeUndefined();
    expect(textOf(blockquote(plain)).trim()).toBe("Rizal was born in Calamba.");

    const inline = blockquote(toHast("> [!NOTE] Same line text."));
    expect(inline.properties.dataCallout).toBeUndefined();
    expect(textOf(inline).trim()).toBe("[!NOTE] Same line text.");

    const unknown = blockquote(toHast("> [!DANGER]\n> Not a GitHub marker."));
    expect(unknown.properties.dataCallout).toBeUndefined();
  });

  it("finds callouts nested in lists", () => {
    const tree = toHast("- Deadlines:\n\n  > [!CAUTION]\n  > Late enrollment closes on the 20th.");
    const list = elements(tree.children).find((n) => n.tagName === "ul")!;
    const item = elements(list.children)[0]!;
    const quote = elements(item.children).find((n) => n.tagName === "blockquote")!;
    expect(quote.properties.dataCallout).toBe("caution");
    expect(textOf(quote).trim()).toBe("Late enrollment closes on the 20th.");
  });

  it("isCalloutKind accepts only the five kinds", () => {
    expect(["note", "tip", "important", "warning", "caution"].every(isCalloutKind)).toBe(true);
    for (const value of ["NOTE", "danger", "toString", undefined, 1]) expect(isCalloutKind(value)).toBe(false);
  });
});
