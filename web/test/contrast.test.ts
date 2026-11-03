import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FileTypeBadge, KindBadge, StatusBadge, type Kind, type StatusTone } from "../src/components/badges";
import { Notice, type NoticeTone } from "../src/components/notice";
import {
  blend,
  classColour,
  contrastRatio,
  hexToRgb,
  readColourTokens,
  readSchemes,
  relativeLuminance,
  type ClassColour,
  type SchemeName,
} from "./contrast";

/*
 * Guards "Web UI meets WCAG AA contrast" (DECISIONS.md, 2026-09-15) against the M3 colour roles in
 * src/theme.css, light and dark, as index.css maps them: text 4.5:1 (WCAG 1.4.3), control boundaries and focus indicators 3:1 (WCAG 1.4.11).
 * Notices and badges are rendered, so their checks follow the classes they actually use.
 */

const TEXT = 4.5;
const NON_TEXT = 3;

describe("contrast helper", () => {
  it("reads hex colours, short and long", () => {
    expect(hexToRgb("#1a73e8")).toEqual([26, 115, 232]);
    expect(hexToRgb("#FFF")).toEqual([255, 255, 255]);
    expect(() => hexToRgb("blue")).toThrow(/Not a hex colour/);
  });

  it("computes WCAG luminance and ratios", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#dadce0", "#dadce0")).toBe(1);
  });

  it("matches the earlier QA measurements", () => {
    // Link text in the button blue on the grey page, and the old input border on a white card.
    expect(contrastRatio("#1a73e8", "#f8f9fa")).toBeCloseTo(4.27, 2);
    expect(contrastRatio("#dadce0", "#ffffff")).toBeCloseTo(1.37, 2);
  });

  it("blends a translucent colour over its background", () => {
    expect(blend("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(blend("#d93025", "#ffffff", 1)).toBe("#d93025");
    // The old danger message, text-destructive/90 on a white card.
    expect(contrastRatio(blend("#d93025", "#ffffff", 0.9), "#ffffff")).toBeCloseTo(4.22, 1);
  });

  it("reads a colour class, its alpha, and its variant, skipping classes that are not colours", () => {
    const tokens = { success: "#137333", "success-tint": "#e6f4ea", radius: "0.5rem" };
    const cls = "text-sm bg-success-tint text-success *:data-[slot=alert-description]:text-success/90 rounded-radius";
    expect(classColour(cls, "bg", tokens)).toEqual({ token: "success-tint", hex: "#e6f4ea", alpha: 1 });
    expect(classColour(cls, "text", tokens)).toEqual({ token: "success", hex: "#137333", alpha: 1 });
    expect(classColour(cls, "text", tokens, "*:data-[slot=alert-description]:")).toEqual({
      token: "success",
      hex: "#137333",
      alpha: 0.9,
    });
    expect(classColour("text-xs text-left", "text", tokens)).toBeUndefined();
  });

  it("resolves var() references between tokens", () => {
    const tokens = readColourTokens(`:root {\n  --a: #123456;\n  --b: var(--a);\n  --c: var(--b);\n}`);
    expect(tokens).toMatchObject({ a: "#123456", b: "#123456", c: "#123456" });
    expect(() => readColourTokens(`:root {\n  --a: var(--b);\n  --b: var(--a);\n}`)).toThrow(/cycle/);
  });
});

const SCHEMES = readSchemes();
const SCHEME_NAMES = ["light", "dark"] as const satisfies readonly SchemeName[];

/** The surfaces text and controls sit on: the page, every container tone, and the drawer and cards. */
const SURFACES = [
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
];

describe.each(SCHEME_NAMES)("the %s scheme meets WCAG AA", (scheme) => {
  const t = SCHEMES[scheme];

  it("has every role index.css maps", () => {
    for (const role of ["primary", "on-primary", "surface", "on-surface", "outline", "outline-variant", "inverse-surface"]) {
      expect(t[role], role).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each([
    ["primary"],
    ["primary-container"],
    ["secondary"],
    ["secondary-container"],
    ["tertiary"],
    ["tertiary-container"],
    ["error"],
    ["error-container"],
    ["success"],
    ["success-container"],
    ["warning"],
    ["warning-container"],
  ])("text: on-%s on %s", (role) => {
    expect(contrastRatio(t[`on-${role}`]!, t[role]!)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(SURFACES)("text: on-surface, on-surface-variant, and primary (links) on %s", (surface) => {
    for (const fg of ["on-surface", "on-surface-variant", "primary"]) {
      expect(contrastRatio(t[fg]!, t[surface]!), `${fg} on ${surface}`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it.each(SURFACES)("non-text: the outline (control boundary) and secondary (focus indicator) on %s", (surface) => {
    for (const fg of ["outline", "secondary"]) {
      expect(contrastRatio(t[fg]!, t[surface]!), `${fg} on ${surface}`).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });

  it("text: snackbars and tooltips on the inverse surface", () => {
    expect(contrastRatio(t["inverse-on-surface"]!, t["inverse-surface"]!)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(t["inverse-primary"]!, t["inverse-surface"]!)).toBeGreaterThanOrEqual(TEXT);
  });

  it("text: the nav drawer's active item, on-secondary-container on secondary-container", () => {
    expect(contrastRatio(t["on-secondary-container"]!, t["secondary-container"]!)).toBeGreaterThanOrEqual(TEXT);
  });

  it("text: each kind and status token on its own background, and search hits", () => {
    const pairs = Object.keys(t)
      .filter((name) => /^(?:kind|status)-.+-fg$/.test(name))
      .map((fg) => [fg, fg.replace(/-fg$/, "-bg")] as const);
    // note, hub, source, file; neutral, success, warning, danger.
    expect(pairs).toHaveLength(8);
    for (const [fg, bg] of pairs) {
      expect(t[bg], bg).toBeDefined();
      expect(contrastRatio(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(TEXT);
    }
    expect(contrastRatio(t["on-mark"]!, t.mark!)).toBeGreaterThanOrEqual(TEXT);
  });

  it("success stays green and warning stays orange", () => {
    const [r, g, b] = hexToRgb(t.success!);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    const [wr, wg, wb] = hexToRgb(t.warning!);
    expect(wr).toBeGreaterThan(wg);
    expect(wg).toBeGreaterThan(wb);
  });
});

it("the dark scheme is dark and the light one light", () => {
  expect(relativeLuminance(SCHEMES.light.surface!)).toBeGreaterThan(0.8);
  expect(relativeLuminance(SCHEMES.dark.surface!)).toBeLessThan(0.05);
});

function ratioOn(fg: ClassColour, bg: ClassColour): number {
  expect(bg.alpha, `${bg.token} is opaque`).toBe(1);
  return contrastRatio(blend(fg.hex, bg.hex, fg.alpha), bg.hex);
}

describe.each(SCHEME_NAMES)("every tinted component meets 4.5:1 in the %s scheme", (scheme) => {
  const t = SCHEMES[scheme];
  const DESCRIPTION = "*:data-[slot=alert-description]:";

  it.each<NoticeTone>(["info", "success", "warning", "danger"])("the %s notice: title and body on its background", (tone) => {
    render(createElement(Notice, { tone, title: "Title" }, "Body"));
    const notice = screen.getByRole("alert");
    const title = notice.querySelector<HTMLElement>("[data-slot='alert-title']")!;
    const body = notice.querySelector<HTMLElement>("[data-slot='alert-description']")!;

    const bg = classColour(notice.className, "bg", t);
    // The title takes the notice's text colour unless it sets its own. The notice may set the body's.
    const titleColour = classColour(title.className, "text", t) ?? classColour(notice.className, "text", t);
    const bodyColour = classColour(notice.className, "text", t, DESCRIPTION) ?? classColour(body.className, "text", t);
    expect(bg, "a background colour").toBeDefined();
    expect(titleColour, "a title colour").toBeDefined();
    expect(bodyColour, "a body colour").toBeDefined();

    expect(ratioOn(titleColour!, bg!), `title ${titleColour!.token} on ${bg!.token}`).toBeGreaterThanOrEqual(TEXT);
    expect(ratioOn(bodyColour!, bg!), `body ${bodyColour!.token} on ${bg!.token}`).toBeGreaterThanOrEqual(TEXT);
  });

  it.each<Kind>(["note", "hub", "source", "file"])("the %s badge", (kind) => {
    const { container } = render(createElement(KindBadge, { kind }));
    const badge = container.querySelector<HTMLElement>("[data-kind]")!;
    const bg = classColour(badge.className, "bg", t)!;
    const fg = classColour(badge.className, "text", t)!;
    expect(bg.token).toBe(`kind-${kind}-bg`);
    expect(ratioOn(fg, bg), `${fg.token} on ${bg.token}`).toBeGreaterThanOrEqual(TEXT);
  });

  it.each<StatusTone>(["neutral", "success", "warning", "danger"])("the %s status badge", (tone) => {
    const { container } = render(createElement(StatusBadge, { tone, children: "3" }));
    const badge = container.querySelector<HTMLElement>("[data-tone]")!;
    const bg = classColour(badge.className, "bg", t)!;
    const fg = classColour(badge.className, "text", t)!;
    expect(bg.token).toBe(`status-${tone}-bg`);
    expect(ratioOn(fg, bg), `${fg.token} on ${bg.token}`).toBeGreaterThanOrEqual(TEXT);
  });

  it("the file type badge", () => {
    const { container } = render(createElement(FileTypeBadge, { ext: "pdf" }));
    const badge = container.querySelector<HTMLElement>("[data-slot='badge']")!;
    const bg = classColour(badge.className, "bg", t)!;
    expect(ratioOn(classColour(badge.className, "text", t)!, bg)).toBeGreaterThanOrEqual(TEXT);
  });
});
