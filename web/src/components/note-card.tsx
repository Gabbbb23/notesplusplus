import { KindBadge, TagBadges } from "@/components/badges";
import { CardList, ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/page-state";
import { noteUrl } from "@/lib/api";
import type { NoteSummary } from "@/lib/types";

/** One note in a list: title, type, summary, tags, updated. */
export function NoteCard({ note }: { note: NoteSummary }) {
  return (
    <ItemCard
      title={{ text: note.title, to: noteUrl(note.slug) }}
      badge={<KindBadge kind={note.type} />}
      summary={note.summary || undefined}
      meta={
        <>
          <TagBadges tags={note.tags} />
          <span>updated {note.updated}</span>
        </>
      }
    />
  );
}

export function NoteList({ notes, empty = "Nothing here yet." }: { notes: NoteSummary[]; empty?: string }) {
  if (notes.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <CardList>
      {notes.map((n) => (
        <NoteCard key={n.slug} note={n} />
      ))}
    </CardList>
  );
}
