/*
 * Keyboard shortcuts: the one place that says which keys do what. The listener matches events
 * against these, the input announces them with aria-keyshortcuts, and the hint draws their keys.
 */

/** A single key pressed with no Ctrl, Alt, or Meta, matched on the character it types (event.key). */
export interface Shortcut {
  /** KeyboardEvent.key, e.g. "/". Matching the character means a layout that needs Shift for it still works. */
  key: string;
  /** The aria-keyshortcuts value, e.g. "/". */
  aria: string;
  /** The keycaps to draw, e.g. ["/"]. */
  keys: readonly string[];
}

export type ShortcutKeyEvent = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "repeat" | "target">;

/** Focus the search field: the Search page's box there, the top bar's field everywhere else. */
export const FOCUS_SEARCH: Shortcut = { key: "/", aria: "/", keys: ["/"] };

/** True when the keydown happens in a place that takes typed text, where the key must type itself. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null
  );
}

/** Whether a keydown is the shortcut: its key with no Ctrl, Alt, or Meta, not a repeat, and not while typing in a field. */
export function matchesShortcut(shortcut: Shortcut, event: ShortcutKeyEvent): boolean {
  return (
    !event.repeat &&
    event.key === shortcut.key &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !isTyping(event.target)
  );
}
