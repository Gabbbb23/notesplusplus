import { describe, expect, it } from "vitest";
import { FOCUS_SEARCH, matchesShortcut, type ShortcutKeyEvent } from "../src/lib/shortcuts";

const key = (overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: "/",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  target: document.body,
  ...overrides,
});

describe("matchesShortcut(FOCUS_SEARCH)", () => {
  const matches = (event: ShortcutKeyEvent) => matchesShortcut(FOCUS_SEARCH, event);

  it("matches / on the page", () => {
    expect(matches(key())).toBe(true);
  });

  it("ignores Ctrl, Alt, Meta, repeats, and other keys", () => {
    expect(matches(key({ ctrlKey: true }))).toBe(false);
    expect(matches(key({ altKey: true }))).toBe(false);
    expect(matches(key({ metaKey: true }))).toBe(false);
    expect(matches(key({ repeat: true }))).toBe(false);
    expect(matches(key({ key: "?" }))).toBe(false);
  });

  it("lets / type itself in inputs, textareas, selects, and editable content", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.append(inner);
    for (const target of [document.createElement("input"), document.createElement("textarea"), document.createElement("select"), inner]) {
      expect(matches(key({ target })), target.tagName).toBe(false);
    }
    const readOnly = document.createElement("div");
    readOnly.setAttribute("contenteditable", "false");
    expect(matches(key({ target: readOnly }))).toBe(true);
  });
});
