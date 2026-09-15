import { describe, expect, it } from "vitest";
import { parseNoteBody, rewriteLinks } from "../src/core/graph/note-body.ts";

// The one parser of links and mentions. Each row is a body and what it links to or mentions. Rows marked "was:" are
// the disagreements the architecture review found between the old store regex, the old server mention scan, and
// the web view; the expected value is what the web view renders, which the parser now matches.

const B = "\\";
const fence = (marker: string, inside: string) => `${marker}\n${inside}\n${marker}`;

const linkCases: Array<[string, string, string[]]> = [
  ["a plain link", "See [[alpha]].", ["alpha"]],
  ["a labelled link, trimmed", "See [[ beta |Beta label]].", ["beta"]],
  ["links deduplicated in order of first appearance", "[[b]] [[a]] [[b|again]] [[c]]", ["b", "a", "c"]],
  ["links in lists, headings, quotes, and callouts", "# [[h]]\n\n- [[l]]\n\n> [[q]]\n\n> [!NOTE]\n> [[n]]", ["h", "l", "q", "n"]],
  ["a link in a table cell", "| Term | Note |\n|---|---|\n| X | [[t]] |", ["t"]],
  ["a labelled link in a table cell with an escaped pipe", `| Term | Note |\n|---|---|\n| X | [[t${B}|the t]] |`, ["t"]],
  ["no link from an unescaped pipe in a table cell, which splits the cell", "| Term | Note |\n|---|---|\n| [[t|x]] | y |", []],
  ["no link from single-backtick code", "Inline `[[code]]` and [[real]].", ["real"]],
  ["no link from a double-backtick span (was: store linked it)", "Inline ``[[dbl]]`` and [[real]].", ["real"]],
  ["no link from a triple-backtick span inside a line", "Inline ```[[triple]]``` here.", []],
  ["no link from a ``` fence", fence("```", "[[fenced]]"), []],
  ["no link from a ~~~ fence (was: store linked it)", fence("~~~", "[[tilde]]"), []],
  ["no link from a longer fence holding a shorter one", "````\n```\n[[inner]]\n```\n````\n[[after]]", ["after"]],
  ["no link from an unterminated fence, which runs to the end", "[[before]]\n```text\n[[unclosed]]", ["before"]],
  ["no link from an indented code block (was: store and web linked it)", "Para.\n\n    [[indented]]\n\n[[after]]", ["after"]],
  ["no link from a code block indented inside a list item", "- item\n\n      [[deep]]\n", []],
  ["no link from inline code that spans two lines", "`a\n[[multiline]]` [[after]]", ["after"]],
  ["no link inside a markdown link's text", "[see [[inside]]](https://example.com) and [[outside]]", ["outside"]],
  ["no link when markup splits it", "[[slug|*label*]] and [[plain]]", ["plain"]],
  ["an escaped bracket before a link", `${B}[[escaped]]`, ["escaped"]],
  ["CRLF line endings", "[[a]]\r\n```\r\n[[b]]\r\n```\r\n[[c]]\r\n", ["a", "c"]],
];

const MODULE = String.raw`C:\Important Files\College Files\Module 1.pdf`;

