import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import { Button } from "@/components/ui/button";
import { createHistoryStack, type HistoryPosition } from "@/lib/history-position";
import { canReach, createScrollMemory } from "@/lib/scroll-memory";

/*
 * Back and Forward in the top bar, and the scroll memory behind them. Going back or forward, with
 * these buttons, the mouse's side buttons, or Alt and an arrow, lands on the exact spot the reader
 * had scrolled to, even though the page loads its note after the route changes. A link to a new
 * page opens at the top, as the browser would for a page of its own. Layout mounts the provider
 * once; nothing else touches window.scrollTo or history.scrollRestoration.
 */

const HistoryContext = createContext<HistoryPosition>({ canBack: false, canForward: false });

/** How long a restored position waits for the page to grow tall enough before settling for what is there. */
export const RESTORE_DEADLINE_MS = 2_000;

/** Whether there is a laid-out page to scroll at all (jsdom has none). */
const hasLayout = () => document.documentElement.scrollHeight > 0;

/**
 * The entry's index among the app's own history entries, which react-router keeps in
 * history.state. Undefined for an entry the browser made itself, such as a jump to a `#heading`.
 */
function browserIndex(): number | undefined {
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === "number" ? state.idx : undefined;
}

/**
 * What one history entry is called here. React-router's key, except for an entry the browser
 * made from a `#heading` link: the router has no state for those and calls every one "default",
 * the first page's key, so the hash is added to keep them apart.
 */
function entryIdOf(key: string, hash: string, index: number | undefined): string {
  return index === undefined && hash !== "" ? `${key}${hash}` : key;
}

/**
 * Scroll to `y` and keep at it, once a frame, until the page has grown tall enough for the scroll
 * to land there, or the deadline passes and it stays as far down as it got. A page that is still
 * its loading block when Back is pressed is too short to scroll, so one attempt is never enough.
 * Stops at once if the reader scrolls on their own. Returns the function that stops it early.
 */
export function restoreScroll(y: number, deadlineMs = RESTORE_DEADLINE_MS): () => void {
  if (!hasLayout()) return () => {};
  let frame = 0;
  let done = false;
  const started = performance.now();
  const stop = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    for (const type of INPUT_EVENTS) window.removeEventListener(type, stop);
  };
  const attempt = () => {
    if (done) return;
    if (canReach(y, document.documentElement.scrollHeight, window.innerHeight)) window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) <= 1) {
      stop();
      return;
    }
    if (performance.now() - started >= deadlineMs) {
      window.scrollTo(0, y);
      stop();
      return;
    }
    frame = requestAnimationFrame(attempt);
  };
  for (const type of INPUT_EVENTS) window.addEventListener(type, stop, { passive: true });
  attempt();
  return stop;
}

/** Events that mean the reader took over the scrolling. */
const INPUT_EVENTS = ["wheel", "touchstart", "keydown"] as const;

function sessionStorageOrNull(): globalThis.Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Follows the router: keeps the order of history entries for the buttons, records where each
 * entry is scrolled to, restores that position on Back and Forward, and opens a new page at the top.
 */
export function HistoryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [stack] = useState(createHistoryStack);
  const [memory] = useState(() => createScrollMemory(sessionStorageOrNull()));
  const [position, setPosition] = useState<HistoryPosition>({ canBack: false, canForward: false });

  // The browser would restore positions itself on popstate, before the note has loaded; this does it instead.
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Every scroll is recorded under the key of the entry on screen, read from this ref rather than
  // the effect's closure: the key switches in the layout effect below, before the browser lays the
  // new page out, so the scroll event the browser fires when a long page is replaced by a short
  // loading one lands on the new entry (where it is overwritten at once) and never on the one left.
  const currentKey = useRef(location.key);
  // A click on a `#heading` link scrolls before the router hears of the new entry; that scroll
  // belongs to the entry being made, not the one left, so it is dropped until the effect catches up.
  const currentHash = useRef(location.hash);
  useEffect(() => {
    const onScroll = () => {
      if (window.location.hash !== currentHash.current) return;
      memory.remember(currentKey.current, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", memory.persist);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", memory.persist);
      memory.persist();
    };
  }, [memory]);

  // Before the new page paints: place it. Back and Forward (POP) return to the remembered spot; a
  // link (PUSH) opens at the top unless it names a heading, which the browser scrolls to itself.
  // A REPLACE (the Tag page's filters) leaves the scroll alone.
  useLayoutEffect(() => {
    const index = browserIndex();
    const id = entryIdOf(location.key, location.hash, index);
    currentKey.current = id;
    currentHash.current = location.hash;
    memory.persist();
    setPosition(stack.visit(id, navigationType, { index }));
    if (navigationType === "POP") {
      const y = memory.recall(id);
      if (y !== undefined) return restoreScroll(y);
      // An entry made by a `#heading` link, reached again with Forward: the heading is the spot.
      if (location.hash !== "" && hasLayout()) document.getElementById(location.hash.slice(1))?.scrollIntoView();
      return;
    }
    if (navigationType === "PUSH" && location.hash === "" && hasLayout()) window.scrollTo(0, 0);
  }, [location.key, location.hash, navigationType, stack, memory]);

  return <HistoryContext.Provider value={position}>{children}</HistoryContext.Provider>;
}

/** Whether Back and Forward lead anywhere right now. */
export function useHistoryPosition(): HistoryPosition {
  return useContext(HistoryContext);
}

/** The Back and Forward buttons: ghost icon buttons, each disabled while it leads nowhere. */
export function HistoryNav({ className }: { className?: string }) {
  const { canBack, canForward } = useHistoryPosition();
  const navigate = useNavigate();
  return (
    <div role="group" aria-label="History" className={className}>
      <Button type="button" variant="ghost" size="icon" aria-label="Back" title="Back" disabled={!canBack} onClick={() => navigate(-1)}>
        <ArrowLeftIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Forward"
        title="Forward"
        disabled={!canForward}
        onClick={() => navigate(1)}
      >
        <ArrowRightIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
