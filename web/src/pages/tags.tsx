import { TagIcon } from "lucide-react";
import { TagName } from "@/components/badges";
import { LinkRow, RowList } from "@/components/note-row";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorAlert, LoadingBlock } from "@/components/page-state";
import { api, tagUrl } from "@/lib/api";
import { TOP_LEVEL_CRUMBS } from "@/lib/breadcrumb-items";
import { useAsync } from "@/lib/use-async";

/** One request: GET /api/tags carries each tag's note count. Each tag is one list row that opens its page. */
export function TagsPage() {
  const { data, error, loading, reload } = useAsync(() => api.tags(), []);
  return (
    <>
      <PageHeader title="Tags" breadcrumbs={TOP_LEVEL_CRUMBS} />
      {loading && <LoadingBlock lines={6} />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {data && data.length === 0 && <EmptyState>No tags yet.</EmptyState>}
      {data && data.length > 0 && (
        <RowList label="Tags">
          {data.map((t) => (
            <LinkRow
              key={t.name}
              to={tagUrl(t.name)}
              headline={<TagName name={t.name} />}
              leading={<TagIcon className="size-6 shrink-0 text-on-surface-variant" aria-hidden="true" />}
              supporting={t.description || undefined}
              trailing={`${t.count} ${t.count === 1 ? "note" : "notes"}`}
            />
          ))}
        </RowList>
      )}
    </>
  );
}
