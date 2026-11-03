import { BookmarkIcon, FileTextIcon, FileWarningIcon, FolderIcon, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { TagName } from "@/components/badges";
import { bookmarkGroupId } from "@/components/bookmarks";
import { DomainCard, ROOT_HUB, useDomains, type Domains } from "@/components/domains";
import { NoteActionsMenu, usePinnedListFocus } from "@/components/note-actions-menu";
import { LinkRow, NoteRow, RowList } from "@/components/note-row";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorAlert, LoadingBlock } from "@/components/page-state";
import { usePins } from "@/components/pins";
import { RecentNotes } from "@/components/recent-notes";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { api, noteUrl, type Stats } from "@/lib/api";
import { useAsync } from "@/lib/use-async";

/** A list row's 24px leading icon. */
function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="size-6 shrink-0 text-on-surface-variant" aria-hidden="true" />;
}

/**
 * The domains the root hub lists, as cards in its order, and a way to the root hub itself. The
 * "No root hub yet" notice or the error stands in for the cards.
 */
function DomainsSection({ domains, onRetry }: { domains: Domains; onRetry: () => void }) {
  const { status, error } = domains;
  return (
    <section aria-labelledby="domains-heading" className="space-y-4">
      <SectionHeading
        id="domains-heading"
        action={
          status === "ready" && (
            <Button variant="text" size="small" asChild>
              <Link to={noteUrl(ROOT_HUB)}>Open index</Link>
            </Button>
          )
        }
      >
        Domains
      </SectionHeading>
      {status === "loading" && <LoadingBlock lines={4} />}
      {status === "missing" && (
        <Notice tone="info" title="No root hub yet">
          The brain has no <code className="font-mono">notes/index.md</code>. Run{" "}
          <code className="font-mono">npm run init-brain</code> to create the brain layout, or ask the agent to write
          the index hub.
        </Notice>
      )}
      {status === "error" && error && <ErrorAlert error={error} onRetry={onRetry} />}
      {status === "ready" &&
        (domains.domains.length === 0 ? (
          <EmptyState>No domains yet.</EmptyState>
        ) : (
          <ul className="grid gap-4 @min-[36rem]:grid-cols-2">
            {domains.domains.map((domain) => (
              <DomainCard key={domain.slug} domain={domain} />
            ))}
          </ul>
        ))}
    </section>
  );
}

/**
 * The notes pinned to Home as list rows in pin order, each under its title naming the domain it
 * belongs to, with its menu's Move up and Move down. Nothing at all while there are none.
 */
function PinnedNotes({ domainTags }: { domainTags: ReadonlySet<string> }) {
  const notes = usePins().lists.home;
  const { listRef, rowRemoved } = usePinnedListFocus<HTMLDivElement>(notes.length);
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="pinned-heading" className="space-y-4">
      <SectionHeading id="pinned-heading">Pinned</SectionHeading>
      <div ref={listRef}>
        <RowList className="@min-[40rem]:grid @min-[40rem]:grid-cols-2 @min-[40rem]:gap-x-4">
          {notes.map((note, index) => {
            const tag = note.tags?.find((t) => domainTags.has(t));
            return (
              <NoteRow
                key={note.slug}
                note={note}
                supporting={tag && <TagName name={tag} />}
                actions={<NoteActionsMenu note={note} pinnedList="home" onRemovedFromList={() => rowRemoved(index)} />}
              />
            );
          })}
        </RowList>
      </div>
    </section>
  );
}

/** One row per bookmark group, opening that group on the Bookmarks page. Nothing when there are none or they fail to load. */
function BookmarkGroups() {
  const lists = useAsync(() => api.bookmarks(), []);
  const groups = lists.data?.groups ?? [];
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="bookmarks-heading" className="space-y-4">
      <SectionHeading id="bookmarks-heading">Bookmarks</SectionHeading>
      <RowList>
        {groups.map((group) => (
          <LinkRow
            key={group.name}
            to={`/bookmarks#${bookmarkGroupId(group.name)}`}
            headline={group.name.replace(/-/g, " ")}
            leading={<RowIcon icon={BookmarkIcon} />}
            trailing={group.slugs.length}
          />
        ))}
      </RowList>
    </section>
  );
}

/** The brain's counts, each row opening the page that lists them. Invalid notes turn the error colour once there are any. */
function StatsList({ stats }: { stats: Stats | undefined }) {
  if (!stats) return null;
  const rows = [
    { label: "Notes", value: stats.notes, to: "/tags", icon: FileTextIcon },
    { label: "Files", value: stats.files, to: "/files", icon: FolderIcon },
    { label: "Invalid notes", value: stats.invalid, to: "/check", icon: FileWarningIcon, warn: stats.invalid > 0 },
  ];
  return (
    <section aria-labelledby="stats-heading" className="space-y-4">
      <SectionHeading id="stats-heading">Stats</SectionHeading>
      <RowList>
        {rows.map((row) => (
          <LinkRow
            key={row.to}
            to={row.to}
            headline={row.label}
            leading={<RowIcon icon={row.icon} />}
            trailing={<span className={row.warn ? "text-error" : undefined}>{row.value}</span>}
          />
        ))}
      </RowList>
    </section>
  );
}

/**
 * The header comes first, as on every other page, and shows even when nothing loads. Then the domains
 * and the pins. Beside them from the large window class (below it, under them): what was filed
 * recently, the bookmark groups, and the counts. One error notice stands for the domains and the stats,
 * and Try again reloads whichever failed.
 */
export function HomePage() {
  const domains = useDomains();
  const stats = useAsync(() => api.stats(), []);
  const domainsFailed = domains.status === "error";
  const retry = () => {
    if (domainsFailed) domains.retry();
    if (stats.error) stats.reload();
  };
  const domainTags = useMemo(() => new Set(domains.domains.flatMap((d) => (d.tag ? [d.tag] : []))), [domains.domains]);

  return (
    <div className="home-page">
      <PageHeader title="Home" tabTitle="" />
      <div className="grid gap-8 large:grid-cols-[minmax(0,1fr)_22rem] large:items-start">
        <div className="@container min-w-0 space-y-8">
          <DomainsSection domains={domains} onRetry={retry} />
          <PinnedNotes domainTags={domainTags} />
        </div>
        <div className="min-w-0 space-y-8">
          <RecentNotes />
          <BookmarkGroups />
          {stats.error && !domainsFailed ? <ErrorAlert error={stats.error} onRetry={retry} /> : <StatsList stats={stats.data} />}
        </div>
      </div>
    </div>
  );
}
