import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { NoteRef, PinTarget } from "@/lib/types";

/*
 * The owner's pins: notes pinned to Home and to the sidebar, stored by the server in pins.yml
 * (DECISIONS.md, 2026-09-15). Layout mounts PinsProvider once. It loads GET /api/pins once and
 * holds the one copy every menu, the Home "Pinned" section, and the sidebar read, so a change made
 * in one place shows everywhere at once.
 *
 * Changes show before the server answers. They go to the server one at a time, in order; each
 * answer carries every pin and replaces the lists. A change the server refuses is taken back out
 * and a toast gives the server's reason.
 */

export type MoveDirection = "up" | "down";

/** Each target's pinned notes in pin order. */
export interface PinLists {
  home: NoteRef[];
  sidebar: NoteRef[];
}

export type PinChange =
  | { kind: "pin"; note: NoteRef; target: PinTarget; pinned: boolean }
  | { kind: "move"; slug: string; target: PinTarget; direction: MoveDirection };

/** How a target reads inside a sentence: "Pinned to Home", "Unpinned from sidebar". */
export const PIN_TARGET_NAME: Record<PinTarget, string> = { home: "Home", sidebar: "sidebar" };

const NO_PINS: PinLists = { home: [], sidebar: [] };

/**
 * The lists after a change. Pinning appends, as the server does, and pinning a pinned note keeps
 * its place. A move past either end changes nothing. Unchanged lists come back as the same object.
 */
export function applyPinChange(lists: PinLists, change: PinChange): PinLists {
  const list = lists[change.target];
  if (change.kind === "pin") {
    const pinned = list.some((n) => n.slug === change.note.slug);
    if (pinned === change.pinned) return lists;
    const next = change.pinned ? [...list, change.note] : list.filter((n) => n.slug !== change.note.slug);
    return { ...lists, [change.target]: next };
  }
  const from = list.findIndex((n) => n.slug === change.slug);
  const to = change.direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= list.length) return lists;
  const next = [...list];
  next[from] = list[to]!;
  next[to] = list[from]!;
  return { ...lists, [change.target]: next };
}

/** The toast for a change the server accepted, or null for a move, which shows in the list itself. */
export function pinSuccessMessage(change: PinChange): string | null {
  if (change.kind === "move") return null;
  const name = PIN_TARGET_NAME[change.target];
  return change.pinned ? `Pinned to ${name}` : `Unpinned from ${name}`;
}

function pinFailureTitle(change: PinChange): string {
  const name = PIN_TARGET_NAME[change.target];
  if (change.kind === "move") return `Could not reorder the ${name} pins`;
  return change.pinned ? `Could not pin to ${name}` : `Could not unpin from ${name}`;
}

/** The lists without the fields the pins UI does not use, so optimistic entries and server answers look alike. */
function toLists(answer: { home: NoteRef[]; sidebar: NoteRef[] }): PinLists {
  const ref = ({ slug, title, type }: NoteRef): NoteRef => ({ slug, title, type });
  return { home: answer.home.map(ref), sidebar: answer.sidebar.map(ref) };
}

export type PinsStatus = "loading" | "ready" | "error";

export interface Pins {
  /** Each target's pinned notes in pin order, changes still on their way to the server included. */
  lists: PinLists;
  /** "error" when GET /api/pins failed: the lists read as empty until a retry or a change succeeds. */
  status: PinsStatus;
  isPinned(slug: string, target: PinTarget): boolean;
  /** Pin a note to the end of a target's list, or unpin it. */
  setPin(note: NoteRef, target: PinTarget, pinned: boolean): void;
  /** Swap a pinned note with its neighbour above or below. Nothing happens at either end. */
  move(slug: string, target: PinTarget, direction: MoveDirection): void;
  /** Load the lists again if the first load failed. Menus call it when they open. */
  retryLoad(): void;
}

const PinsContext = createContext<Pins | null>(null);

export function PinsProvider({ children }: { children: ReactNode }) {
  // The last lists the server sent, and the changes it has not answered yet, oldest first.
  const [confirmed, setConfirmed] = useState<PinLists | null>(null);
  const [pending, setPending] = useState<Array<{ id: number; change: PinChange }>>([]);
  const [status, setStatus] = useState<PinsStatus>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Read by queued requests, which run after the render that queued them.
  const confirmedRef = useRef<PinLists | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastId = useRef(0);

  const accept = useCallback((lists: PinLists) => {
    confirmedRef.current = lists;
    setConfirmed(lists);
    setStatus("ready");
  }, []);

  useEffect(() => {
    let live = true;
    api.pins().then(
      // A change's answer is at least as new as this load, so a load that returns after one is dropped.
      (answer) => live && confirmedRef.current === null && accept(toLists(answer)),
      () => live && confirmedRef.current === null && setStatus("error"),
    );
    return () => {
      live = false;
    };
  }, [loadAttempt, accept]);

  const change = useCallback(
    (next: PinChange) => {
      const id = ++lastId.current;
      setPending((list) => [...list, { id, change: next }]);
      const send = async () => {
        try {
          let answer: PinLists | null = null;
          if (next.kind === "pin") {
            answer = toLists(await api.setPin(next.target, next.note.slug, next.pinned));
          } else {
            // Every earlier change has been answered by now, so the order is worked out from the server's lists.
            const before = confirmedRef.current ?? NO_PINS;
            const after = applyPinChange(before, next);
            if (after !== before) {
              answer = toLists(await api.orderPins(next.target, after[next.target].map((n) => n.slug)));
            }
          }
          if (answer) accept(answer);
          const message = pinSuccessMessage(next);
          if (answer && message) toast.success(message);
        } catch (err) {
          toast.error(pinFailureTitle(next), { description: err instanceof Error ? err.message : String(err) });
        } finally {
          setPending((list) => list.filter((entry) => entry.id !== id));
        }
      };
      queue.current = queue.current.then(send);
    },
    [accept],
  );

  const lists = useMemo(
    () => pending.reduce((shown, entry) => applyPinChange(shown, entry.change), confirmed ?? NO_PINS),
    [confirmed, pending],
  );

  const value = useMemo<Pins>(
    () => ({
      lists,
      status,
      isPinned: (slug, target) => lists[target].some((n) => n.slug === slug),
      setPin: (note, target, pinned) => change({ kind: "pin", note: { slug: note.slug, title: note.title, type: note.type }, target, pinned }),
      move: (slug, target, direction) => change({ kind: "move", slug, target, direction }),
      retryLoad: () => {
        if (status !== "error") return;
        setStatus("loading");
        setLoadAttempt((n) => n + 1);
      },
    }),
    [lists, status, change],
  );

  return <PinsContext.Provider value={value}>{children}</PinsContext.Provider>;
}

/** The pins. Only inside PinsProvider, which layout.tsx mounts around every page. */
export function usePins(): Pins {
  const pins = useContext(PinsContext);
  if (!pins) throw new Error("usePins needs a PinsProvider around it (layout.tsx mounts one).");
  return pins;
}
