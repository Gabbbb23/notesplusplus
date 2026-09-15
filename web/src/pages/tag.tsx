import { useParams } from "react-router";
import { TagName } from "@/components/badges";
import { LoadingCards } from "@/components/item-card";
import { NoteList } from "@/components/note-card";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert } from "@/components/page-state";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useAsync } from "@/lib/use-async";

export function TagPage() {
  const { tag = "" } = useParams();
  const notes = useAsync(() => api.listNotes({ tag }), [tag]);
  const tags = useAsync(() => api.tags(), []);
  const description = tags.data?.find((t) => t.name === tag)?.description;

  return (
    <>
      <PageHeader
        title={<TagName name={tag} />}
        aside={notes.data && plural(notes.data.length, "note")}
        description={description || undefined}
      />
      {notes.loading && <LoadingCards count={3} />}
      {notes.error && <ErrorAlert error={notes.error} />}
      {notes.data && <NoteList notes={notes.data} empty="No notes carry this tag." />}
    </>
  );
}
