import { FileTypeBadge } from "@/components/badges";
import { BreakableText } from "@/components/breakable-text";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert, LoadingBlock } from "@/components/page-state";
import { TextLink } from "@/components/text-link";
import { api, fileUrl } from "@/lib/api";
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
    id: "open",
    header: "Open",
    hideHeader: true,
    cell: (f) => <TextLink href={fileUrl(f.path)}>Open</TextLink>,
  },
];

export function FilesPage() {
  const { data, error, loading } = useAsync(() => api.files(), []);
  return (
    <>
      <PageHeader title="Files" aside={data && plural(data.length, "file")} />
      {loading && <LoadingBlock lines={6} />}
      {error && <ErrorAlert error={error} />}
      {data && (
        <DataTable columns={columns} rows={data} rowKey={(f) => f.path} caption="Files" empty="No files yet." />
      )}
    </>
  );
}
