import type { ReactNode } from "react";
import { Link } from "react-router";
import { BreakableText } from "@/components/breakable-text";
import { Badge } from "@/components/ui/badge";
import { Ripple } from "@/components/ui/ripple";
import { noteUrl, tagUrl } from "@/lib/api";
import type { NoteRef } from "@/lib/types";

/*
 * Every badge in the app. This is the only module that imports the shadcn Badge, which draws the
 * shape (a 24px label pill, 8px corners). Colours come from the kind-* and status-* tokens in index.css.
 */

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
    <Badge variant="secondary" data-kind={kind} className={KIND_CLASS[kind]}>
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
    <Badge variant="secondary" data-tone={tone} className={STATUS_CLASS[tone]}>
      {children}
    </Badge>
  );
}

/** A file's extension, e.g. pdf. Shows "?" for a file without one. */
export function FileTypeBadge({ ext }: { ext: string }) {
  return (
    <Badge variant="secondary" className={STATUS_CLASS.neutral}>
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
      <span className="text-on-surface-variant">#</span>
      <BreakableText text={name} />
    </span>
  );
}

/**
 * The outline Badge grown into an M3 assist chip: 32px tall, 16px side padding, label large. The Badge
 * is nowrap and never shrinks, but a tag can be a long hyphenated name, so this chip may shrink to the
 * width of its container and wrap onto more lines, growing taller from its 32px.
 */
const TAG_BADGE_CLASS = "min-h-8 max-w-full min-w-0 shrink px-4 py-1.5 text-left text-label-large whitespace-normal";

/** One tag as an assist chip, "#name", linking to /tags/:tag. */
export function TagBadge({ name }: { name: string }) {
  return (
    // The classes go on Badge, not the Link: Badge merges them over its own with tailwind-merge.
    <Badge variant="outline" asChild className={TAG_BADGE_CLASS}>
      <Link to={tagUrl(name)} data-slot="tag-badge">
        {/* One flex child (the ripple is absolute), so the badge's gap never separates "#" from the name. */}
        <TagName name={name} />
        <Ripple />
      </Link>
    </Badge>
  );
}

/** A note as the same assist chip, its title linking to the note: a domain card's sub-hubs. */
export function NoteChip({ note }: { note: NoteRef }) {
  return (
    <Badge variant="outline" asChild className={TAG_BADGE_CLASS}>
      <Link to={noteUrl(note.slug)} data-slot="note-chip">
        <BreakableText text={note.title} />
        <Ripple />
      </Link>
    </Badge>
  );
}

/** A row of tag chips. Renders nothing for an empty list. */
export function TagBadges({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span data-slot="tag-badges" className="inline-flex max-w-full min-w-0 flex-wrap gap-2">
      {tags.map((t) => (
        <TagBadge key={t} name={t} />
      ))}
    </span>
  );
}
