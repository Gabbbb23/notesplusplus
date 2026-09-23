import { BookmarkIcon, CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { BookmarkGroup, BookmarkLists, NoteRef } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BookmarkAssignment({ note }: { note: NoteRef }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BookmarkLists>({ groups: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!open) return; void api.bookmarks().then((next) => { setData(next); setSelected(new Set(next.groups.filter((g) => g.slugs.includes(note.slug)).map((g) => g.name))); }); }, [open, note.slug]);
  const save = async () => { setLoading(true); try { const current = new Set(data.groups.filter((g) => g.slugs.includes(note.slug)).map((g) => g.name)); const groups = new Set(selected); if (newGroup.trim()) { const created = await api.createBookmarkGroup(newGroup.trim()); setData(created); groups.add(created.groups.at(-1)?.name ?? newGroup.trim().toLowerCase().replace(/\s+/g, "-")); } for (const group of new Set([...current, ...groups])) if (current.has(group) !== groups.has(group)) await api.setBookmark(note.slug, group, groups.has(group)); toast.success("Bookmarks updated"); setOpen(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update bookmarks"); } finally { setLoading(false); } };
  const dialog = open ? <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4" role="dialog" aria-modal="true" aria-labelledby={`bookmark-title-${note.slug}`} data-slot="bookmark-dialog"><div className="w-full max-w-md rounded-lg border bg-popover p-5 shadow-lg"><div className="mb-4 flex items-start justify-between gap-4"><h2 id={`bookmark-title-${note.slug}`} className="text-lg font-semibold">Bookmark “{note.title}”</h2><Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}><XIcon aria-hidden="true" /></Button></div><div className="space-y-1">{data.groups.map((group) => <label key={group.name} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"><input type="checkbox" checked={selected.has(group.name)} onChange={(event) => setSelected((old) => { const next = new Set(old); if (event.target.checked) next.add(group.name); else next.delete(group.name); return next; })} /><span>{group.name.replace(/-/g, " ")}</span>{selected.has(group.name) && <CheckIcon className="ml-auto size-4 text-primary" aria-hidden="true" />}</label>)}{data.groups.length === 0 && <p className="py-2 text-sm text-muted-foreground">No bookmark groups yet.</p>}<div className="mt-3 flex gap-2"><Input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} placeholder="New group name" aria-label="New bookmark group" /><Button type="button" variant="outline" size="icon" onClick={() => void save()} disabled={!newGroup.trim()}><PlusIcon aria-hidden="true" /></Button></div></div><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void save()} disabled={loading}>{loading ? "Saving" : "Save"}</Button></div></div></div> : null;
  return <><Button variant="ghost" size="sm" onClick={() => setOpen(true)}><BookmarkIcon aria-hidden="true" /> Bookmark</Button>{dialog && createPortal(dialog, document.body)}</>;
}

export function bookmarkGroupNotes(group: BookmarkGroup, notes: readonly NoteRef[]): NoteRef[] { const bySlug = new Map(notes.map((note) => [note.slug, note])); return group.slugs.flatMap((slug) => { const note = bySlug.get(slug); return note ? [note] : []; }); }
