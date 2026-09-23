import type {
  Brain,
  BrainStats,
  FileEntry,
  InboxItem,
  InboxTakeOptions,
  InboxTakeResult,
  IndexStats,
  LinkReport,
  ListFilter,
  Note,
  NoteStore,
  NoteSummary,
  NoteTrail,
  PinLists,
  PinnedNotes,
  PinTarget,
  RenameResult,
  SearchIndex,
  SearchOptions,
  SearchResult,
  Tag,
  WriteMeta,
  WriteNoteInput,
} from "./types.ts";

/**
 * Composes the store and the index so every write reaches both.
 * The store is the source of truth; if an index update fails after a successful
 * write, the write stands and the error is logged. `reindex()` repairs the cache.
 * Callers get the Brain interface only; the store and index stay private.
 *
 * The note graph (backlinks, trails, mentions, hub membership) is answered by the index, which every write, rename,
 * delete, inbox take, and reindex keeps current, so those reads never scan note files.
 */
export class BrainImpl implements Brain {
  constructor(
    private readonly store: NoteStore,
    private readonly index: SearchIndex,
    private readonly log: (msg: string) => void = (m) => console.error(m),
  ) {}

  get root(): string {
    return this.store.root;
  }

  resolve(relativePath: string): string {
    return this.store.resolve(relativePath);
  }

  async init(): Promise<IndexStats | null> {
    await this.store.init();
    await this.index.open();
    const stats = await this.index.stats();
    return stats.notes === 0 ? this.reindex() : null;
  }

  reindex(): Promise<IndexStats> {
    return this.index.rebuild(this.store);
  }

  close(): Promise<void> {
    return this.index.close();
  }

  list(filter?: ListFilter): Promise<NoteSummary[]> {
    return this.store.list(filter);
  }

  get(slug: string): Promise<Note | null> {
    return this.store.get(slug);
  }

  async write(input: WriteNoteInput, meta: WriteMeta): Promise<Note> {
    const note = await this.store.write(input, meta);
    await this.safeIndex(() => this.index.upsertNote(note), `upsert ${note.slug}`);
    return note;
  }

  async rename(oldSlug: string, newSlug: string, meta: WriteMeta): Promise<RenameResult> {
    const result = await this.store.rename(oldSlug, newSlug, meta);
    await this.safeIndex(async () => {
      await this.index.removeNote(oldSlug);
      await this.index.upsertNote(result.note);
      for (const slug of result.rewritten) {
        const n = await this.store.get(slug);
        if (n) await this.index.upsertNote(n);
      }
    }, `rename ${oldSlug} -> ${newSlug}`);
    return result;
  }

  async delete(slug: string, meta: WriteMeta): Promise<void> {
    await this.store.delete(slug, meta);
    await this.safeIndex(() => this.index.removeNote(slug), `remove ${slug}`);
  }

  search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    return this.index.search(query, opts);
  }

  backlinks(slug: string): Promise<NoteSummary[]> {
    return this.index.backlinks(slug);
  }

  trail(slug: string): Promise<NoteTrail | null> {
    return this.index.trail(slug);
  }

  isMentioned(absolutePath: string): Promise<boolean> {
    return this.index.isMentioned(absolutePath);
  }

  tags(): Promise<Tag[]> {
    return this.store.tags();
  }

  createTag(tag: Tag, meta: WriteMeta): Promise<Tag> {
    return this.store.createTag(tag, meta);
  }

  async pins(): Promise<PinnedNotes> {
    return this.pinnedNotes(await this.store.pins());
  }

  async setPin(slug: string, target: PinTarget, pinned: boolean, meta: WriteMeta): Promise<PinnedNotes> {
    return this.pinnedNotes(await this.store.setPin(slug, target, pinned, meta));
  }

  async reorderPins(target: PinTarget, slugs: string[], meta: WriteMeta): Promise<PinnedNotes> {
    return this.pinnedNotes(await this.store.reorderPins(target, slugs, meta));
  }

  bookmarks() { return this.store.bookmarks(); }
  setBookmark(slug: string, group: string, bookmarked: boolean, meta: WriteMeta) { return this.store.setBookmark(slug, group, bookmarked, meta); }
  createBookmarkGroup(name: string, meta: WriteMeta) { return this.store.createBookmarkGroup(name, meta); }
  reorderBookmarkGroups(names: string[], meta: WriteMeta) { return this.store.reorderBookmarkGroups(names, meta); }
  reorderBookmarkNotes(group: string, slugs: string[], meta: WriteMeta) { return this.store.reorderBookmarkNotes(group, slugs, meta); }

  /** Pinned slugs as notes, in pin order. Pins never reach the index, so a hand-deleted note drops out at once. */
  private async pinnedNotes(lists: PinLists): Promise<PinnedNotes> {
    const bySlug = new Map((await this.store.summaries([...lists.home, ...lists.sidebar])).map((n) => [n.slug, n]));
    const notes = (slugs: string[]) => slugs.flatMap((slug) => bySlug.get(slug) ?? []);
    return { home: notes(lists.home), sidebar: notes(lists.sidebar) };
  }

  inboxList(): Promise<InboxItem[]> {
    return this.store.inboxList();
  }

  async inboxTake(
    name: string,
    opts: InboxTakeOptions,
    meta: WriteMeta,
  ): Promise<InboxTakeResult> {
    const result = await this.store.inboxTake(name, opts, meta);
    if (result.kind === "source" && result.note) {
      const note = result.note;
      await this.safeIndex(() => this.index.upsertNote(note), `upsert source ${note.slug}`);
    } else if (result.kind === "file" && result.filePath) {
      const filePath = result.filePath;
      const entry = (await this.store.files()).find((f) => f.path === filePath);
      if (entry) {
        await this.safeIndex(() => this.index.upsertFile(entry, this.store.resolve(entry.path)), `upsert file ${filePath}`);
      }
    }
    return result;
  }

  inboxAdd(name: string, content: string): Promise<InboxItem> {
    return this.store.inboxAdd(name, content);
  }

  files(): Promise<FileEntry[]> {
    return this.store.files();
  }

  async checkLinks(): Promise<LinkReport> {
    const [fromFiles, membership] = await Promise.all([this.store.checkLinks(), this.index.hubMembership()]);
    return { ...fromFiles, ...membership };
  }

  stats(): Promise<BrainStats> {
    return this.index.stats();
  }

  private async safeIndex(fn: () => Promise<void>, what: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.log(`index update failed (${what}): ${err instanceof Error ? err.message : String(err)}. Run reindex.`);
    }
  }
}
