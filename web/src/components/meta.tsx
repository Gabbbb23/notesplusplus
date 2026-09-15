import type { ReactNode } from "react";

/*
 * Small muted details about a thing: tags, dates, paths, sources. Two shapes, one module:
 * MetaList is a label and value grid (a note's header), MetaRow is one wrapping line (a card,
 * the Home hub). Both wrap long values instead of widening the page.
 */

/** A grid of labelled details. Children are MetaItem. */
export function MetaList({ children }: { children: ReactNode }) {
  return (
    <dl data-slot="meta-list" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm text-muted-foreground">
      {children}
    </dl>
  );
}

/** One label and its value in a MetaList. Several values (links, badges) wrap onto more lines. */
export function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 wrap-break-word">{children}</dd>
    </>
  );
}

/** One wrapping line of small muted details, such as tags and an updated date. */
export function MetaRow({ children }: { children: ReactNode }) {
  return (
    <div data-slot="meta-row" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground wrap-break-word">
      {children}
    </div>
  );
}
