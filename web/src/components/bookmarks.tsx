import { BookmarkIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { BookmarkGroup, BookmarkLists, NoteRef } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Ripple } from "@/components/ui/ripple";

/**
 * The Bookmark button and its M3 basic dialog: a checkbox row per group, a field for a new group, and
 * Cancel and Save. The dialog renders at the document root, so an open menu around the button cannot clip it.
 */
export function BookmarkAssignment({ note }: { note: NoteRef }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BookmarkLists>({ groups: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!open) return; void api.bookmarks().then((next) => { setData(next); setSelected(new Set(next.groups.filter((g) => g.slugs.includes(note.slug)).map((g) => g.name))); }); }, [open, note.slug]);
  const save = async () => { setLoading(true); try { const current = new Set(data.groups.filter((g) => g.slugs.includes(note.slug)).map((g) => g.name)); const groups = new Set(selected); if (newGroup.trim()) { const created = await api.createBookmarkGroup(newGroup.trim()); setData(created); groups.add(created.groups.at(-1)?.name ?? newGroup.trim().toLowerCase().replace(/\s+/g, "-")); } for (const group of new Set([...current, ...groups])) if (current.has(group) !== groups.has(group)) await api.setBookmark(note.slug, group, groups.has(group)); toast.success("Bookmarks updated"); setOpen(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update bookmarks"); } finally { setLoading(false); } };
  const toggle = (name: string, checked: boolean) => setSelected((old) => { const next = new Set(old); if (checked) next.add(name); else next.delete(name); return next; });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="text" size="small"><BookmarkIcon aria-hidden="true" /> Bookmark</Button>
      </DialogTrigger>
      <DialogContent
        data-slot="bookmark-dialog"
        aria-describedby={undefined}
        className="w-md"
        // NoteActionsMenu puts the button inside a menu item, and React events bubble through portals. A
        // pointer move here would reach that item, which focuses itself on pointer move and so would pull
        // focus out of the dialog.
        onPointerMove={(event) => event.stopPropagation()}
      >
        <DialogTitle>Bookmark “{note.title}”</DialogTitle>
        {data.groups.length > 0 ? (
          // M3 list rows with a leading checkbox, reaching the dialog's edges so the state layer does too.
          <div className="-mx-6">
            {data.groups.map((group) => (
              <label key={group.name} className="relative flex min-h-14 cursor-pointer items-center gap-4 px-6 text-body-large text-on-surface">
                <input
                  type="checkbox"
                  className="size-[18px] shrink-0 cursor-pointer accent-primary"
                  checked={selected.has(group.name)}
                  onChange={(event) => toggle(group.name, event.target.checked)}
                />
                <span className="min-w-0 wrap-break-word">{group.name.replace(/-/g, " ")}</span>
                <Ripple />
              </label>
            ))}
          </div>
        ) : (
          <p className="text-body-medium text-on-surface-variant">No bookmark groups yet.</p>
        )}
        <div className="flex items-center gap-2">
          <Input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} placeholder="New group name" aria-label="New bookmark group" />
          <Button type="button" variant="outlined" size="icon" aria-label="Add to new group" onClick={() => void save()} disabled={!newGroup.trim()}><PlusIcon aria-hidden="true" /></Button>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="text">Cancel</Button>
          </DialogClose>
          <Button variant="text" onClick={() => void save()} disabled={loading}>{loading ? "Saving" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The id of a group's section on the Bookmarks page, so a link to `/bookmarks#<id>` opens that group. */
export function bookmarkGroupId(name: string): string {
  return `bookmark-group-${name}`;
}

/**
 * The Bookmarks page's New group button and its M3 basic dialog: a Group name field, then Cancel and Create.
 * Create hands the server's lists to onCreated and closes the dialog, and focus goes back to the button.
 */
export function NewGroupDialog({ onCreated }: { onCreated: (lists: BookmarkLists) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const value = name.trim();

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    try {
      const lists = await api.createBookmarkGroup(value);
      onCreated(lists);
      toast.success("Bookmark group created");
      setOpen(false);
      setName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create bookmark group");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setName("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="tonal">
          <PlusIcon aria-hidden="true" />
          New group
        </Button>
      </DialogTrigger>
      <DialogContent data-slot="new-group-dialog" aria-describedby={undefined} className="w-md">
        <DialogTitle>New group</DialogTitle>
        <form className="flex flex-col gap-4" onSubmit={(event) => void create(event)}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Group name" aria-label="Group name" />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="text">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="text" disabled={!value || busy} aria-busy={busy || undefined}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The group's notes in its own order, skipping slugs that are not among `notes`. */
export function bookmarkGroupNotes<T extends NoteRef>(group: BookmarkGroup, notes: readonly T[]): T[] {
  const bySlug = new Map(notes.map((note) => [note.slug, note]));
  return group.slugs.flatMap((slug) => {
    const note = bySlug.get(slug);
    return note ? [note] : [];
  });
}
