/*
 * Keyboard shortcuts: the one place that says which keys do what. The listener matches events
 * against these, the input announces them with aria-keyshortcuts, and the hint draws their keys.
 */

/** A key combination, matched on the physical key (event.code) so keyboard layouts do not change it. */
export interface Shortcut {
  /** KeyboardEvent.code, e.g. "KeyK". On macOS Option+K types "˚", so event.key would not match. */
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** The aria-keyshortcuts value, e.g. "Alt+K". */
  aria: string;
  /** The keycaps to draw, e.g. ["Alt", "K"]. */
  keys: readonly string[];
  /** The keys as one line of text, e.g. "Alt K". */
  label: string;
}

export type ShortcutKeyEvent = Pick<KeyboardEvent, "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat">;

/** True on macOS and iOS, where Alt is the Option key ⌥. */
export function isApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The platform name, read once when this module loads. Empty outside a browser. */
function detectPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform ?? nav.platform ?? "";
}

/** Alt+K, drawn as "⌥ K" on Apple platforms and "Alt K" everywhere else. */
export function focusSearchShortcut(platform: string): Shortcut {
  const keys = isApplePlatform(platform) ? ["⌥", "K"] : ["Alt", "K"];
  return {
    code: "KeyK",
    // Requiring no Ctrl keeps AltGr (Ctrl+Alt on Windows layouts) from triggering it.
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    aria: "Alt+K",
    keys,
    label: keys.join(" "),
  };
}

/** Focus the search field: the Search page's box there, the top bar's field everywhere else. */
export const FOCUS_SEARCH: Shortcut = focusSearchShortcut(detectPlatform());

/** Whether a keydown is the shortcut: the same physical key and exactly its modifiers, not a key repeat. */
export function matchesShortcut(shortcut: Shortcut, event: ShortcutKeyEvent): boolean {
  return (
    !event.repeat &&
    event.code === shortcut.code &&
    event.altKey === shortcut.altKey &&
    event.ctrlKey === shortcut.ctrlKey &&
    event.metaKey === shortcut.metaKey &&
    event.shiftKey === shortcut.shiftKey
  );
}
