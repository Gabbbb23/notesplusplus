import { ChevronDownIcon, FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KindBadge } from "@/components/badges";
import { ItemCard } from "@/components/item-card";
import { GroupActionsMenu, NoteActionsMenu } from "@/components/note-actions-menu";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/page-state";
import { ViewSwitch, type NoteView } from "@/components/view-switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Ripple } from "@/components/ui/ripple";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, noteUrl } from "@/lib/api";
import { FOCUS_RING } from "@/lib/focus-ring";
import type { BookmarkGroup, NoteSummary } from "@/lib/types";
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

export function BookmarksPage() {
  const groups = useAsync(() => api.bookmarks(), []);
  const notes = useAsync(() => api.listNotes({ limit: 500 }), []);
  const [preferences] = useState(readBookmarkPreferences);
  const [view, setView] = useState<NoteView>(preferences.view ?? "list");
  const [sort, setSort] = useState<BookmarkSort>(preferences.sort ?? "manual");
  const [newGroup, setNewGroup] = useState("");
  const [creating, setCreating] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(preferences.openGroups));
  const [orderedGroups, setOrderedGroups] = useState<BookmarkGroup[]>([]);
  const hasSavedOpenGroups = preferences.openGroups !== undefined;
  const bySlug = new Map((notes.data?.items ?? []).map((note) => [note.slug, note]));

  useEffect(() => {
    if (!groups.data) return;
    const nextGroups = groups.data.groups;
    setOrderedGroups(nextGroups);
    setOpenGroups((current) => hasSavedOpenGroups ? new Set(nextGroups.map((group) => group.name).filter((name) => current.has(name))) : new Set(nextGroups.map((group) => group.name)));
  }, [groups.data, hasSavedOpenGroups]);

  useEffect(() => writeBookmarkPreferences({ view, sort, openGroups: [...openGroups] }), [view, sort, openGroups]);

  const createGroup = async () => {
    const value = newGroup.trim();
    if (!value) return;
    setCreating(true);
    try {
      const next = await api.createBookmarkGroup(value);
      setNewGroup("");
      setOrderedGroups(next.groups);
      setOpenGroups((current) => new Set([...current, next.groups.at(-1)?.name ?? ""]));
      toast.success("Bookmark group created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create bookmark group");
    } finally {
      setCreating(false);
    }
  };

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

  return <>
    <PageHeader title="Bookmarks" tabTitle="Bookmarks" aside={`${orderedGroups.length} groups`}>
      <form className="flex max-w-md items-center gap-2" onSubmit={(event) => { event.preventDefault(); void createGroup(); }}>
        <Input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} placeholder="New group name" aria-label="New bookmark group" />
        <Button type="submit" disabled={creating || !newGroup.trim()}>{creating ? "Creating" : "Create group"}</Button>
      </form>
    </PageHeader>
    <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
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
    {orderedGroups.length === 0 && <EmptyState>No bookmark groups yet.</EmptyState>}
    {/* The groups as an M3 list: a 56px row per group that opens and closes it, dividers between groups. */}
    <div className="divide-y divide-outline-variant">
      {orderedGroups.map((group, groupIndex) => {
        const name = group.name.replace(/-/g, " ");
        const groupNotes = sortNotes(group.slugs.flatMap((slug) => { const note = bySlug.get(slug); return note ? [note] : []; }), sort);
        const isOpen = openGroups.has(group.name);
        return <section key={group.name}>
          <div className="flex items-center gap-1 py-1">
            <button type="button" className={cn("relative flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-medium px-4 text-left text-on-surface", FOCUS_RING)} aria-expanded={isOpen} onClick={() => setOpenGroups((current) => { const next = new Set(current); if (next.has(group.name)) next.delete(group.name); else next.add(group.name); return next; })}>
              <FolderIcon className="size-6 shrink-0 text-on-surface-variant" aria-hidden="true" />
              <span className="min-w-0 text-title-medium wrap-break-word">{name}</span>
              <span className="text-body-medium text-on-surface-variant">{groupNotes.length}</span>
              <ChevronDownIcon className={cn("ml-auto size-6 shrink-0 text-on-surface-variant transition-transform duration-200 ease-standard", isOpen && "rotate-180")} aria-hidden="true" />
              <Ripple />
            </button>
            <GroupActionsMenu name={name} index={groupIndex} count={orderedGroups.length} onMove={(direction) => void moveGroupByDirection(group.name, direction)} />
          </div>
          {isOpen && <div className="pb-4">{groupNotes.length === 0 ? <p className="px-4 text-body-medium text-on-surface-variant">No notes in this group.</p> : <div className={view === "tiles" ? "grid gap-2 medium:grid-cols-2" : "space-y-2"}>{groupNotes.map((note) => <ItemCard
            key={note.slug}
            title={{ text: note.title, to: noteUrl(note.slug) }}
            badge={<KindBadge kind={note.type} />}
            summary={view !== "tiles" ? note.summary || undefined : undefined}
            snippet={view === "content" ? note.summary || undefined : undefined}
            meta={view === "details" ? <span>updated {note.updated}</span> : undefined}
            actions={<NoteActionsMenu note={note} bookmarkOrder={sort === "manual" ? { group: group.name, index: group.slugs.indexOf(note.slug), count: group.slugs.length, onMove: (direction) => void moveNote(group.name, note.slug, direction) } : undefined} />}
          />)}</div>}</div>}
        </section>;
      })}
    </div>
  </>;
}
