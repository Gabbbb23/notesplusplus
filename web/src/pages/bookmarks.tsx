import { ChevronDownIcon, FolderIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { KindBadge, TagBadges } from "@/components/badges";
import { bookmarkGroupId, bookmarkGroupNotes, NewGroupDialog } from "@/components/bookmarks";
import { CardList, ItemCard } from "@/components/item-card";
import { NoteCard } from "@/components/note-card";
import { GroupActionsMenu, NoteActionsMenu } from "@/components/note-actions-menu";
import { NoteRow, RowList } from "@/components/note-row";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorAlert, LoadingBlock } from "@/components/page-state";
import { ViewSwitch, type NoteView } from "@/components/view-switch";
import { Ripple } from "@/components/ui/ripple";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, noteUrl } from "@/lib/api";
import { FOCUS_RING } from "@/lib/focus-ring";
import type { BookmarkGroup, BookmarkLists, NoteSummary } from "@/lib/types";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";

type BookmarkSort = "manual" | "title" | "created" | "updated";
type BookmarkPreferences = { view?: NoteView; sort?: BookmarkSort; openGroups?: string[] };

const BOOKMARK_PREFERENCES_KEY = "notesplusplus.bookmarks.preferences";

const SORT_OPTIONS: { value: BookmarkSort; label: string }[] = [
  { value: "manual", label: "Manual order" },
  { value: "title", label: "Title A to Z" },
  { value: "created", label: "Recently added" },
  { value: "updated", label: "Recently updated" },
];

function readBookmarkPreferences(): BookmarkPreferences {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(BOOKMARK_PREFERENCES_KEY);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
  if (!parsed || typeof parsed !== "object") return {};
  const record = new Map(Object.entries(parsed));
  const view = record.get("view");
  const sort = record.get("sort");
  const openGroups = record.get("openGroups");
  return {
    ...(view === "list" || view === "details" || view === "tiles" || view === "content" ? { view } : {}),
    ...(sort === "manual" || sort === "title" || sort === "created" || sort === "updated" ? { sort } : {}),
    ...(Array.isArray(openGroups) && openGroups.every((group): group is string => typeof group === "string") ? { openGroups } : {}),
  };
}

function writeBookmarkPreferences(preferences: BookmarkPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BOOKMARK_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
}

/** The group a `#bookmark-group-<name>` hash names, as Home's links to a group do. */
function groupFromHash(hash: string): string | undefined {
  const prefix = `#${bookmarkGroupId("")}`;
  if (!hash.startsWith(prefix)) return undefined;
  try {
    return decodeURIComponent(hash.slice(prefix.length));
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}

function sortNotes(notes: NoteSummary[], sort: BookmarkSort): NoteSummary[] {
  if (sort === "manual") return notes;
  return [...notes].sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug) : b[sort].localeCompare(a[sort]) || a.title.localeCompare(b.title));
}

