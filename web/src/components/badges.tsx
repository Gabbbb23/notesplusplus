import type { ReactNode } from "react";
import { Link } from "react-router";
import { BreakableText } from "@/components/breakable-text";
import { Badge } from "@/components/ui/badge";
import { tagUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/*
 * Every badge in the app. This is the only module that imports the shadcn Badge.
 * Colours come from the --kind-* and --status-* tokens in index.css.
 */

/** Shared look for label badges (kind, file type, status): small, uppercase, same letter-spacing. */
const LABEL = "uppercase tracking-wide";

export type Kind = "note" | "hub" | "source" | "file";

const KIND_CLASS: Record<Kind, string> = {
  note: "bg-kind-note-bg text-kind-note-fg",
  hub: "bg-kind-hub-bg text-kind-hub-fg",
  source: "bg-kind-source-bg text-kind-source-fg",
  file: "bg-kind-file-bg text-kind-file-fg",
};

/** Coloured pill naming what a thing is: note, hub, source, or file. */
export function KindBadge({ kind }: { kind: Kind }) {
  return (
    <Badge variant="secondary" data-kind={kind} className={cn(LABEL, KIND_CLASS[kind])}>
      {kind}
    </Badge>
  );
}

export type StatusTone = "neutral" | "success" | "warning" | "danger";

const STATUS_CLASS: Record<StatusTone, string> = {
  neutral: "bg-status-neutral-bg text-status-neutral-fg",
  success: "bg-status-success-bg text-status-success-fg",
  warning: "bg-status-warning-bg text-status-warning-fg",
  danger: "bg-status-danger-bg text-status-danger-fg",
};

/** A short state or count: inbox text/binary, problem counts on the Check page. */
export function StatusBadge({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <Badge variant="secondary" data-tone={tone} className={cn(LABEL, STATUS_CLASS[tone])}>
      {children}
    </Badge>
  );
}

/** A file's extension, e.g. PDF. Shows "?" for a file without one. */
export function FileTypeBadge({ ext }: { ext: string }) {
  return (
    <Badge variant="secondary" className={cn(LABEL, STATUS_CLASS.neutral)}>
      {ext || "?"}
    </Badge>
  );
}

/**
 * A tag name as text: a muted "#" and the name, wrapping at natural break points.
 * Used on its own in the Tags table and the Tag page heading, and inside TagBadge.
 */
export function TagName({ name }: { name: string }) {
  return (
    <span data-slot="tag-name" className="min-w-0 wrap-anywhere">
      <span className="text-muted-foreground">#</span>
      <BreakableText text={name} />
    </span>
  );
}

/**
 * The shadcn Badge is nowrap and never shrinks. A tag can be a long hyphenated name, so its
 * pill may shrink to the width of its container and wrap onto more lines. rounded-xl is a full
 * pill on one line and a rounded box on two.
 */
const TAG_BADGE_CLASS = "max-w-full min-w-0 shrink rounded-xl text-left font-normal whitespace-normal";

/** One tag as a pill, "#name", linking to /tags/:tag. */
export function TagBadge({ name }: { name: string }) {
  return (
    // The classes go on Badge, not the Link: Badge merges them over its own with tailwind-merge.
    <Badge variant="outline" asChild className={TAG_BADGE_CLASS}>
      <Link to={tagUrl(name)} data-slot="tag-badge">
        {/* One flex child, so the badge's gap never separates "#" from the name. */}
        <TagName name={name} />
      </Link>
    </Badge>
  );
}

/** A row of tag pills. Renders nothing for an empty list. */
export function TagBadges({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span data-slot="tag-badges" className="inline-flex max-w-full min-w-0 flex-wrap gap-1.5">
      {tags.map((t) => (
        <TagBadge key={t} name={t} />
      ))}
    </span>
  );
}
