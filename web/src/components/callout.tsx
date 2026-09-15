import type { ReactNode } from "react";

/** A highlighted paragraph set off from the text around it: a note's one-line summary. */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <p
      data-slot="callout"
      className="rounded-lg border-l-4 border-primary/60 bg-accent/60 px-4 py-3 text-[0.95rem] text-foreground/90 wrap-break-word"
    >
      {children}
    </p>
  );
}
