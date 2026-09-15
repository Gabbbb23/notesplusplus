import { TagName } from "@/components/badges";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert, LoadingBlock } from "@/components/page-state";
import { TextLink } from "@/components/text-link";
import { api, tagUrl } from "@/lib/api";
import type { Tag } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

interface TagRow extends Tag {
  count: number;
}

async function loadTags(): Promise<TagRow[]> {
  const tags = await api.tags();
  return Promise.all(
    tags.map(async (t) => {
      const notes = await api.listNotes({ tag: t.name });
      return { ...t, count: notes.length };
    }),
  );
}

const columns: Column<TagRow>[] = [
  {
    id: "tag",
    header: "Tag",
    size: "fill",
    primary: true,
    cell: (t) => (
      <TextLink to={tagUrl(t.name)} variant="strong">
        <TagName name={t.name} />
      </TextLink>
    ),
  },
  {
    id: "description",
    header: "Description",
    size: "fill",
    cell: (t) => <span className="text-muted-foreground">{t.description}</span>,
  },
  { id: "count", header: "Notes", align: "end", cell: (t) => t.count },
];

export function TagsPage() {
  const { data, error, loading } = useAsync(loadTags, []);
  return (
    <>
      <PageHeader title="Tags" />
      {loading && <LoadingBlock lines={6} />}
      {error && <ErrorAlert error={error} />}
      {data && <DataTable columns={columns} rows={data} rowKey={(t) => t.name} caption="Tags" empty="No tags yet." />}
    </>
  );
}
