// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildThemeCss, THEME_CSS_PATH } from "../scripts/theme";

/*
 * The web UI uses Material 3 only. index.css switches off Tailwind's palette, text sizes, radii,
 * shadows, and breakpoints, so a class that names one of them, or a colour token from the shadcn
 * theme this replaced, renders nothing. This test finds those classes in every source file under src,
 * the primitives in components/ui included, and checks theme.css is what scripts/theme.ts generates.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const SOURCES = walk(SRC)
  .filter((full) => /\.tsx?$/.test(full))
  .map((full) => ({
    path: path.relative(SRC, full).split(path.sep).join("/"),
    // Comments and data-* attribute values (data-slot="text-link") are not classes.
    source: readFileSync(full, "utf8")
      .replace(/\/\*[\s\S]*?\*\/|(?<![:"'`])\/\/.*$/gm, "")
      .replace(/\bdata-[a-z-]+=(["'])[^"']*\1/g, ""),
  }));

// Not after "/" either, so an import path such as "@/components/text-link" is not read as a class.
const BEFORE = String.raw`(?<![\w/-])`;
const AFTER = String.raw`(?![\w-])`;
const COLOUR_UTILITY = "(?:bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|fill|stroke|decoration|divide|placeholder|caret|accent|from|via|to)";
const LEGACY_COLOUR =
  "(?:background|foreground|card|card-foreground|card-hover-border|popover|popover-foreground|primary-foreground|primary-hover|link|link-hover|secondary-foreground|muted|muted-foreground|accent|accent-foreground|destructive|destructive-foreground|success-tint|input|ring|border|white|black|sidebar(?:-[a-z-]+)?)";

interface Rule {
  name: string;
  pattern: RegExp;
  advice: string;
}

export const RULES: Rule[] = [
  {
    name: "a colour token from the old shadcn theme",
    pattern: new RegExp(`${BEFORE}${COLOUR_UTILITY}-${LEGACY_COLOUR}(?:\\/\\d+)?${AFTER}`),
    advice: "Use an M3 colour role: bg-surface, text-on-surface-variant, border-outline-variant, bg-primary text-on-primary, ...",
  },
  {
    name: "a Tailwind text size",
    pattern: new RegExp(`${BEFORE}text-(?:xs|sm|base|lg|xl|[2-9]xl)${AFTER}|${BEFORE}text-\\[\\d`),
    advice: "Use an M3 type role: text-body-large, text-title-medium, text-label-large, ...",
  },
  {
    name: "a Tailwind radius",
    pattern: new RegExp(`${BEFORE}rounded(?:-[trblse]{1,2})?(?:-(?:xs|sm|md|lg|xl|[2-4]xl|\\[[^\\]]*\\]))?${AFTER}(?!\\s*:)`),
    advice: "Use the M3 shape scale: rounded-extra-small, rounded-small, rounded-medium, rounded-large, rounded-extra-large, rounded-full, rounded-none.",
  },
  {
    name: "a Tailwind shadow",
    pattern: new RegExp(`${BEFORE}shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner))?${AFTER}(?!\\s*:)`),
    advice: "Use an M3 elevation level, shadow-level1 to shadow-level5, only where the component's spec gives it one.",
  },
  {
    name: "a Tailwind breakpoint",
    pattern: new RegExp(`${BEFORE}(?:max-)?(?:sm|md|lg|xl|2xl):`),
    advice: "Use an M3 window size class: medium:, expanded:, large:, extra-large:.",
  },
];

function violations(files: { path: string; source: string }[]): string[] {
  return files.flatMap(({ path: file, source }) =>
    RULES.flatMap((rule) => {
      const m = rule.pattern.exec(source);
      return m ? [`${file}: ${rule.name} (${m[0]}). ${rule.advice}`] : [];
    }),
  );
}

describe("Material 3 tokens only", () => {
  it("scans the primitives in components/ui as well", () => {
    const paths = SOURCES.map((f) => f.path);
    expect(paths).toContain("components/ui/button.tsx");
    expect(paths).toContain("components/layout.tsx");
  });

  it("no source file names a token index.css switched off", () => {
    const found = violations(SOURCES);
    expect(found, `\n${found.join("\n")}\n`).toEqual([]);
  });

  it("theme.css is what scripts/theme.ts generates (run npm run theme)", () => {
    expect(readFileSync(THEME_CSS_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(buildThemeCss());
  });

  describe("the rules catch", () => {
    const flag = (source: string) => violations([{ path: "x.tsx", source }]);
    it.each([
      `"text-muted-foreground"`,
      `"hover:bg-accent"`,
      `"border-input"`,
      `"focus-visible:outline-ring"`,
      `"bg-card/80"`,
      `"bg-sidebar-accent"`,
      `"text-sm font-medium"`,
      `"text-2xl"`,
      `"text-[13px]"`,
      `"rounded-md"`,
      `"rounded"`,
      `"rounded-t-lg"`,
      `"rounded-[6px]"`,
      `"shadow-xs"`,
      `"shadow"`,
      `"md:flex"`,
      `"max-sm:hidden"`,
    ])("%s", (source) => {
      expect(flag(source)).toHaveLength(1);
    });

    it.each([
      `"text-on-surface-variant text-body-medium"`,
      `"bg-surface-container-low rounded-medium"`,
      `"rounded-full rounded-none shadow-level2 shadow-none"`,
      `"expanded:flex max-expanded:hidden"`,
      `"text-left text-wrap border-2 border-outline outline-3 outline-secondary"`,
      `"bg-primary text-on-primary bg-secondary-container"`,
      `import { TextLink } from "@/components/text-link";`,
    ])("not %s", (source) => {
      expect(flag(source)).toEqual([]);
    });
  });
});
