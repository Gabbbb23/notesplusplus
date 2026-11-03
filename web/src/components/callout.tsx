import type { ReactNode } from "react";

/** A paragraph set off from the text around it on a container tone: a note's one-line summary. */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <p
      data-slot="callout"
      className="rounded-large bg-surface-container px-5 py-4 text-body-large text-on-surface wrap-break-word"
    >
      {children}
    </p>
  );
}
