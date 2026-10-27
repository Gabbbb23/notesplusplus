/*
 * The scroll position of every history entry the reader has left, so that Back and Forward land on
 * the exact spot they were reading, the way the browser does for pages it rendered itself. The
 * browser cannot do it for this app: a note loads after the route changes, so the page is still
 * short when the browser would scroll.
 */

export interface ScrollMemory {
  /** Record where the entry with this key is scrolled to. */
  remember(key: string, y: number): void;
  /** Where the entry with this key was last scrolled to, or undefined when it was never scrolled. */
  recall(key: string): number | undefined;
  /** Write every position to the storage given at creation, so a reload keeps them. */
  persist(): void;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export const SCROLL_MEMORY_STORAGE_KEY = "notesplusplus.scroll";

/** How many entries are kept: the oldest go first. */
export const SCROLL_MEMORY_LIMIT = 50;

function readStored(storage: Storage | null | undefined): Array<[string, number]> {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SCROLL_MEMORY_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number" && Number.isFinite(entry[1]),
    );
  } catch {
    return [];
  }
}

/**
 * Positions keyed by history entry, newest last, at most `limit` of them. With a storage (session
 * storage in the app) the positions saved before a reload come back, and persist() writes them out.
 */
export function createScrollMemory(storage?: Storage | null, limit = SCROLL_MEMORY_LIMIT): ScrollMemory {
  const positions = new Map<string, number>(readStored(storage).slice(-limit));

  return {
    remember(key, y) {
      positions.delete(key);
      positions.set(key, Math.max(0, Math.round(y)));
      while (positions.size > limit) {
        const oldest = positions.keys().next().value;
        if (oldest === undefined) break;
        positions.delete(oldest);
      }
    },
    recall(key) {
      return positions.get(key);
    },
    persist() {
      if (!storage) return;
      try {
        storage.setItem(SCROLL_MEMORY_STORAGE_KEY, JSON.stringify([...positions]));
      } catch {
        // Storage full or blocked: positions live on in memory for this page load.
      }
    },
  };
}

/** Whether a page `scrollHeight` tall, seen through a viewport `viewportHeight` tall, can scroll to `y`. */
export function canReach(y: number, scrollHeight: number, viewportHeight: number): boolean {
  return y <= Math.max(0, scrollHeight - viewportHeight);
}
