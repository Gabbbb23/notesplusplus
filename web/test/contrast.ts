import { readFileSync } from "node:fs";
// Node's URL: under jsdom the global URL is jsdom's, which fileURLToPath rejects.
import { URL as NodeURL, fileURLToPath } from "node:url";

/*
 * WCAG 2 contrast from the colour tokens in src/index.css. Pure functions, plus one reader for the
 * stylesheet, so a token change that breaks contrast fails `npm test`.
 */

/** "#1a73e8" or "#fff" as 0-255 channels. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const digits = m[1]!.length === 3 ? [...m[1]!].map((d) => d + d).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance, 0 for black to 1 for white. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours, from 1 to 21. The order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** A colour at `alpha` (0 to 1) laid over an opaque background, as the browser paints it. */
export function blend(fg: string, bg: string, alpha: number): string {
  const top = hexToRgb(fg);
  const under = hexToRgb(bg);
  return `#${top.map((c, i) => Math.round(c * alpha + under[i]! * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

/** A Tailwind colour class resolved against the tokens: the token's hex and the class's alpha. */
export interface ClassColour {
  token: string;
  hex: string;
  alpha: number;
}

/**
 * The colour that a class list sets for a utility ("bg" or "text"), such as `text-success/90`, under
 * an exact variant prefix such as "*:data-[slot=alert-description]:" ("" for none). Only classes whose
 * name is a colour token count, so `text-sm` is skipped. The last match wins, as with tailwind-merge.
 */
export function classColour(
  className: string,
  utility: "bg" | "text",
  tokens: Record<string, string>,
  variant = "",
): ClassColour | undefined {
  let found: ClassColour | undefined;
  for (const cls of className.split(/\s+/)) {
    const prefix = `${variant}${utility}-`;
    if (!cls.startsWith(prefix)) continue;
    const m = /^([a-z0-9-]+?)(?:\/(\d{1,3}))?$/.exec(cls.slice(prefix.length));
    const hex = m && tokens[m[1]!];
    if (!m || !hex || !hex.startsWith("#")) continue;
    found = { token: m[1]!, hex, alpha: m[2] ? Number(m[2]) / 100 : 1 };
  }
  return found;
}

/**
 * The custom properties declared in the stylesheet's :root block, with var() references resolved,
 * keyed without the leading dashes: { background: "#f8f9fa", "kind-hub-bg": "#e6f4ea", ... }.
 */
export function readColourTokens(css: string): Record<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  if (!root) throw new Error("No :root block in the stylesheet");
  const raw = new Map(Array.from(root[1]!.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g), (m) => [m[1]!, m[2]!.trim()]));
  const resolve = (name: string, seen: string[] = []): string => {
    const value = raw.get(name);
    if (value === undefined) throw new Error(`Unknown token --${name}`);
    const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value);
    if (!ref) return value;
    if (seen.includes(name)) throw new Error(`Token cycle: ${[...seen, name].join(" -> ")}`);
    return resolve(ref[1]!, [...seen, name]);
  };
  return Object.fromEntries(Array.from(raw.keys(), (name) => [name, resolve(name)]));
}

/** src/index.css as text. */
export function readIndexCss(): string {
  return readFileSync(fileURLToPath(new NodeURL("../src/index.css", import.meta.url)), "utf8");
}
