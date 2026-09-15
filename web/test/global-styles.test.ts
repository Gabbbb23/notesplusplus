// @vitest-environment node
import { readFileSync } from "node:fs";
import { URL as NodeURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readIndexCss } from "./contrast";

/*
 * Guards the global parts of "Web UI meets WCAG AA contrast and bundles Roboto" (DECISIONS.md,
 * 2026-09-15) that live in index.css and the entry module: reduced motion and the bundled font.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new NodeURL(relative, import.meta.url)), "utf8");
const css = readIndexCss().replace(/\/\*[\s\S]*?\*\//g, "");

describe("reduced motion", () => {
  it("one rule set stops every animation and transition", () => {
    const blocks = Array.from(css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/g), (m) => m[1]!);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
    expect(block).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(block).toMatch(/animation-iteration-count:\s*1 !important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms !important/);
  });
});

describe("fonts", () => {
  it("the entry bundles Roboto 400, 400 italic, 500, and 700 from @fontsource", () => {
    const main = read("../src/main.tsx");
    for (const face of ["400", "400-italic", "500", "700"]) {
      expect(main).toContain(`import "@fontsource/roboto/${face}.css";`);
    }
  });

  it("the sans stack starts with Roboto and falls back to Segoe UI; code keeps a monospace stack", () => {
    expect(css).toMatch(/--font-sans:\s*Roboto, "Segoe UI", system-ui, sans-serif;/);
    expect(css).toMatch(/--font-mono:\s*Consolas, [^;]*monospace;/);
  });

  it("nothing loads a font or stylesheet from the network", () => {
    const html = read("../index.html");
    for (const text of [css, html, read("../src/main.tsx")]) {
      expect(text).not.toMatch(/https?:\/\//);
    }
  });
});
