import { FileTypeBadge } from "@/components/badges";
import { BreakableText } from "@/components/breakable-text";
import { DataTable, type Column } from "@/components/data-table";
import { FileActions } from "@/components/file-actions";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert, LoadingBlock } from "@/components/page-state";
import { api } from "@/lib/api";
import { TOP_LEVEL_CRUMBS } from "@/lib/breadcrumb-items";
import { formatBytes, formatTime, plural } from "@/lib/format";
import type { FileEntry } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

const columns: Column<FileEntry>[] = [
  { id: "path", header: "Path", size: "fill", primary: true, cell: (f) => <BreakableText text={f.path} /> },
  { id: "type", header: "Type", cell: (f) => <FileTypeBadge ext={f.ext} /> },
  { id: "size", header: "Size", align: "end", cell: (f) => formatBytes(f.sizeBytes) },
  {
    id: "modified",
    header: "Modified",
    cell: (f) => <span className="text-muted-foreground">{formatTime(f.mtimeMs)}</span>,
  },
  {
    id: "actions",
    header: "Actions",
    hideHeader: true,
    // End-aligned so Open and Show in folder line up in every row, with or without View.
    align: "end",
    cell: (f) => <FileActions path={f.path} size="compact" />,
  },
];

export function FilesPage() {
  const { data, error, loading, reload } = useAsync(() => api.files(), []);
  return (
    <>
      <PageHeader title="Files" aside={data && plural(data.length, "file")} breadcrumbs={TOP_LEVEL_CRUMBS} />
      {loading && <LoadingBlock lines={6} />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {data && (
        <DataTable columns={columns} rows={data} rowKey={(f) => f.path} caption="Files" empty="No files yet." />
      )}
    </>
  );
}