const mentionCases: Array<[string, string, string[]]> = [
  ["a path in single backticks, as written", "Module 1 is `" + MODULE + "`.", [MODULE]],
  ["forward slashes and a trailing slash, as written", "Folder `c:/college/notes/`.", ["c:/college/notes/"]],
  ["a path in double backticks (was: server refused it, web showed buttons)", "See ``" + MODULE + "``.", [MODULE]],
  ["a path in triple backticks inside a line", "See ```D:" + B + "Videos" + B + "a.mp4``` here.", [String.raw`D:\Videos\a.mp4`]],
  ["a span padded with one space each side, which markdown strips", "See ` C:" + B + "a.pdf `.", [String.raw`C:\a.pdf`]],
  ["paths in a list, a table cell, a heading, and a quote", "- `C:\\l.pdf`\n\n| F |\n|---|\n| `C:\\t.pdf` |\n\n## `C:\\h.pdf`\n\n> `C:\\q.pdf`", ["C:\\l.pdf", "C:\\t.pdf", "C:\\h.pdf", "C:\\q.pdf"]],
  ["duplicates dropped, other spellings kept", "`C:\\a.pdf` `C:\\a.pdf` `c:/A.pdf`", ["C:\\a.pdf", "c:/A.pdf"]],
  ["no mention inside a markdown link (was: server allowed it, web showed no buttons)", "[`" + MODULE + "`](https://example.com)", []],
  ["no mention in an indented code block (was: server allowed it, web showed no buttons)", "Para.\n\n    `" + MODULE + "`\n", []],
  ["no mention in a ``` fence", fence("```", "`" + MODULE + "`"), []],
  ["no mention in a ~~~ fence", fence("~~~", "`" + MODULE + "`"), []],
  ["no mention for a .. segment (was: web showed buttons, server answered 400)", "`C:\\Up\\..\\a.pdf`", []],
  ["no mention for a UNC path", "`\\\\server\\share\\a.pdf`", []],
  ["no mention for a device path", "`\\\\?\\C:\\a.pdf`", []],
  ["no mention for a colon after the drive letter", "`C:\\a.pdf:hidden` `C:\\x\\C:\\a.pdf`", []],
  ["no mention for characters Windows forbids", '`C:\\a?.pdf` `C:\\a*.pdf` `C:\\a"b.pdf` `C:\\a<b.pdf` `C:\\a>b.pdf` `C:\\a|b.pdf`', []],
  ["no mention for relative, drive-relative, and non-path code", "`files/a.pdf` `C:relative.pdf` `\\Windows\\a.pdf` `npm test`", []],
  ["no mention when the span holds more than the path", "`see C:\\a.pdf`", []],
  ["no mention for a path in plain text", "The file C:\\a.pdf is here.", []],
];

describe("parseNoteBody links", () => {
  it.each(linkCases)("%s", (_label, body, links) => {
    expect(parseNoteBody(body).links).toEqual(links);
  });
});

describe("parseNoteBody mentions", () => {
  it.each(mentionCases)("%s", (_label, body, mentions) => {
    expect(parseNoteBody(body).mentions).toEqual(mentions);
  });
});

describe("rewriteLinks", () => {
  const cases: Array<[string, string, string]> = [
    ["plain, labelled, and padded links, keeping labels", "[[old]] [[old|Label]] [[ old ]] [[older]]", "[[new]] [[new|Label]] [[new]] [[older]]"],
    ["an escaped label pipe in a table cell, keeping the escape", `| A |\n|---|\n| [[old${B}|Label]] |`, `| A |\n|---|\n| [[new${B}|Label]] |`],
    ["links on both sides of code", "[[old]] `x` [[old]]", "[[new]] `x` [[new]]"],
    ["no single- or double-backtick code", "`[[old]]` ``[[old]]`` [[old]]", "`[[old]]` ``[[old]]`` [[new]]"],
    ["no ``` or ~~~ fence", "```\n[[old]]\n```\n~~~\n[[old]]\n~~~\n[[old]]", "```\n[[old]]\n```\n~~~\n[[old]]\n~~~\n[[new]]"],
    ["no indented code block", "Para.\n\n    [[old]]\n\n[[old]]", "Para.\n\n    [[old]]\n\n[[new]]"],
    ["no markdown link text", "[see [[old]]](https://example.com) [[old]]", "[see [[old]]](https://example.com) [[new]]"],
    ["CRLF bodies unchanged apart from the link", "[[old]]\r\n```\r\n[[old]]\r\n```\r\n", "[[new]]\r\n```\r\n[[old]]\r\n```\r\n"],
  ];

  it.each(cases)("rewrites %s", (_label, body, expected) => {
    const rewritten = rewriteLinks(body, "old", "new");
    expect(rewritten).toBe(expected);
    // What it rewrote is exactly what the parser reads as a link.
    expect(parseNoteBody(rewritten).links.includes("old")).toBe(false);
  });

  it("returns the body unchanged when the slugs are equal", () => {
    expect(rewriteLinks("[[same]]", "same", "same")).toBe("[[same]]");
  });
});
