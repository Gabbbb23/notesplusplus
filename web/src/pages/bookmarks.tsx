import { ArrowDownIcon, ArrowUpIcon, BookmarkIcon, EllipsisVerticalIcon, FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { KindBadge } from "@/components/badges";
import { NoteActionsMenu } from "@/components/note-actions-menu";
import { PageHeader } from "@/components/page-header";
import { ViewSwitch, type NoteView } from "@/components/view-switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import type { BookmarkGroup, NoteSummary } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

type BookmarkSort = "manual" | "title" | "created" | "updated";
type BookmarkPreferences = { view?: NoteView; sort?: BookmarkSort; openGroups?: string[] };

const BOOKMARK_PREFERENCES_KEY = "notesplusplus.bookmarks.preferences";

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
      <form className="flex max-w-md gap-2" onSubmit={(event) => { event.preventDefault(); void createGroup(); }}>
        <Input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} placeholder="New group name" aria-label="New bookmark group" />
        <Button type="submit" disabled={creating || !newGroup.trim()}>{creating ? "Creating" : "Create group"}</Button>
      </form>
    </PageHeader>
    <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">Sort
        <select className="h-10 rounded-md border border-input bg-card px-3 text-foreground" value={sort} onChange={(event) => setSort(event.target.value as BookmarkSort)} aria-label="Sort bookmarks">
          <option value="manual">Manual order</option><option value="title">Title A to Z</option><option value="created">Recently added</option><option value="updated">Recently updated</option>
        </select>
      </label>
      <ViewSwitch value={view} onChange={setView} />
    </div>
    {orderedGroups.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground"><BookmarkIcon className="mx-auto mb-2 size-6" aria-hidden="true" />No bookmark groups yet.</div>}
    <div className="space-y-3">
      {orderedGroups.map((group) => {
        const groupNotes = sortNotes(group.slugs.flatMap((slug) => { const note = bySlug.get(slug); return note ? [note] : []; }), sort);
        const isOpen = openGroups.has(group.name);
        return <section key={group.name} className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 px-3 py-2">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen} onClick={() => setOpenGroups((current) => { const next = new Set(current); if (next.has(group.name)) next.delete(group.name); else next.add(group.name); return next; })}>
              <FolderIcon className="size-4 text-muted-foreground" aria-hidden="true" /><span className="font-semibold">{group.name.replace(/-/g, " ")}</span><span className="text-sm text-muted-foreground">{groupNotes.length}</span>
            </button>
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More actions for ${group.name.replace(/-/g, " ")}`}><EllipsisVerticalIcon aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={orderedGroups.findIndex((entry) => entry.name === group.name) === 0} onSelect={() => void moveGroupByDirection(group.name, "up")}><ArrowUpIcon aria-hidden="true" />Move up</DropdownMenuItem><DropdownMenuItem disabled={orderedGroups.findIndex((entry) => entry.name === group.name) === orderedGroups.length - 1} onSelect={() => void moveGroupByDirection(group.name, "down")}><ArrowDownIcon aria-hidden="true" />Move down</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          </div>
          {isOpen && <div className="border-t p-3">{groupNotes.length === 0 ? <p className="text-sm text-muted-foreground">No notes in this group.</p> : <div className={view === "tiles" ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>{groupNotes.map((note) => <article key={note.slug} className="min-w-0 rounded-lg border bg-card p-4 transition-colors hover:border-card-hover-border"><div className="flex items-start gap-2"><Link className="min-w-0 flex-1 break-words text-base font-medium text-link hover:text-link-hover" to={`/notes/${encodeURIComponent(note.slug)}`}>{note.title}</Link><KindBadge kind={note.type} /><NoteActionsMenu note={note} bookmarkOrder={sort === "manual" ? { group: group.name, index: group.slugs.indexOf(note.slug), count: group.slugs.length, onMove: (direction) => void moveNote(group.name, note.slug, direction) } : undefined} /></div>{view !== "tiles" && <p className="mt-1 text-sm text-muted-foreground">{note.summary}</p>}{view === "details" && <div className="mt-2 text-xs text-muted-foreground">updated {note.updated}</div>}{view === "content" && <div className="mt-2 text-sm">{note.summary}</div>}</article>)}</div>}</div>}
        </section>;
      })}
    </div>
  </>;
}
