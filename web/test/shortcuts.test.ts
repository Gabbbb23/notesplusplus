// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FOCUS_SEARCH, focusSearchShortcut, isApplePlatform, matchesShortcut, type ShortcutKeyEvent } from "../src/lib/shortcuts";

const key = (overrides: Partial<ShortcutKeyEvent> & { key?: string } = {}): ShortcutKeyEvent => ({
  code: "KeyK",
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  ...overrides,
});

describe("matchesShortcut(FOCUS_SEARCH)", () => {
  const matches = (event: ShortcutKeyEvent) => matchesShortcut(FOCUS_SEARCH, event);

  it("matches Alt+K", () => {
    expect(matches(key({ key: "k" }))).toBe(true);
  });

  it("matches on the physical key, so Option+K on macOS (key ˚) still counts", () => {
    expect(matches(key({ key: "˚" }))).toBe(true);
  });

  it("ignores other modifiers, AltGr (Ctrl+Alt), repeats, plain K, and other keys", () => {
    expect(matches(key({ ctrlKey: true }))).toBe(false);
    expect(matches(key({ shiftKey: true }))).toBe(false);
    expect(matches(key({ metaKey: true }))).toBe(false);
    expect(matches(key({ repeat: true }))).toBe(false);
    expect(matches(key({ altKey: false }))).toBe(false);
    expect(matches(key({ code: "KeyJ" }))).toBe(false);
  });
});

describe("the focus-search shortcut's facts", () => {
  it("reads Alt K on Windows and Linux, ⌥ K on Apple platforms, and is always Alt+K to assistive tech", () => {
    for (const platform of ["Win32", "Windows", "Linux x86_64", ""]) {
      expect(focusSearchShortcut(platform)).toMatchObject({ keys: ["Alt", "K"], label: "Alt K", aria: "Alt+K" });
    }
    for (const platform of ["macOS", "MacIntel", "iPad"]) {
      expect(focusSearchShortcut(platform)).toMatchObject({ keys: ["⌥", "K"], label: "⌥ K", aria: "Alt+K" });
    }
    expect(isApplePlatform("Windows")).toBe(false);
  });

  it("is K with Alt only", () => {
    expect(FOCUS_SEARCH).toMatchObject({ code: "KeyK", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false });
  });
});
