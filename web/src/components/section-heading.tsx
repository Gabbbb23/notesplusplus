import type { HTMLAttributes, ReactNode } from "react";

type HeadingProps = Omit<HTMLAttributes<HTMLHeadingElement>, "className" | "style" | "children">;

/**
 * A section title inside a page, outside a SectionCard: the note's "Backlinks", and every h2
 * in a note body (note-body.tsx renders markdown h2 through this), so both look the same.
 * It sets no margins; the parent spaces it.
 */
export function SectionHeading({ children, ...rest }: HeadingProps & { children: ReactNode }) {
  return (
    <h2
      data-slot="section-heading"
      className="border-b pb-1 text-xl leading-[1.3] font-semibold text-foreground wrap-break-word"
      {...rest}
    >
      {children}
    </h2>
  );
}
