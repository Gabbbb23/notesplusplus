import type { HTMLAttributes, ReactNode } from "react";

type HeadingProps = Omit<HTMLAttributes<HTMLHeadingElement>, "className" | "style" | "children">;

const TITLE_CLASS = "text-title-large text-on-surface wrap-break-word";
const RULE_CLASS = "border-b border-outline-variant pb-1";

/**
 * A section title inside a page, outside a SectionCard: the note's "Backlinks", and every h2
 * in a note body (note-body.tsx renders markdown h2 through this), so both look the same.
 * It sets no margins; the parent spaces it.
 *
 * `action` puts a small control at the right end of the title's line, above the same rule, such as
 * Home's "Open index". It stays out of the heading, so the heading's name is the title alone.
 */
export function SectionHeading({ children, action, ...rest }: HeadingProps & { children: ReactNode; action?: ReactNode }) {
  if (!action) {
    return (
      <h2 data-slot="section-heading" className={`${RULE_CLASS} ${TITLE_CLASS}`} {...rest}>
        {children}
      </h2>
    );
  }
  return (
    // A 32px button with -4px above and below fits the 28px title line, so the rule sits where it does without one.
    <div className={`flex items-center justify-between gap-4 ${RULE_CLASS}`}>
      <h2 data-slot="section-heading" className={`min-w-0 ${TITLE_CLASS}`} {...rest}>
        {children}
      </h2>
      <div className="-my-1 shrink-0">{action}</div>
    </div>
  );
}
