import { useParams } from "react-router";
import { TagName } from "@/components/badges";
import { LoadingCards } from "@/components/item-card";
import { NoteList } from "@/components/note-card";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert } from "@/components/page-state";
import { ShowMore, useFocusFirstNew } from "@/components/show-more";
import { api } from "@/lib/api";
import { TAG_PAGE_CRUMBS } from "@/lib/breadcrumb-items";
import { plural } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { usePagedList } from "@/lib/use-paged-list";

/** Notes per "Show more notes". */
const TAG_PAGE_SIZE = 50;

export function TagPage() {
  const { tag = "" } = useParams();
  const notes = usePagedList((offset) => api.listNotes({ tag, limit: TAG_PAGE_SIZE, offset }), [tag]);
  const tags = useAsync(() => api.tags(), []);
  const description = tags.data?.find((t) => t.name === tag)?.description;
  const { listRef, expectMore } = useFocusFirstNew(notes.items?.length ?? 0, tag);

  return (
    <>
      <PageHeader
        title={<TagName name={tag} />}
        breadcrumbs={TAG_PAGE_CRUMBS}
        aside={notes.total !== undefined && plural(notes.total, "note")}
        description={description || undefined}
      />
      {notes.items === undefined && notes.loading && <LoadingCards count={3} />}
      {notes.items && (
        <div ref={listRef}>
          <NoteList notes={notes.items} empty="No notes carry this tag." />
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
          <ErrorAlert error={notes.error} />
        </div>
      )}
    </>
  );
}
