import { FileTextIcon, NetworkIcon, ScrollTextIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { BreakableText } from "@/components/breakable-text";
import { Ripple } from "@/components/ui/ripple";
import { noteUrl } from "@/lib/api";
import type { NoteRef, NoteType } from "@/lib/types";

/** The type icon a note, hub, or source shows in lists and the navigation drawer. */
export const NOTE_TYPE_ICON: Record<NoteType, LucideIcon> = {
  note: FileTextIcon,
  hub: NetworkIcon,
  source: ScrollTextIcon,
};

export interface LinkRowProps {
  /** The app route the row opens. */
  to: string;
  /** The row's headline and the link's name. A string wraps through BreakableText. */
  headline: ReactNode;
  /** A leading 24px icon or avatar. */
  leading?: ReactNode;
  /** A second line under the headline, such as a summary. Cut at two lines. */
  supporting?: ReactNode;
  /** Short text at the right end, such as a date or a count. */
  trailing?: ReactNode;
  /** Controls at the right end, such as NoteActionsMenu. They sit above the row's link, so clicking one never opens the row. */
  actions?: ReactNode;
}

/**
 * One M3 list item that opens a page: the whole row is the target (its link stretches over it) and shows the
 * state layer, the focus indicator goes around the row, and the actions stay their own targets. Put rows in a
 * `RowList`.
 */
export function LinkRow({ to, headline, leading, supporting, trailing, actions }: LinkRowProps) {
  return (
    <li data-slot="link-row" className="relative flex min-h-14 items-center gap-4 rounded-large py-2 pr-2 pl-4">
      {leading}
      <div className="min-w-0 flex-1">
        <Link
          to={to}
          className="block text-body-large text-on-surface outline-none after:absolute after:inset-0 after:rounded-large focus-visible:after:outline-3 focus-visible:after:-outline-offset-3 focus-visible:after:outline-solid focus-visible:after:outline-secondary"
        >
          {typeof headline === "string" ? <BreakableText text={headline} /> : headline}
        </Link>
        {supporting && <div className="line-clamp-2 text-body-medium text-on-surface-variant">{supporting}</div>}
      </div>
      {trailing !== undefined && <div className="shrink-0 pr-2 text-label-small text-on-surface-variant">{trailing}</div>}
      {actions && <div className="relative z-10 shrink-0">{actions}</div>}
      <Ripple />
    </li>
  );
}

export interface NoteRowProps extends Omit<LinkRowProps, "to" | "headline" | "leading"> {
  note: NoteRef;
}

/** One note as an M3 list item: its type icon, its title, and whatever the caller adds. */
export function NoteRow({ note, ...rest }: NoteRowProps) {
  const Icon = NOTE_TYPE_ICON[note.type];
  return (
    <LinkRow
      to={noteUrl(note.slug)}
      headline={note.title}
      // The icon is the row's only sign of the type, so it is named for screen readers, outside the link's name.
      leading={<Icon className="size-6 shrink-0 text-on-surface-variant" role="img" aria-label={note.type} />}
      {...rest}
    />
  );
}

/** A list of LinkRows or NoteRows. `label` names the list for assistive tech when no heading does. */
export function RowList({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul data-slot="row-list" aria-label={label} className={["flex flex-col", className].filter(Boolean).join(" ")}>
      {children}
    </ul>
  );
}
