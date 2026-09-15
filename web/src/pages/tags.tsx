import { TagName } from "@/components/badges";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert, LoadingBlock } from "@/components/page-state";
import { TextLink } from "@/components/text-link";
import { api, tagUrl } from "@/lib/api";
import { TOP_LEVEL_CRUMBS } from "@/lib/breadcrumb-items";
import type { TagWithCount } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

const columns: Column<TagWithCount>[] = [
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

/** One request: GET /api/tags carries each tag's note count. */
export function TagsPage() {
  const { data, error, loading } = useAsync(() => api.tags(), []);
  return (
    <>
      <PageHeader title="Tags" breadcrumbs={TOP_LEVEL_CRUMBS} />
      {loading && <LoadingBlock lines={6} />}
      {error && <ErrorAlert error={error} />}
      {data && <DataTable columns={columns} rows={data} rowKey={(t) => t.name} caption="Tags" empty="No tags yet." />}
    </>
  );
}
