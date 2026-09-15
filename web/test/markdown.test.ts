import { describe, expect, it } from "vitest";
import { escapeHtml, isExternalHref, markSnippet, replaceWikilinks, safeHref, splitSnippet } from "../src/lib/markdown";

describe("replaceWikilinks", () => {
  it("converts [[slug]] and [[slug|label]] to /notes links", () => {
    expect(replaceWikilinks("See [[foo]] and [[bar|Bar label]].")).toBe(
      "See [foo](/notes/foo) and [Bar label](/notes/bar).",
    );
  });

  it("leaves fenced code and inline code alone", () => {
    const md = "```\n[[in-fence]]\n```\n\nInline `[[in-code]]` stays, [[after]] goes.";
    const out = replaceWikilinks(md);
    expect(out).toContain("[[in-fence]]");
    expect(out).toContain("`[[in-code]]`");
    expect(out).toContain("[after](/notes/after)");
  });

  it("URL-encodes the slug", () => {
    expect(replaceWikilinks("[[a b]]")).toBe("[a b](/notes/a%20b)");
  });
});

describe("markSnippet", () => {
  it("escapes HTML first, then wraps «» in <mark>", () => {
    expect(markSnippet("a <b> «hit» here")).toBe("a &lt;b&gt; <mark>hit</mark> here");
  });

  it("neutralises a script tag inside a snippet", () => {
    const out = markSnippet("<script>alert(1)</script> «x»");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt; <mark>x</mark>");
  });
});

describe("splitSnippet", () => {
  it("splits into plain and hit parts", () => {
    expect(splitSnippet("a «b» c «d»")).toEqual([
      { text: "a ", hit: false },
      { text: "b", hit: true },
      { text: " c ", hit: false },
      { text: "d", hit: true },
    ]);
  });

  it("treats unbalanced markers as text", () => {
    expect(splitSnippet("a «b c")).toEqual([{ text: "a «b c", hit: false }]);
  });
});

describe("href helpers", () => {
  it("escapeHtml covers the five characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("safeHref drops javascript: and keeps http and paths", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("/notes/foo")).toBe("/notes/foo");
    expect(safeHref("")).toBeNull();
  });

  it("isExternalHref tells schemes from paths", () => {
    expect(isExternalHref("https://example.com")).toBe(true);
    expect(isExternalHref("mailto:a@b.c")).toBe(true);
    expect(isExternalHref("/notes/foo")).toBe(false);
    expect(isExternalHref("#top")).toBe(false);
  });
});
