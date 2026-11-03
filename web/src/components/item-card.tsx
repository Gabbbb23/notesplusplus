import type { ReactNode } from "react";
import { StatusBadge } from "@/components/badges";
import { BreakableText } from "@/components/breakable-text";
import { MetaRow } from "@/components/meta";
import { TextLink } from "@/components/text-link";
import { Card } from "@/components/ui/card";
import { Ripple } from "@/components/ui/ripple";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * Every card in the app built on the shadcn Card, which is the M3 outlined card. This is the only
 * module that imports it. Home's domain cards are filled cards with no outline (domains.tsx).
 */

const SHELL_CLASS = "min-w-0 wrap-break-word";

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
      <TextLink to={title.to} variant="card">
        {title.text}
      </TextLink>
    );
  }
  if (title.href !== undefined) {
    return (
      <TextLink href={title.href} variant="card">
        {title.text}
      </TextLink>
    );
  }
  return <BreakableText className="text-title-medium" text={title.text} />;
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

/*
 * A linked card is one target: its title link stretches over the card, and every other link or button
 * inside (the menu, tag chips, file buttons) sits above it, so each still works on its own.
 */
const LINKED_CARD_CLASS =
  "relative [&_a:not([data-card-link])]:relative [&_a:not([data-card-link])]:z-10 [&_button]:relative [&_button]:z-10";

/** One thing in a list: a note, a search result, a backlink. A linked title makes the whole card open it. */
export function ItemCard({ title, badge, summary, snippet, meta, actions }: ItemCardProps) {
  const linked = title.to !== undefined || title.href !== undefined;
  return (
    <Card data-slot="item-card" className={cn(SHELL_CLASS, "gap-2", linked && LINKED_CARD_CLASS)}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <CardTitle title={title} />
          {badge}
        </div>
        {/*
         * A 40px icon button on a 24px title line: the negative margins keep the card's height, and the
         * right one lines the icon up with the card's 16px padding.
         */}
        {actions && (
          <div data-slot="item-card-actions" className="-my-2 -mr-2 flex shrink-0 items-center gap-1">
            {actions}
          </div>
        )}
      </div>
      {summary && <div className="text-body-medium text-on-surface-variant">{summary}</div>}
      {snippet && <div className="text-body-medium">{snippet}</div>}
      {meta && <MetaRow>{meta}</MetaRow>}
      {linked && <Ripple />}
    </Card>
  );
}

/** A vertical stack of cards with the standard gap. */
export function CardList({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>;
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
    <Card data-slot="section-card" className={cn(SHELL_CLASS, "gap-4")}>
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-title-medium">
          {title}
          {count !== undefined && <StatusBadge tone={count === 0 ? "neutral" : "danger"}>{count}</StatusBadge>}
        </h2>
        {description && <p className="text-body-medium text-on-surface-variant">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </Card>
  );
}

/** Outlined card shapes with placeholder bars for a list while it loads. */
export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className={cn(SHELL_CLASS, "gap-2")}>
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-1/4" />
        </Card>
      ))}
    </div>
  );
}
