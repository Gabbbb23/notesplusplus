import type { ReactNode } from "react";
import { KindBadge, TagBadges } from "@/components/badges";
import { CardList, ItemCard } from "@/components/item-card";
import { NoteActionsMenu } from "@/components/note-actions-menu";
import { EmptyState } from "@/components/page-state";
import { noteUrl } from "@/lib/api";
import type { NoteRef, NoteSummary } from "@/lib/types";

export type NoteCardProps =
  | {
      /** One note in a list: title, type, summary, tags, updated. */
      note: NoteSummary;
      compact?: false;
      /** Controls at the right of the title row, usually NoteActionsMenu. */
      actions?: ReactNode;
    }
  | {
      /** Compact: the title and type only, for a list the owner scans by name, such as Home's pins. */
      note: NoteRef;
      compact: true;
      actions?: ReactNode;
    };

export function NoteCard(props: NoteCardProps) {
  const { note, actions } = props;
  if (props.compact) {
    return (
      <ItemCard title={{ text: note.title, to: noteUrl(note.slug) }} badge={<KindBadge kind={note.type} />} actions={actions} />
    );
  }
  const full = props.note;
  return (
    <ItemCard
      title={{ text: full.title, to: noteUrl(full.slug) }}
      badge={<KindBadge kind={full.type} />}
      summary={full.summary || undefined}
      meta={
        <>
          <TagBadges tags={full.tags} />
          <span>updated {full.updated}</span>
        </>
      }
      actions={actions}
    />
  );
}

/** Notes as cards, each with its NoteActionsMenu: the Tag page and a note's Backlinks. */
export function NoteList({ notes, empty = "Nothing here yet." }: { notes: NoteSummary[]; empty?: string }) {
  if (notes.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <CardList>
      {notes.map((n) => (
        <NoteCard key={n.slug} note={n} actions={<NoteActionsMenu note={n} />} />
      ))}
    </CardList>
  );
}