function moveGroup(groups: BookmarkGroup[], from: string, to: string): BookmarkGroup[] {
  const fromIndex = groups.findIndex((group) => group.name === from);
  const toIndex = groups.findIndex((group) => group.name === to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return groups;
  const next = [...groups];
  const [group] = next.splice(fromIndex, 1);
  if (!group) return groups;
  next.splice(toIndex, 0, group);
  return next;
}

/** An open group's notes, drawn the way the view asks: each view shows a different amount of each note. */
function GroupNotes({ notes, view, menuFor }: { notes: NoteSummary[]; view: NoteView; menuFor: (note: NoteSummary) => ReactNode }) {
  if (notes.length === 0) {
    return (
      <div className="px-4 py-2 text-body-medium text-on-surface-variant">
        <p>No notes in this group.</p>
        <p>Choose Bookmark in a note's three-dot menu to add it here.</p>
      </div>
    );
  }
  switch (view) {
    case "list":
      return <RowList>{notes.map((note) => <NoteRow key={note.slug} note={note} actions={menuFor(note)} />)}</RowList>;
    case "details":
      return (
        <RowList>
          {notes.map((note) => (
            <NoteRow key={note.slug} note={note} supporting={note.summary || undefined} trailing={`updated ${note.updated}`} actions={menuFor(note)} />
          ))}
        </RowList>
      );
    case "tiles":
      return (
        <div className="grid gap-2 medium:grid-cols-2 large:grid-cols-3">
          {notes.map((note) => <NoteCard key={note.slug} note={note} compact actions={menuFor(note)} />)}
        </div>
      );
    case "content":
      return (
        <CardList>
          {notes.map((note) => (
            <ItemCard
              key={note.slug}
              title={{ text: note.title, to: noteUrl(note.slug) }}
              badge={<KindBadge kind={note.type} />}
              summary={note.summary || undefined}
              meta={
                <>
                  <TagBadges tags={note.tags} />
                  <span>created {note.created}</span>
                  <span>updated {note.updated}</span>
                </>
              }
              actions={menuFor(note)}
            />
          ))}
        </CardList>
      );
  }
}

export function BookmarksPage() {
  const groups = useAsync(() => api.bookmarks(), []);
  const notes = useAsync(() => api.listNotes({ limit: 500 }), []);
  const location = useLocation();
  const [preferences] = useState(readBookmarkPreferences);
  const [view, setView] = useState<NoteView>(preferences.view ?? "list");
  const [sort, setSort] = useState<BookmarkSort>(preferences.sort ?? "manual");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(preferences.openGroups));
  const [orderedGroups, setOrderedGroups] = useState<BookmarkGroup[]>([]);
  const hasSavedOpenGroups = preferences.openGroups !== undefined;
  const hashGroup = groupFromHash(location.hash);
  // The history entry whose hash already opened its group, so closing that group afterwards sticks.
  const hashHandledFor = useRef<string | null>(null);
  const scrollPending = useRef<string | null>(null);
  const ready = groups.data !== undefined && notes.data !== undefined;
  const error = groups.error ?? notes.error;

  // Layout effects, so the first painted frame already has the groups in order and the right ones open.
  useLayoutEffect(() => {
    if (!groups.data) return;
    const nextGroups = groups.data.groups;
    setOrderedGroups(nextGroups);
    setOpenGroups((current) => hasSavedOpenGroups ? new Set(nextGroups.map((group) => group.name).filter((name) => current.has(name))) : new Set(nextGroups.map((group) => group.name)));
  }, [groups.data, hasSavedOpenGroups]);

  useLayoutEffect(() => {
    if (!hashGroup || hashHandledFor.current === location.key || !orderedGroups.some((group) => group.name === hashGroup)) return;
    hashHandledFor.current = location.key;
    scrollPending.current = hashGroup;
    setOpenGroups((current) => new Set(current).add(hashGroup));
  }, [hashGroup, location.key, orderedGroups]);

  // Once the linked group's notes are on screen. scroll-mt keeps its row clear of the sticky top app bar.
  useLayoutEffect(() => {
    const target = scrollPending.current;
    if (!target || !ready || !openGroups.has(target)) return;
    scrollPending.current = null;
    document.getElementById(bookmarkGroupId(target))?.scrollIntoView();
  }, [ready, openGroups]);

  useEffect(() => writeBookmarkPreferences({ view, sort, openGroups: [...openGroups] }), [view, sort, openGroups]);

  const groupCreated = (lists: BookmarkLists) => {
    const known = new Set(orderedGroups.map((group) => group.name));
    const created = lists.groups.find((group) => !known.has(group.name)) ?? lists.groups.at(-1);
    setOrderedGroups(lists.groups);
    if (created) setOpenGroups((current) => new Set(current).add(created.name));
  };

  const toggleGroup = (name: string) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const moveGroupByDirection = async (target: string, direction: "up" | "down") => {
    const sourceIndex = orderedGroups.findIndex((group) => group.name === target);
    if (sourceIndex < 0) return;
    const neighbor = orderedGroups[sourceIndex + (direction === "up" ? -1 : 1)];
    if (!neighbor) return;
    const previous = orderedGroups;
    const next = moveGroup(previous, target, neighbor.name);
    setOrderedGroups(next);
    try {
      await api.orderBookmarkGroups(next.map((group) => group.name));
    } catch (error) {
      setOrderedGroups(previous);
      toast.error(error instanceof Error ? error.message : "Could not reorder bookmark groups");
    }
  };

  const moveNote = async (groupName: string, slug: string, direction: "up" | "down") => {
    const previous = orderedGroups;
    const group = previous.find((entry) => entry.name === groupName);
    if (!group) return;
    const index = group.slugs.indexOf(slug);
    const nextIndex = index + (direction === "up" ? -1 : 1);
    const neighbor = group.slugs[nextIndex];
    if (index < 0 || !neighbor) return;
    const slugs = [...group.slugs];
    slugs[index] = neighbor;
    slugs[nextIndex] = slug;
    const next = previous.map((entry) => entry.name === groupName ? { ...entry, slugs } : entry);
    setOrderedGroups(next);
    try {
      await api.orderBookmarkNotes(groupName, slugs);
    } catch (error) {
      setOrderedGroups(previous);
      toast.error(error instanceof Error ? error.message : "Could not reorder bookmarks");
    }
  };

  let body: ReactNode;
  if (error) {
    body = (
      <ErrorAlert
        error={error}
        onRetry={() => {
          if (groups.error) groups.reload();
          if (notes.error) notes.reload();
        }}
      />
    );
  } else if (!ready) {
    body = <LoadingBlock />;
  } else if (orderedGroups.length === 0) {
    body = <EmptyState>No bookmark groups yet.</EmptyState>;
  } else {
    const allNotes = notes.data?.items ?? [];
    body = (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
          <Select value={sort} onValueChange={(value) => { const option = SORT_OPTIONS.find((o) => o.value === value); if (option) setSort(option.value); }}>
            <SelectTrigger size="chip" aria-label="Sort bookmarks">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <ViewSwitch value={view} onChange={setView} />
        </div>
        <div className="divide-y divide-outline-variant">
          {orderedGroups.map((group, groupIndex) => {
            const name = group.name.replace(/-/g, " ");
            const groupNotes = sortNotes(bookmarkGroupNotes(group, allNotes), sort);
            const isOpen = openGroups.has(group.name);
            const panelId = `${bookmarkGroupId(group.name)}-notes`;
            const menuFor = (note: NoteSummary) => (
              <NoteActionsMenu
                note={note}
                bookmarkOrder={sort === "manual" ? { group: group.name, index: group.slugs.indexOf(note.slug), count: group.slugs.length, onMove: (direction) => void moveNote(group.name, note.slug, direction) } : undefined}
              />
            );
            return (
              <section key={group.name} id={bookmarkGroupId(group.name)} data-slot="bookmark-group" className="scroll-mt-20">
                {/* The M3 list subheader row: the whole row opens and closes the group, the menu beside it. */}
                <div className="flex items-center gap-1 py-1 pr-2">
                  <h2 className="flex min-w-0 flex-1">
                    <button
                      type="button"
                      className={cn("relative flex min-h-14 w-full min-w-0 cursor-pointer items-center gap-4 rounded-large px-4 text-left text-on-surface", FOCUS_RING)}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? panelId : undefined}
                      onClick={() => toggleGroup(group.name)}
                    >
                      <FolderIcon className="size-6 shrink-0 text-on-surface-variant" aria-hidden="true" />
                      <span className="min-w-0 text-title-medium wrap-break-word">{name}</span>
                      <span className="text-body-medium text-on-surface-variant">{groupNotes.length}</span>
                      <ChevronDownIcon className={cn("ml-auto size-6 shrink-0 text-on-surface-variant transition-transform duration-200 ease-standard", isOpen && "rotate-180")} aria-hidden="true" />
                      <Ripple />
                    </button>
                  </h2>
                  <GroupActionsMenu name={name} index={groupIndex} count={orderedGroups.length} onMove={(direction) => void moveGroupByDirection(group.name, direction)} />
                </div>
                {/* From the medium window class the notes sit under the group's name, past its folder icon. */}
                {isOpen && (
                  <div id={panelId} data-view={view} className="pb-4 medium:pl-10">
                    <GroupNotes notes={groupNotes} view={view} menuFor={menuFor} />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </>
    );
  }

  const groupCount = orderedGroups.length;
  return (
    <>
      <PageHeader
        title="Bookmarks"
        aside={ready ? `${groupCount} ${groupCount === 1 ? "group" : "groups"}` : undefined}
        actions={<NewGroupDialog onCreated={groupCreated} />}
      />
      {body}
    </>
  );
}
