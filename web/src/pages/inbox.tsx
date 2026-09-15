import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/badges";
import { BreakableText } from "@/components/breakable-text";
import { DataTable, type Column } from "@/components/data-table";
import { SectionCard } from "@/components/item-card";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert, LoadingBlock } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { TOP_LEVEL_CRUMBS } from "@/lib/breadcrumb-items";
import { formatBytes, formatTime } from "@/lib/format";
import type { InboxItem } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

const columns: Column<InboxItem>[] = [
  { id: "name", header: "Name", size: "fill", primary: true, cell: (i) => <BreakableText text={i.name} /> },
  { id: "size", header: "Size", align: "end", cell: (i) => formatBytes(i.sizeBytes) },
  {
    id: "modified",
    header: "Modified",
    cell: (i) => <span className="text-muted-foreground">{formatTime(i.mtimeMs)}</span>,
  },
  {
    id: "kind",
    header: "Kind",
    cell: (i) => <StatusBadge tone={i.isText ? "success" : "neutral"}>{i.isText ? "text" : "binary"}</StatusBadge>,
  },
];

function DropForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (content.trim() === "") {
      setError(new Error("Content is empty."));
      return;
    }
    setBusy(true);
    setError(undefined);
    const finalName = name.trim() === "" ? `note-${Date.now()}.md` : name.trim();
    try {
      const item = await api.inboxAdd(finalName, content);
      toast.success(`Added ${item.name}`);
      setName("");
      setContent("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Drop text" description="Paste a transcript, notes, anything. Then ask the agent to file it.">
      <form onSubmit={submit} className="space-y-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional, e.g. meeting-notes.md)"
          aria-label="Name"
          className="bg-background"
        />
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Content"
          aria-label="Content"
          required
          className="min-h-48 bg-background font-mono text-[0.85rem]"
        />
        {error && <ErrorAlert error={error} title="Could not add" />}
        <Button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add to inbox"}
        </Button>
      </form>
    </SectionCard>
  );
}

export function InboxPage() {
  const items = useAsync(() => api.inbox(), []);
  return (
    <>
      <PageHeader title="Inbox" description="Material waiting for the agent." breadcrumbs={TOP_LEVEL_CRUMBS} />
      <div className="mb-8">
        {items.loading && <LoadingBlock lines={3} />}
        {items.error && <ErrorAlert error={items.error} />}
        {items.data && (
          <DataTable
            columns={columns}
            rows={items.data}
            rowKey={(i) => i.path}
            caption="Inbox items"
            empty="The inbox is empty."
          />
        )}
      </div>
      <DropForm onAdded={items.reload} />
    </>
  );
}
