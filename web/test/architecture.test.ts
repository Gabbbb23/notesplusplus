// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Guards the "one shared component per UI pattern" and "tables never scroll sideways"
 * decisions (DECISIONS.md, 2026-09-14). Every .ts and .tsx file under src, except the shadcn
 * primitives in components/ui, composes the shared components in src/components. Nothing
 * reaches past them to a primitive, hand-builds a table, heading, link, alert, or keycap, places
 * breadcrumbs anywhere but PageHeader, builds a file URL instead of using FileActions, builds its
 * own "Show more" button instead of using ShowMore, scrolls sideways, restyles a primitive's
 * colours, or hard-codes a colour. src/index.css may only scroll
 * code blocks sideways.
 *
 * Each rule has fixtures below proving it flags the pattern, so a rule that silently stops
 * matching fails the suite instead of passing it.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const CSS_FILE = "index.css";

interface SourceFile {
  /** Path relative to web/src with forward slashes, e.g. "pages/files.tsx". */
  path: string;
  source: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function scannedFiles(): SourceFile[] {
  return walk(SRC)
    .map((full) => path.relative(SRC, full).split(path.sep).join("/"))
    .filter((rel) => /\.tsx?$/.test(rel) && !rel.startsWith("components/ui/"))
    .map((rel) => ({ path: rel, source: readFileSync(path.join(SRC, rel), "utf8") }));
}

function readCss(): string {
  return readFileSync(path.join(SRC, CSS_FILE), "utf8");
}

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

/** Module specifiers in import and export statements, including dynamic imports. */
function importSpecifiers(source: string): string[] {
  const re = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;
  return Array.from(source.matchAll(re), (m) => m[1] ?? m[2] ?? m[3] ?? "");
}

function importsUi(source: string, primitive: string): boolean {
  const re = new RegExp(`(?:^|/)ui/${primitive}(?:\\.tsx?)?$`);
  return importSpecifiers(source).some((s) => re.test(s));
}

/** The source with block comments and whole-line comments blanked, so prose in comments is not flagged. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Contents of string and template literals: where class names, class maps, and style values live. */
function stringLiterals(source: string): string[] {
  const re = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  return Array.from(withoutComments(source).matchAll(re), (m) => m[0]);
}

/** The first match of re in any string literal, or null. */
function findInLiterals(source: string, re: RegExp): RegExpExecArray | null {
  for (const literal of stringLiterals(source)) {
    const m = re.exec(literal);
    if (m) return m;
  }
  return null;
}

/** Text from start up to the matching closing brace (start is the index of "{"), skipping strings. */
function balancedBraces(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** Each JSX opening tag for one of the named components, from "<Name" to its closing ">", and the index after it. */
function openingTags(source: string, names: string[]): Array<{ name: string; tag: string; end: number }> {
  const re = new RegExp(`<(${names.join("|")})(?![\\w.$])`, "g");
  const tags: Array<{ name: string; tag: string; end: number }> = [];
  for (const m of source.matchAll(re)) {
    let depth = 0;
    let quote: string | null = null;
    let end = source.length - 1;
    for (let i = m.index + m[0].length; i < source.length; i++) {
      const c = source[i]!;
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    tags.push({ name: m[1]!, tag: source.slice(m.index, end + 1), end: end + 1 });
  }
  return tags;
}

/** Each element for the named component: the opening tag and, unless it closes itself, everything up to its closing tag. */
function elements(source: string, name: string): string[] {
  return openingTags(source, [name]).map(({ tag, end }) => {
    if (tag.endsWith("/>")) return tag;
    const close = source.indexOf(`</${name}`, end);
    return tag + source.slice(end, close === -1 ? undefined : close);
  });
}

/** The value of a className attribute in an opening tag: the quoted string or the {expression}. */
function classNameValue(tag: string): string | null {
  const m = /\bclassName\s*=\s*/.exec(tag);
  if (!m) return null;
  const start = m.index + m[0].length;
  const first = tag[start];
  if (first === "{") return balancedBraces(tag, start);
  if (first === '"' || first === "'") {
    const close = tag.indexOf(first, start + 1);
    return tag.slice(start, close === -1 ? undefined : close + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/** Tailwind palette colour classes such as text-red-600 or hover:bg-blue-50. */
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:text|bg|border|ring|fill|stroke|outline|decoration|from|to|via)-(?:${PALETTE})-\\d{2,3}(?![\\w-])`,
);

const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z_-])/;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|oklch)\(/;

/** Colour names a utility can take: the --color-* tokens from @theme in index.css, plus Tailwind's keywords. */
function colourTokens(css: string): Set<string> {
  const names = Array.from(css.matchAll(/--color-([a-z0-9-]+)\s*:/g), (m) => m[1]!);
  return new Set([...names, "black", "white", "transparent", "current", "inherit"]);
}

const COLOUR_TOKENS = colourTokens(readCss());
const COLOUR_UTILITY = /^(?:bg|text|border(?:-[xytrblse])?|ring|outline|fill|stroke|decoration)-(.+)$/;

/** The first class in a className value that sets a colour, or null. */
function colourClass(value: string): string | null {
  // Split on spaces, quotes, braces, parentheses, and commas, but not inside [arbitrary] values.
  for (const raw of value.split(/[\s"'`{}(),]+(?![^[]*\])/)) {
    if (raw === "") continue;
    const cls = raw.replace(/^!|!$/g, "");
    if (/(?:^|:)hover:bg-/.test(`:${cls}`)) return cls;
    const utility = cls.slice(cls.lastIndexOf(":") + 1).replace(/\/\d+$/, "");
    const m = COLOUR_UTILITY.exec(utility);
    if (!m) continue;
    const colour = m[1]!;
    if (COLOUR_TOKENS.has(colour)) return cls;
    if (new RegExp(`^(?:${PALETTE})-\\d{2,3}$`).test(colour)) return cls;
    if (/^\[.*(?:#|rgb|hsl|oklch|var\(--).*\]$/.test(colour)) return cls;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rules for .ts and .tsx files
// ---------------------------------------------------------------------------

interface Rule {
  name: string;
  /** Files allowed to break this rule: the shared component that owns the pattern. */
  allowed: string[];
  check: (source: string) => string | null;
}

const TABLE_TAGS = "table|thead|tbody|tfoot|tr|th|td|caption";
const RAW_TABLE_JSX = new RegExp(`<(${TABLE_TAGS})(?=[\\s>/])`);
const TABLE_ROLE = /\brole\s*[=:]\s*\{?\s*["'`](table|grid|treegrid)["'`]/;
const CREATE_TABLE = new RegExp(`\\b(?:createElement|jsxs?|jsxDEV)\\s*\\(\\s*["'\`](${TABLE_TAGS})["'\`]`);
const RAW_H1 = /<h1(?=[\s>/])|\b(?:createElement|jsxs?|jsxDEV)\s*\(\s*["'`]h1["'`]/;
const RAW_KBD = /<kbd(?=[\s>/])|\b(?:createElement|jsxs?|jsxDEV)\s*\(\s*["'`]kbd["'`]/;
const SCROLL_CLASS = /(?<![\w-])overflow-(?:x-)?(?:auto|scroll)(?![\w-])/;
const SCROLL_STYLE = /\boverflowX\b|\boverflow\s*:\s*["'`](?:auto|scroll)["'`]|\boverflow(?:-x)?\s*:\s*(?:auto|scroll)\b/;
const FILE_URL_CALL = /\b(fileUrl|localFileUrl|viewUrlFor)\s*\(/;
const RENDERED_BREADCRUMBS = /<Breadcrumbs(?![\w.$])|\b(?:createElement|jsxs?|jsxDEV)\s*\(\s*Breadcrumbs\b/;
const BREADCRUMB_ADVICE =
  "Pass the items to PageHeader's breadcrumbs prop (@/components/page-header), so every page places them the same way.";

const TABLE_ADVICE = "Use DataTable, or ResponsiveTable with its Table* primitives, from @/components/data-table.";

/** Words that mark a button as growing a list. */
const MORE_WORDING = /\b(?:show|load|see|view)\s+more\b/i;

const RULES: Rule[] = [
  {
    name: "shadcn table import",
    allowed: ["components/data-table.tsx"],
    check: (s) => (importsUi(s, "table") ? `imports @/components/ui/table. ${TABLE_ADVICE}` : null),
  },
  {
    name: "shadcn badge import",
    allowed: ["components/badges.tsx"],
    check: (s) =>
      importsUi(s, "badge")
        ? "imports @/components/ui/badge. Use KindBadge, TagBadge, TagBadges, FileTypeBadge, or StatusBadge from @/components/badges."
        : null,
  },
  {
    name: "shadcn card import",
    allowed: ["components/item-card.tsx"],
    check: (s) =>
      importsUi(s, "card")
        ? "imports @/components/ui/card. Use ItemCard, SectionCard, StatCard, or LoadingCards from @/components/item-card."
        : null,
  },
  {
    name: "shadcn alert import",
    allowed: ["components/notice.tsx"],
    check: (s) =>
      importsUi(s, "alert")
        ? "imports @/components/ui/alert. Use Notice from @/components/notice, or ErrorAlert from @/components/page-state."
        : null,
  },
  {
    name: "shadcn breadcrumb import",
    allowed: ["components/breadcrumbs.tsx"],
    check: (s) => (importsUi(s, "breadcrumb") ? `imports @/components/ui/breadcrumb. ${BREADCRUMB_ADVICE}` : null),
  },
  {
    name: "breadcrumbs outside the page header",
    allowed: ["components/page-header.tsx"],
    check: (s) => (RENDERED_BREADCRUMBS.test(withoutComments(s)) ? `renders <Breadcrumbs>. ${BREADCRUMB_ADVICE}` : null),
  },
  {
    name: "react-markdown import",
    allowed: ["components/note-body.tsx"],
    check: (s) =>
      importSpecifiers(s).includes("react-markdown")
        ? "imports react-markdown. Use NoteBody from @/components/note-body, which renders markdown through the shared components."
        : null,
  },
  {
    name: "mermaid import",
    allowed: ["components/diagram.tsx"],
    check: (s) =>
      importSpecifiers(s).some((spec) => spec === "mermaid" || spec.startsWith("mermaid/"))
        ? "imports mermaid. Use Diagram from @/components/diagram, which loads mermaid on demand with the app's theme and strict security."
        : null,
  },
  {
    name: "external-link icon",
    allowed: ["components/text-link.tsx"],
    check: (s) =>
      /\bExternalLink(?:Icon)?\b/.test(withoutComments(s))
        ? "uses ExternalLinkIcon. Use TextLink with href from @/components/text-link, which adds the one external-link icon."
        : null,
  },
  {
    name: "file URL outside the file actions",
    allowed: ["lib/api.ts", "components/file-actions.tsx"],
    check: (s) => {
      const m = FILE_URL_CALL.exec(withoutComments(s));
      return m
        ? `calls ${m[1]}(). Use FileActions or FileLink from @/components/file-actions, which give a file View, Open, and Show in folder.`
        : null;
    },
  },
  {
    name: "raw table markup",
    allowed: ["components/data-table.tsx"],
    check: (s) => {
      const code = withoutComments(s);
      const jsx = RAW_TABLE_JSX.exec(code);
      if (jsx) return `renders a raw <${jsx[1]}> element. ${TABLE_ADVICE}`;
      const role = TABLE_ROLE.exec(code);
      if (role) return `builds a table with role="${role[1]}". ${TABLE_ADVICE}`;
      const created = CREATE_TABLE.exec(code);
      if (created) return `creates a <${created[1]}> element in code. ${TABLE_ADVICE}`;
      return null;
    },
  },
  {
    name: "hand-built show more button",
    allowed: ["components/show-more.tsx"],
    check: (s) => {
      // Buttons do not nest, so each element runs from <Button to the next </Button.
      for (const element of elements(withoutComments(s), "Button")) {
        const words = MORE_WORDING.exec(element);
        if (words) {
          return `builds its own "${words[0]}" <Button>. Use ShowMore from @/components/show-more, the one button that grows a list in place.`;
        }
      }
      return null;
    },
  },
  {
    name: "raw page heading",
    allowed: ["components/page-header.tsx"],
    check: (s) =>
      RAW_H1.test(withoutComments(s))
        ? "renders an <h1>. Use PageHeader from @/components/page-header, which owns the one h1 on every page; use SectionHeading from @/components/section-heading for a section title."
        : null,
  },
  {
    name: "raw keycap",
    allowed: ["components/kbd.tsx"],
    check: (s) =>
      RAW_KBD.test(withoutComments(s))
        ? "renders a <kbd> element. Use Kbd or KbdGroup from @/components/kbd, the one keycap style."
        : null,
  },
  {
    name: "hand-styled link",
    allowed: ["components/text-link.tsx"],
    check: (s) =>
      withoutComments(s).includes("hover:underline")
        ? "styles a link with hover:underline. Use TextLink from @/components/text-link (to for a route, href for a new tab)."
        : null,
  },
  {
    name: "sideways scrolling",
    allowed: [],
    check: (s) => {
      const code = withoutComments(s);
      const m = SCROLL_CLASS.exec(code) ?? SCROLL_STYLE.exec(code);
      return m
        ? `scrolls with ${m[0]}. Nothing scrolls sideways: use DataTable, which stacks when it cannot fit, and BreakableText for long values.`
        : null;
    },
  },
  {
    name: "palette colour class",
    allowed: [],
    check: (s) => {
      const m = findInLiterals(s, PALETTE_CLASS);
      return m
        ? `uses the Tailwind palette colour ${m[0]}. Use a token class (text-primary, bg-status-danger-bg, ...) backed by a custom property in src/index.css, or a shared component that already has the colour.`
        : null;
    },
  },
  {
    name: "hard-coded colour",
    allowed: [],
    check: (s) => {
      const m = findInLiterals(s, HEX_COLOUR) ?? findInLiterals(s, COLOUR_FUNCTION);
      return m
        ? `hard-codes the colour ${m[0]}. Add a custom property in src/index.css, wire it into @theme inline, and use its Tailwind class.`
        : null;
    },
  },
  {
    name: "colour override on a primitive",
    // The badge and notice modules own those primitives' colours.
    allowed: ["components/badges.tsx", "components/notice.tsx"],
    check: (s) => {
      for (const { name, tag } of openingTags(withoutComments(s), ["Button", "Alert", "Badge"])) {
        const value = classNameValue(tag);
        const cls = value && colourClass(value);
        if (!cls) continue;
        const advice: Record<string, string> = {
          Button: "Pick a Button variant, or change the variant's colours in @/components/ui/button.",
          Alert: "Use Notice with a tone from @/components/notice.",
          Badge: "Use KindBadge, StatusBadge (with a tone), TagBadge, or FileTypeBadge from @/components/badges.",
        };
        return `restyles <${name}> colours with ${cls}. ${advice[name]}`;
      }
      return null;
    },
  },
];

function findViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const rule of RULES) {
      if (rule.allowed.includes(file.path)) continue;
      const problem = rule.check(file.source);
      if (problem) violations.push(`src/${file.path} ${problem}`);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Rule for index.css
// ---------------------------------------------------------------------------

/** A selector whose subject (last compound) is a pre or code element. */
function isCodeBlockSelector(selector: string): boolean {
  const subject = selector.trim().split(/[\s>+~]+/).pop() ?? "";
  return /^(?:pre|code)(?![\w-])/.test(subject);
}

/** CSS rules that scroll sideways on anything but a code block. */
function findCssViolations(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const violations: string[] = [];
  for (const m of clean.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.trim();
    const body = m[2]!;
    const declared = /(?:^|[;{\s])(overflow(?:-x)?\s*:\s*(?:auto|scroll))\b/.exec(body)?.[1];
    const applied = Array.from(body.matchAll(/@apply\b[^;]*/g), (a) => SCROLL_CLASS.exec(a[0])?.[0]).find(Boolean);
    const scroll = declared ?? applied;
    if (!scroll) continue;
    if (selectors.split(",").every(isCodeBlockSelector)) continue;
    violations.push(
      `src/${CSS_FILE} "${selectors}" scrolls with ${scroll}. Only pre and code blocks may scroll sideways; tables use DataTable, long values use BreakableText.`,
    );
  }
  return violations;
}

// ---------------------------------------------------------------------------

describe("architecture: one shared component per UI pattern", () => {
  it("scans every .ts and .tsx file under src except the shadcn primitives", () => {
    const paths = scannedFiles().map((f) => f.path);
    for (const expected of [
      "App.tsx",
      "main.tsx",
      "pages/files.tsx",
      "components/breadcrumbs.tsx",
      "components/data-table.tsx",
      "components/diagram.tsx",
      "components/file-actions.tsx",
      "components/kbd.tsx",
      "components/layout.tsx",
      "components/show-more.tsx",
      "lib/breadcrumb-items.ts",
      "lib/rehype-table-cell-text.ts",
    ]) {
      expect(paths).toContain(expected);
    }
    expect(paths.some((p) => p.startsWith("components/ui/"))).toBe(false);
  });

  it("reads the colour tokens from index.css", () => {
    for (const token of ["primary", "primary-hover", "muted-foreground", "status-danger-bg", "kind-hub-fg"]) {
      expect(COLOUR_TOKENS.has(token)).toBe(true);
    }
  });

  it("source files use the shared components instead of primitives, raw markup, scrolling, or colours", () => {
    const violations = findViolations(scannedFiles());
    expect(violations, `\n${violations.join("\n")}\n`).toEqual([]);
  });

  it("index.css scrolls nothing sideways except code blocks", () => {
    const violations = findCssViolations(readCss());
    expect(violations, `\n${violations.join("\n")}\n`).toEqual([]);
  });

  describe("the rules catch", () => {
    const flag = (source: string, file = "pages/example.tsx") => findViolations([{ path: file, source }]);

    it("a shadcn table, badge, card, or alert import outside its shared component", () => {
      expect(flag(`import { Table } from "@/components/ui/table";`)[0]).toMatch(/ui\/table.*DataTable/);
      expect(flag(`import { Badge } from "@/components/ui/badge";`)[0]).toMatch(/ui\/badge.*@\/components\/badges/);
      expect(flag(`import { Card } from "../components/ui/card";`)[0]).toMatch(/ui\/card.*ItemCard/);
      expect(flag(`import { Alert } from "@/components/ui/alert";`)[0]).toMatch(/ui\/alert.*Notice/);
      expect(flag(`import { Alert } from "@/components/ui/alert";`, "lib/anything.ts")[0]).toMatch(/Notice/);
      expect(flag(`import { Table } from "@/components/ui/table";`, "components/data-table.tsx")).toEqual([]);
      expect(flag(`import { Badge } from "@/components/ui/badge";`, "components/badges.tsx")).toEqual([]);
      expect(flag(`import { Card } from "@/components/ui/card";`, "components/item-card.tsx")).toEqual([]);
      expect(flag(`import { Alert } from "@/components/ui/alert";`, "components/notice.tsx")).toEqual([]);
    });

    it("a shadcn breadcrumb import outside breadcrumbs.tsx", () => {
      expect(flag(`import { Breadcrumb, BreadcrumbList } from "@/components/ui/breadcrumb";`)[0]).toMatch(
        /ui\/breadcrumb.*PageHeader's breadcrumbs prop/,
      );
      expect(flag(`import { BreadcrumbItem } from "./ui/breadcrumb.tsx";`, "components/page-header.tsx")[0]).toMatch(
        /ui\/breadcrumb/,
      );
      expect(flag(`import { Breadcrumb } from "@/components/ui/breadcrumb";`, "components/breadcrumbs.tsx")).toEqual([]);
      // The shared component's module is not the primitive.
      expect(flag(`import { Breadcrumbs } from "@/components/breadcrumbs";`, "components/page-header.tsx")).toEqual([]);
    });

    it("<Breadcrumbs> rendered outside page-header.tsx", () => {
      expect(flag(`<Breadcrumbs items={[{ label: "Home", to: "/" }]} />`)[0]).toMatch(
        /renders <Breadcrumbs>.*PageHeader's breadcrumbs prop/,
      );
      expect(flag(`return (\n  <div>\n    <Breadcrumbs\n      items={crumbs}\n    />\n  </div>\n);`, "components/item-card.tsx")[0]).toMatch(
        /renders <Breadcrumbs>/,
      );
      expect(flag(`const nav = createElement(Breadcrumbs, { items });`)[0]).toMatch(/renders <Breadcrumbs>/);
      expect(flag(`{breadcrumbs && <Breadcrumbs items={breadcrumbs} />}`, "components/page-header.tsx")).toEqual([]);
      // Passing items to PageHeader, a comment, or a component with a longer name is fine.
      expect(flag(`<PageHeader title="Tags" breadcrumbs={TOP_LEVEL_CRUMBS} />\n// <Breadcrumbs> lives in page-header.tsx`)).toEqual([]);
      expect(flag(`<BreadcrumbsPreview />`)).toEqual([]);
    });

    it("a react-markdown import outside note-body.tsx", () => {
      expect(flag(`import ReactMarkdown from "react-markdown";`)[0]).toMatch(/react-markdown.*NoteBody/);
      expect(flag(`import ReactMarkdown from "react-markdown";`, "components/note-body.tsx")).toEqual([]);
    });

    it("a mermaid import, static or dynamic, outside diagram.tsx", () => {
      expect(flag(`import mermaid from "mermaid";`)[0]).toMatch(/imports mermaid.*Diagram/);
      expect(flag(`const m = await import("mermaid");`, "components/note-body.tsx")[0]).toMatch(/imports mermaid/);
      expect(flag(`import type { Mermaid } from "mermaid";`, "lib/diagram-theme.ts")[0]).toMatch(/imports mermaid/);
      expect(flag(`import { x } from "mermaid/dist/mermaid.core.mjs";`)[0]).toMatch(/imports mermaid/);
      expect(flag(`const m = import("mermaid").then((x) => x.default);`, "components/diagram.tsx")).toEqual([]);
      // A module whose name only contains the word is fine.
      expect(flag(`import { remarkMermaid } from "remark-mermaidjs";`)).toEqual([]);
    });

    it("ExternalLinkIcon outside text-link.tsx", () => {
      expect(flag(`import { ExternalLinkIcon } from "lucide-react";`)[0]).toMatch(/ExternalLinkIcon.*TextLink/);
      expect(flag(`import { ExternalLink } from "lucide-react";`)[0]).toMatch(/TextLink/);
      expect(flag(`import { ExternalLinkIcon } from "lucide-react";`, "components/text-link.tsx")).toEqual([]);
    });

    it("a file URL built outside lib/api.ts and file-actions.tsx", () => {
      expect(flag(`cell: (f) => <TextLink href={fileUrl(f.path)}>Open</TextLink>,`)[0]).toMatch(
        /calls fileUrl\(\).*FileActions or FileLink/,
      );
      expect(flag(`const href = localFileUrl(path);`, "components/search-results.tsx")[0]).toMatch(/calls localFileUrl\(\)/);
      expect(flag(`<a href={viewUrlFor (p)}>View</a>`, "lib/anything.ts")[0]).toMatch(/calls viewUrlFor\(\)/);
      expect(flag(`title: { text: t, href: api.fileUrl(p) }`)[0]).toMatch(/calls fileUrl\(\)/);
      expect(flag(`export function fileUrl(relPath: string) {}`, "lib/api.ts")).toEqual([]);
      expect(flag(`<TextLink href={viewUrlFor(path)}>View</TextLink>`, "components/file-actions.tsx")).toEqual([]);
      // Importing a name, a comment, or a different function that ends the same way is fine.
      expect(flag(`import { fileUrl } from "@/lib/api";\n// fileUrl(x) is for file-actions.tsx`)).toEqual([]);
      expect(flag(`const u = profileUrl(user);`)).toEqual([]);
    });

    it("a hand-built Show more button outside show-more.tsx", () => {
      expect(flag(`<Button variant="secondary" onClick={more}>Show more notes</Button>`)[0]).toMatch(
        /builds its own "Show more" <Button>.*ShowMore from @\/components\/show-more/,
      );
      expect(
        flag(
          `return (\n  <Button\n    variant="outline"\n    disabled={loading}\n    onClick={() => load(offset + 50)}\n  >\n    <ChevronDownIcon />\n    Load more\n  </Button>\n);`,
          "components/note-card.tsx",
        )[0],
      ).toMatch(/"Load more" <Button>/);
      expect(flag(`<Button onClick={more}>{loading ? "Loading" : "Show more results"}</Button>`)[0]).toMatch(/Show more/);
      expect(flag(`<Button size="icon" aria-label="See more tags" onClick={more} />`)[0]).toMatch(/"See more" <Button>/);
      expect(flag(`<Button variant="secondary" onClick={onClick}>{label}</Button>`, "components/show-more.tsx")).toEqual([]);
      // The shared component, other buttons, "more" text outside a button, and comments are fine.
      expect(flag(`<ShowMore label="Show more notes" loading={notes.loading} onClick={more} />`)).toEqual([]);
      expect(flag(`<Button variant="ghost" aria-expanded={open}>Show source</Button>`)).toEqual([]);
      expect(flag(`<Button size="icon" aria-label="Open menu" />\n<p>Show more details below.</p>\n<Button>Go</Button>`)).toEqual([]);
      expect(flag(`// <Button>Show more</Button> lives in show-more.tsx\n<Button>Search</Button>`)).toEqual([]);
    });

    it("raw table JSX, table roles, and created table elements outside data-table.tsx", () => {
      for (const tag of ["table", "thead", "tbody", "tr", "th", "td"]) {
        expect(flag(`const x = <${tag} className="a">1</${tag}>;`)[0]).toMatch(new RegExp(`raw <${tag}>.*DataTable`));
      }
      expect(flag(`const x = <div role="table"><div role="row" /></div>;`)[0]).toMatch(/role="table".*DataTable/);
      expect(flag(`const x = <div role="grid" />;`)[0]).toMatch(/role="grid".*DataTable/);
      expect(flag(`const x = <div role={"grid"} />;`)[0]).toMatch(/role="grid"/);
      expect(flag(`const t = createElement("table", null);`)[0]).toMatch(/creates a <table>.*DataTable/);
      expect(flag(`const t = React.createElement('td');`)[0]).toMatch(/creates a <td>/);
      expect(flag(`const x = <table><tbody /></table>;`, "components/data-table.tsx")).toEqual([]);
      expect(flag(`const x = <TableRow><Thing /></TableRow>; // renders rows`)).toEqual([]);
      expect(flag(`if (node.tagName === "table") label(node);`)).toEqual([]);
    });

    it("an <h1> outside page-header.tsx", () => {
      expect(flag(`const x = <h1 className="text-2xl">Title</h1>;`)[0]).toMatch(/<h1>.*PageHeader/);
      expect(flag(`const x = <h1>Title</h1>;`)[0]).toMatch(/PageHeader/);
      expect(flag(`const x = createElement("h1", null, "Title");`)[0]).toMatch(/PageHeader/);
      expect(flag(`const x = <h1 className="a">T</h1>;`, "components/page-header.tsx")).toEqual([]);
      expect(flag(`const x = <h2>Section</h2>;`)).toEqual([]);
    });

    it("a <kbd> element outside kbd.tsx", () => {
      expect(flag(`const hint = <kbd className="rounded border px-1">Alt</kbd>;`)[0]).toMatch(/<kbd>.*Kbd or KbdGroup/);
      expect(flag(`<span><kbd>K</kbd></span>`, "components/search-input.tsx")[0]).toMatch(/<kbd>/);
      expect(flag(`const k = createElement("kbd", null, "K");`)[0]).toMatch(/<kbd>/);
      expect(flag(`<kbd data-slot="kbd" className={KBD_CLASS}>{children}</kbd>`, "components/kbd.tsx")).toEqual([]);
      // The shared component, and a comment naming the element, are fine.
      expect(flag(`<KbdGroup keys={FOCUS_SEARCH.keys} />\n<Kbd>K</Kbd>\n// renders <kbd> through kbd.tsx`)).toEqual([]);
    });

    it("hover:underline outside text-link.tsx", () => {
      expect(flag(`<Link to="/" className="text-primary hover:underline">x</Link>`)[0]).toMatch(
        /hover:underline.*TextLink/,
      );
      expect(flag(`const LINK = "hover:underline";`, "components/text-link.tsx")).toEqual([]);
    });

    it("sideways scrolling classes and style objects anywhere", () => {
      for (const cls of ["overflow-x-auto", "overflow-x-scroll", "overflow-auto", "overflow-scroll", "md:overflow-x-auto"]) {
        expect(flag(`<div className="rounded-lg ${cls}" />`)[0]).toMatch(/scrolls with overflow-.*DataTable/);
      }
      expect(flag(`<div style={{ overflowX: "auto" }} />`)[0]).toMatch(/overflowX.*DataTable/);
      expect(flag(`<div style={{ overflow: "scroll" }} />`)[0]).toMatch(/scrolls with overflow/);
      expect(flag(`const c = "[overflow-x:auto]";`)[0]).toMatch(/scrolls with overflow-x:auto/);
      expect(flag(`<div className="overflow-x-auto" />`, "components/data-table.tsx")).toHaveLength(1);
      expect(flag(`<div className="overflow-hidden overflow-y-auto overflow-x-hidden" />`)).toEqual([]);
    });

    it("Tailwind palette colour classes", () => {
      expect(flag(`<p className="text-red-600" />`)[0]).toMatch(/palette colour text-red-600.*index\.css/);
      expect(flag(`const C = { a: "hover:bg-blue-50" };`)[0]).toMatch(/bg-blue-50/);
      expect(flag("<p className={`border-slate-200 ${x}`} />")[0]).toMatch(/border-slate-200/);
      for (const cls of ["ring-emerald-500", "fill-zinc-900", "from-sky-400", "to-rose-700", "via-amber-300"]) {
        expect(flag(`<p className="${cls}" />`)[0]).toMatch(new RegExp(cls));
      }
      expect(flag(`<p className="text-primary bg-status-danger-bg text-sm" />`)).toEqual([]);
    });

    it("hex colours and colour functions in string literals and style objects", () => {
      expect(flag(`<span className="bg-[#e6f4ea] text-success" />`)[0]).toMatch(/#e6f4ea.*index\.css/);
      expect(flag(`const C = { hub: "hover:border-[#c4c7cb]" };`)[0]).toMatch(/#c4c7cb/);
      expect(flag("<p className={`text-[#1a73e8] ${x}`} />")[0]).toMatch(/#1a73e8/);
      expect(flag(`<p style={{ color: "#fff" }} />`)[0]).toMatch(/#fff/);
      expect(flag(`<p style={{ background: "rgb(255, 0, 0)" }} />`)[0]).toMatch(/rgb\(.*index\.css/);
      expect(flag(`<p style={{ color: "rgba(0,0,0,.5)" }} />`)[0]).toMatch(/rgba\(/);
      expect(flag(`const c = "hsl(210 40% 50%)";`)[0]).toMatch(/hsl\(/);
      expect(flag(`<p className="bg-[oklch(0.7_0.1_200)]" />`)[0]).toMatch(/oklch\(/);
      expect(flag(`<span className="bg-kind-hub-bg">#tag</span>`)).toEqual([]);
    });

    it("colour classes passed to Button, Alert, or Badge", () => {
      expect(flag(`<Button type="submit" className="bg-primary hover:bg-primary-hover">Go</Button>`)[0]).toMatch(
        /restyles <Button> colours with bg-primary.*ui\/button/,
      );
      expect(flag(`<Button className="h-10 hover:bg-muted">Go</Button>`)[0]).toMatch(/hover:bg-muted/);
      expect(flag(`<Button className={cn("h-10", active && "text-destructive")}>Go</Button>`)[0]).toMatch(
        /text-destructive/,
      );
      expect(
        flag(`<Button onClick={() => go(a > b)} variant="outline" className="border-primary/40">Go</Button>`)[0],
      ).toMatch(/border-primary\/40/);
      expect(flag(`<Alert className="border-success/40 bg-success-tint text-success">x</Alert>`)[0]).toMatch(
        /restyles <Alert> colours.*Notice/,
      );
      expect(flag(`<Badge variant="secondary" className="bg-secondary text-foreground">x</Badge>`)[0]).toMatch(
        /restyles <Badge> colours.*@\/components\/badges/,
      );
      // Layout and size classes are fine, and so are colours on other elements.
      expect(flag(`<Button variant="ghost" size="icon" className="md:hidden">x</Button>`)).toEqual([]);
      expect(flag(`<Button className="h-10 text-sm border-2">x</Button>`)).toEqual([]);
      expect(flag(`<AlertTitle className="text-success">x</AlertTitle><div className="bg-card" />`)).toEqual([]);
      expect(flag(`<Badge className={cn(LABEL, KIND_CLASS[kind])}>x</Badge>`, "components/badges.tsx")).toEqual([]);
      expect(flag(`<Alert className="bg-success-tint">x</Alert>`, "components/notice.tsx")).toEqual([]);
    });

    it("a colour class added to a Button in any real source file", () => {
      // Proves the opening-tag parser copes with real files (comments, arrows, nested JSX), not just one-liners.
      const withButtons = scannedFiles().filter((f) => /<Button(?![\w.$])/.test(f.source));
      expect(withButtons.length).toBeGreaterThan(0);
      for (const file of withButtons) {
        const source = file.source.replace(/<Button(?![\w.$])/, `<Button className="bg-destructive"`);
        expect(flag(source, file.path).join("\n"), file.path).toMatch(/restyles <Button> colours with bg-destructive/);
      }
    });

    it("sideways scrolling in index.css outside code blocks", () => {
      expect(findCssViolations(`.table-wrap { overflow-x: auto; }`)[0]).toMatch(
        /"\.table-wrap" scrolls with overflow-x: auto.*DataTable/,
      );
      expect(findCssViolations(`.x { color: red; overflow: scroll }`)[0]).toMatch(/overflow: scroll/);
      expect(findCssViolations(`@layer components { .wide { @apply rounded overflow-x-auto; } }`)[0]).toMatch(
        /"\.wide" scrolls with overflow-x-auto/,
      );
      expect(findCssViolations(`.prose-note pre, .wide { overflow-x: auto; }`)).toHaveLength(1);
      expect(findCssViolations(`.prose-note pre { overflow-x: auto; }\n.prose-note pre code { overflow: auto }`)).toEqual(
        [],
      );
      expect(findCssViolations(`/* .x { overflow-x: auto } */ .y { overflow-x: hidden; overflow-y: auto; }`)).toEqual(
        [],
      );
    });
  });
});
