import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";

/*
 * Counts the parts of a page that are still drawing, so a page can tell when it is complete. The
 * print page (pages/print-note.tsx) mounts a RenderTrackerProvider and waits for the count to reach
 * zero before it marks itself ready to print. Diagram registers while mermaid draws, and a printed
 * image while it loads. Outside a provider they register nothing.
 */

export interface RenderTracker {
  /** Count one more part as drawing. Returns the function that marks it done; calling that twice counts once. */
  begin(): () => void;
  /** How many parts are drawing now. */
  pending(): number;
  subscribe(listener: () => void): () => void;
}

export function createRenderTracker(): RenderTracker {
  let count = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    begin() {
      count++;
      emit();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        count--;
        emit();
      };
    },
    pending: () => count,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const RenderTrackerContext = createContext<RenderTracker | null>(null);

export function RenderTrackerProvider({ tracker, children }: { tracker: RenderTracker; children: ReactNode }) {
  return <RenderTrackerContext.Provider value={tracker}>{children}</RenderTrackerContext.Provider>;
}

/**
 * Counts the calling component as drawing while `drawing` is true. It registers in a layout effect,
 * so a part that mounts drawing is counted before any parent's effect reads the count.
 */
export function useRenderPending(drawing: boolean): void {
  const tracker = useContext(RenderTrackerContext);
  useLayoutEffect(() => {
    if (!tracker || !drawing) return;
    return tracker.begin();
  }, [tracker, drawing]);
}
