import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatusBadge } from "@/components/badges";
import { BreakableText } from "@/components/breakable-text";
import { MetaRow } from "@/components/meta";
import { TextLink } from "@/components/text-link";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * Every card in the app. This is the only module that imports the shadcn Card.
 * All cards share one shell: white surface, hairline border, 8px radius, 16px padding.
 */

const SHELL_CLASS = "min-w-0 gap-0 rounded-lg p-4 shadow-none wrap-break-word";

/**
 * A card title and where it points: an in-app route (to), a site opened in a new tab (href), or
 * nowhere, as plain text, when the card's details carry the actions (a file result's FileLink).
 */
export type ItemCardTitle =
  | { text: string; to: string; href?: never }
  | { text: string; href: string; to?: never }
  | { text: string; to?: never; href?: never };

function CardTitle({ title }: { title: ItemCardTitle }) {
  if (title.to !== undefined) {
    return (
      <TextLink to={title.to} variant="title">
        {title.text}
      </TextLink>
    );
  }
  if (title.href !== undefined) {
    return (
      <TextLink href={title.href} variant="title">
        {title.text}
      </TextLink>
    );
  }
  return <BreakableText className="text-base font-medium" text={title.text} />;
}

export interface ItemCardProps {
  /** The title: linked, or plain text. */
  title: ItemCardTitle;
  /** Shown after the title, usually a KindBadge. */
  badge?: ReactNode;
  /** One line of muted text under the title. */
  summary?: ReactNode;
  /** A search snippet or excerpt. */
  snippet?: ReactNode;
  /** The bottom row of small muted details: tags, dates, paths. */
  meta?: ReactNode;
  /**
   * Controls at the right end of the title row, outside the title link, such as NoteActionsMenu.
   * The title wraps beside them; they stay in the top right corner.
   */
  actions?: ReactNode;
}

/** One thing in a list: a note, a search result, a backlink. */
export function ItemCard({ title, badge, summary, snippet, meta, actions }: ItemCardProps) {
  return (
    <Card data-slot="item-card" className={cn(SHELL_CLASS, "gap-1.5 transition-colors hover:border-card-hover-border")}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <CardTitle title={title} />
          {badge}
        </div>
        {/* A 32px button on a 24px title line: the negative margins keep the card's height and tuck it into the corner. */}
        {actions && (
          <div data-slot="item-card-actions" className="-my-1 -mr-2 flex shrink-0 items-center gap-1">
            {actions}
          </div>
        )}
      </div>
      {summary && <div className="text-sm text-muted-foreground">{summary}</div>}
      {snippet && <div className="text-sm leading-relaxed">{snippet}</div>}
      {meta && <MetaRow>{meta}</MetaRow>}
    </Card>
  );
}

/** A vertical stack of cards with the standard gap. */
export function CardList({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}

/**
 * A titled block of content: a Check page section, the Inbox drop form.
 * count shows a badge after the title; zero reads as neutral, anything else as a problem.
 */
export function SectionCard({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count?: number;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card data-slot="section-card" className={cn(SHELL_CLASS, "gap-3")}>
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-base leading-snug font-semibold">
          {title}
          {count !== undefined && <StatusBadge tone={count === 0 ? "neutral" : "danger"}>{count}</StatusBadge>}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </Card>
  );
}

/** A number with a label, linking to the page that explains it. warn paints the number red. */
export function StatCard({
  label,
  value,
  to,
  warn = false,
}: {
  label: string;
  /** undefined while loading: shows a placeholder bar. */
  value: number | undefined;
  to: string;
  warn?: boolean;
}) {
  return (
    <Card data-slot="stat-card" className={cn(SHELL_CLASS, "transition-colors hover:border-card-hover-border")}>
      <Link to={to} className="block">
        {value === undefined ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <div className={cn("text-2xl font-semibold", warn && "text-destructive")}>{value}</div>
        )}
        <div className="text-xs tracking-wide text-muted-foreground uppercase">{label}</div>
      </Link>
    </Card>
  );
}

/** Card-shaped placeholders for a list while it loads. */
export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className={cn(SHELL_CLASS, "gap-2")}>
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-1/4" />
        </Card>
      ))}
    </div>
  );
}
