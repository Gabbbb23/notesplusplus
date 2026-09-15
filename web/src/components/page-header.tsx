import type { ReactNode } from "react";
import { BreakableText } from "@/components/breakable-text";
import { Breadcrumbs } from "@/components/breadcrumbs";
import type { Crumb } from "@/lib/breadcrumb-items";
import { usePageTitle } from "@/lib/page-title";

/**
 * The top of every page: optional breadcrumbs, then one h1 size everywhere, an optional badge
 * after the title, an optional aside on the right (a count), optional actions at the right end of
 * the title row (a note's menu), a muted description, and optional extra rows (note metadata).
 * A string title wraps at natural break points.
 *
 * It also sets the browser tab title, "<tabTitle> · notes++", for as long as it is on screen.
 */
export function PageHeader({
  title,
  tabTitle,
  description,
  aside,
  badge,
  actions,
  breadcrumbs,
  children,
}: {
  title: ReactNode;
  /**
   * The tab title before " · notes++". Defaults to `title` when that is a string. Pass it when the
   * title is not plain text (a tag) or the tab should say more (a search query); pass "" for the app
   * name alone, as Home does.
   */
  tabTitle?: string;
  description?: ReactNode;
  aside?: ReactNode;
  badge?: ReactNode;
  /**
   * Controls at the right end of the title row, such as NoteActionsMenu. They stay beside the first
   * line of the title while a long title wraps.
   */
  actions?: ReactNode;
  /** Where the page sits, shown above the title. Never includes the page itself. Home passes none. */
  breadcrumbs?: readonly Crumb<ReactNode>[];
  /** Extra header content under the description, such as a note's tags and dates. */
  children?: ReactNode;
}) {
  usePageTitle(tabTitle ?? (typeof title === "string" ? title : undefined));
  return (
    <header data-slot="page-header" className="mb-6 min-w-0 space-y-2 wrap-break-word">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex items-start gap-x-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight">
              {typeof title === "string" ? <BreakableText text={title} /> : title}
            </h1>
            {badge}
          </div>
          {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
        </div>
        {actions && (
          <div data-slot="page-header-actions" className="flex shrink-0 items-center gap-1">
            {actions}
          </div>
        )}
      </div>
      {description && <div className="text-muted-foreground">{description}</div>}
      {children}
    </header>
  );
}
