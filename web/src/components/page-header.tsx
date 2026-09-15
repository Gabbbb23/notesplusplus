import type { ReactNode } from "react";
import { BreakableText } from "@/components/breakable-text";

/**
 * The top of every page: one h1 size everywhere, an optional badge after the title,
 * an optional aside on the right (a count), a muted description, and optional extra
 * rows (note metadata). A string title wraps at natural break points.
 */
export function PageHeader({
  title,
  description,
  aside,
  badge,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  badge?: ReactNode;
  /** Extra header content under the description, such as a note's tags and dates. */
  children?: ReactNode;
}) {
  return (
    <header data-slot="page-header" className="mb-6 min-w-0 space-y-2 wrap-break-word">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight">
            {typeof title === "string" ? <BreakableText text={title} /> : title}
          </h1>
          {badge}
        </div>
        {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
      </div>
      {description && <div className="text-muted-foreground">{description}</div>}
      {children}
    </header>
  );
}
