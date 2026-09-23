import { useParams } from "react-router";
import { TagName } from "@/components/badges";
import { LoadingCards } from "@/components/item-card";
import { NoteList } from "@/components/note-card";
import { NoteListControls } from "@/components/note-list-controls";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert } from "@/components/page-state";
import { ShowMore, useFocusFirstNew } from "@/components/show-more";
import { api } from "@/lib/api";
import { TAG_PAGE_CRUMBS } from "@/lib/breadcrumb-items";
import { plural } from "@/lib/format";
import { useNoteListFilters } from "@/lib/note-list-filters";
import type { NoteType } from "@/lib/types";
import { useAsync } from "@/lib/use-async";
import { usePagedList } from "@/lib/use-paged-list";
import { ViewSwitch, type NoteView } from "@/components/view-switch";
import { useState } from "react";

/** Notes per "Show more notes". */
const TAG_PAGE_SIZE = 50;

/** Sources carry no tags, so a tag lists notes and hubs only. */
const TAG_PAGE_TYPES: readonly NoteType[] = ["note", "hub"];

export function TagPage() {
  const { tag = "" } = useParams();
  const filters = useNoteListFilters(TAG_PAGE_TYPES);
  const { q, sort, type } = filters;
  const [view, setView] = useState<NoteView>("list");
  const notes = usePagedList(
    (offset) =>
      api.listNotes({
        tag,
        type,
        q: q || undefined,
        sort: sort === "title" ? undefined : sort,
        limit: TAG_PAGE_SIZE,
        offset,
      }),
    [tag, type, q, sort],
    tag,
  );
  const tags = useAsync(() => api.tags(), []);
  const tagInfo = tags.data?.find((t) => t.name === tag);
  const { listRef, expectMore } = useFocusFirstNew(notes.items?.length ?? 0, JSON.stringify([tag, type, q, sort]));

  // "12 of 93 notes" while a filter narrows the list, once the tag's own count is known.
  const count =
    notes.total === undefined
      ? undefined
      : filters.filtered && tagInfo
        ? `${notes.total} of ${plural(tagInfo.count, "note")}`
        : plural(notes.total, "note");

  return (
    <>
      <PageHeader
        title={<TagName name={tag} />}
        tabTitle={`#${tag}`}
        breadcrumbs={TAG_PAGE_CRUMBS}
        aside={count}
        description={tagInfo?.description || undefined}
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><NoteListControls filters={filters} types={TAG_PAGE_TYPES} /><ViewSwitch value={view} onChange={setView} /></div>
      {notes.items === undefined && notes.loading && <LoadingCards count={3} />}
      {notes.items && (
        <div ref={listRef} aria-busy={notes.stale || undefined} className={notes.stale ? "opacity-60" : undefined}>
          <NoteList
            notes={notes.items}
            view={view}
            empty={filters.filtered ? "No notes match these filters." : "No notes carry this tag."}
          />
        </div>
      )}
      {notes.items && notes.hasMore && (
        <ShowMore
          label="Show more notes"
          loading={notes.loading}
          progress={`Showing ${notes.items.length} of ${notes.total}`}
          onClick={() => {
            expectMore();
            notes.more();
          }}
        />
      )}
      {notes.error && (
        <div className={notes.items ? "mt-4" : undefined}>
          <ErrorAlert error={notes.error} onRetry={notes.retry} />
        </div>
      )}
    </>
  );
}
