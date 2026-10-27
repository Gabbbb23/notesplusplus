/*
 * Where the app sits in the browser's history: whether Back and Forward lead anywhere. The router
 * tells us how each location was reached (PUSH, REPLACE, POP) and gives every entry a key; this
 * keeps the keys in order so the Back and Forward buttons can enable themselves without asking the
 * browser, which does not say.
 */

export type NavigationKind = "PUSH" | "REPLACE" | "POP";

export interface HistoryPosition {
  canBack: boolean;
  canForward: boolean;
}

/** What the browser knows about the current entry, when it does: react-router stores its index in history.state. */
export interface BrowserHistoryHint {
  /** The entry's index among the app's own entries, 0 for the first. */
  index?: number;
}

export interface HistoryStack {
  /** Record that the app is now at `key`, reached by `kind`, and answer where that leaves Back and Forward. */
  visit(key: string, kind: NavigationKind, hint?: BrowserHistoryHint): HistoryPosition;
}

/**
 * The keys visited since the page loaded, in history order, with the current one marked.
 *
 * - PUSH drops every key after the current one and appends the new key.
 * - REPLACE swaps the current key.
 * - POP moves to the key when it is known. A key never seen arrives two ways. With no browser
 *   index, while the stack already holds entries, it is one the browser just made itself (a jump
 *   to a `#heading`), which sits after the current entry like a PUSH. Otherwise (the first load, a
 *   reload, an entry from before the page loaded) the stack starts over at that key; entries the
 *   browser holds before it still count for Back when the hint says there are any, and entries
 *   after it are unknown, so Forward waits until the app has seen one.
 */
export function createHistoryStack(): HistoryStack {
  let keys: string[] = [];
  let index = -1;
  let before = 0;

  const push = (key: string) => {
    keys = keys.slice(0, index + 1);
    keys.push(key);
    index++;
  };

  return {
    visit(key, kind, hint = {}) {
      if (kind === "PUSH" && index >= 0) {
        push(key);
      } else if (kind === "REPLACE" && index >= 0) {
        keys[index] = key;
      } else {
        const at = keys.indexOf(key);
        if (at !== -1) {
          index = at;
        } else if (index >= 0 && hint.index === undefined) {
          push(key);
        } else {
          keys = [key];
          index = 0;
          before = hint.index ?? 0;
        }
      }
      return { canBack: index > 0 || before > 0, canForward: index < keys.length - 1 };
    },
  };
}
