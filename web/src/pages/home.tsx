import { TagBadges } from "@/components/badges";
import { StatCard } from "@/components/item-card";
import { MetaRow } from "@/components/meta";
import { NoteBody } from "@/components/note-body";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert, LoadingBlock } from "@/components/page-state";
import { TextLink } from "@/components/text-link";
import { api, ApiError, noteUrl, type Stats } from "@/lib/api";
import { useAsync, type AsyncState } from "@/lib/use-async";

/** Hidden when the stats fail to load; the hub's error notice below offers Try again for both. */
function StatsStrip({ stats }: { stats: AsyncState<Stats> }) {
  const { data, error, loading } = stats;
  if (error) return null;
  const value = (n: number | undefined) => (loading ? undefined : n);
  return (
    <div className="mb-8 grid grid-cols-3 gap-3" aria-label="Stats">
      <StatCard label="notes" value={value(data?.notes)} to="/tags" />
      <StatCard label="files" value={value(data?.files)} to="/files" />
      <StatCard label="invalid" value={value(data?.invalid)} to="/check" warn={(data?.invalid ?? 0) > 0} />
    </div>
  );
}

/**
 * The header comes first, as on every other page, and shows even when the hub fails to load:
 * the root hub's title and summary once loaded, "Home" until then or without one.
 */
export function HomePage() {
  const hub = useAsync(() => api.getNote("index"), []);
  const stats = useAsync(() => api.stats(), []);
  const missing = hub.error instanceof ApiError && hub.error.status === 404;
  const retry = () => {
    hub.reload();
    if (stats.error) stats.reload();
  };

  return (
    <>
      <PageHeader title={hub.data?.title ?? "Home"} tabTitle="" description={hub.data?.summary || undefined}>
        {hub.data && (
          <MetaRow>
            <TagBadges tags={hub.data.tags} />
            <span>updated {hub.data.updated}</span>
            <TextLink to={noteUrl(hub.data.slug)}>open as note</TextLink>
          </MetaRow>
        )}
      </PageHeader>
      <StatsStrip stats={stats} />
      {hub.loading && <LoadingBlock lines={8} />}
      {missing && (
        <Notice tone="info" title="No root hub yet">
          The brain has no <code className="font-mono">notes/index.md</code>. Run{" "}
          <code className="font-mono">npm run init-brain</code> to create the brain layout, or ask the agent to write
          the index hub.
        </Notice>
      )}
      {hub.error && !missing && <ErrorAlert error={hub.error} onRetry={retry} />}
      {hub.data && (
        <article>
          <NoteBody markdown={hub.data.body} mentions={hub.data.mentions} />
        </article>
      )}
    </>
  );
}
