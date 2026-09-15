/**
 * SearchIndex implementation: a rebuildable SQLite cache over the store.
 *
 * See db.ts (schema), embeddings.ts (model + chunking), extract.ts (file text),
 * search.ts (ranking). All SQL is synchronous through node:sqlite; the public
 * interface is async to match the contract in types.ts.
 *
 * A rebuild never touches the live database. It fills a new file next to it (`buildingPath`), replays onto that file
 * every note and file written in the meantime, and then swaps it in: close the live connection, rename the new file
 * over the old one, reopen. Windows cannot rename over an open file, hence the close. Until the swap, searches, reads,
 * and writes use the old database, and writes are also recorded so the replay can read them back from the store.
 *
 * Every operation does its slow part first (embedding, reading a file) and then runs all of its SQL in one synchronous
 * step through `live`. `live` waits while a swap is under way, so no operation meets a closed connection, and nothing
 * can run between a rebuild's last replay and the swap.
 */

import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { checkDrivePath, pathKey } from "../graph/drive-path.ts";
import { findTrail, ROOT_HUB, type HubLinks } from "../graph/trail.ts";
import type {
  FileEntry,
  HubMembershipReport,
  IndexStats,
  InvalidNote,
  Note,
  NoteStore,
  NoteSummary,
  NoteTrail,
  NoteType,
  SearchIndex,
  SearchOptions,
  SearchResult,
} from "../types.ts";
import { databaseFilesExist, openIndexDb, removeDatabaseFiles, vectorToBlob, type IndexDb } from "./db.ts";
import {
  chunkBody,
  chunkEmbeddingText,
  createEmbedder,
  disabledEmbedder,
  type Embedder,
} from "./embeddings.ts";
import { extractFileText } from "./extract.ts";
import { hybridSearch, keywordSearch, semanticSearch } from "./search.ts";

export interface IndexOptions {
  /** Path of the SQLite file. Its directory is created on open(). */
  dbPath: string;
  /** Where the embedding model is downloaded to and reused from. */
  modelCachePath: string;
  /** Compute embeddings for semantic search. Default true. */
  embeddings?: boolean;
  log?: (msg: string) => void;
  /** Try to load sqlite-vec for KNN. Default true. Set false to force the in-process cosine path. */
  vec?: boolean;
  /** Replace the real model. Meant for tests; ignored when `embeddings` is false. */
  embedder?: Embedder;
  /** Replace the rename that swaps a rebuilt file in (default fs.renameSync). Meant for tests that make it fail. */
  renameFile?: (from: string, to: string) => void;
}

export type { Embedder } from "./embeddings.ts";

export interface LocalSearchIndex extends SearchIndex {
  /**
   * Load the embedding model and run one short embedding, so the first
   * semantic query does not pay for it. Never rejects: a failure is logged and
   * search keeps its keyword fallback.
   */
  warm(): Promise<void>;
}

const DEFAULT_LIMIT = 20;
const PROGRESS_EVERY = 25;

/**
 * Waits, in ms, before each new attempt to rename the rebuilt file over the live one. On Windows a virus scanner can
 * hold a file it just saw closed for a moment. Searches wait through these; after the last one the rebuild fails
 * and the old database opens again.
 */
const SWAP_RETRY_MS = [10, 25, 50, 100, 200, 400];

/** The file a rebuild fills before swapping it in. open() deletes one left behind by a crash. */
export function buildingPath(dbPath: string): string {
  return `${dbPath}.building`;
}

/** Writes that reached the live database while a rebuild ran, by what to read back from the store. */
interface Recorded {
  notes: Set<string>;
  files: Set<string>;
  invalid: InvalidNote[];
}

interface PreparedNote {
  chunks: string[];
  vectors: Float32Array[] | null;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createIndex(opts: IndexOptions): LocalSearchIndex {
  const log = opts.log ?? (() => {});
  const embedder: Embedder =
    opts.embeddings === false
      ? disabledEmbedder()
      : (opts.embedder ?? createEmbedder({ modelCachePath: opts.modelCachePath, log }));
  const renameFile = opts.renameFile ?? fs.renameSync;

  let idx: IndexDb | null = null;
  /** Set while a rebuilt file is being swapped in. Resolves, never rejects, when the swap ends either way. */
  let swapping: Promise<void> | null = null;
  /** Set while a rebuild runs: the writes it must replay before the swap. */
  let recording: Recorded | null = null;
  let rebuilding: Promise<IndexStats> | null = null;

  const openDb = (file: string, journalMode?: "delete"): IndexDb =>
    openIndexDb({ path: file, dims: embedder.dims, model: embedder.model, vec: opts.vec, log, journalMode });

  const need = (): IndexDb => {
    if (!idx) throw new Error("search index is not open: call open() first");
    return idx;
  };

  /** Fail fast when closed, before any slow work. A swap in progress counts as open: `live` waits it out. */
  const assertOpen = (): void => {
    if (!swapping) need();
  };

  /**
   * Run `fn` against the live database: wait out a swap in progress, then call `fn` in the same turn, so the
   * connection it gets stays open until it returns. `fn` must not await.
   */
  const live = async <T>(fn: (db: IndexDb) => T): Promise<T> => {
    while (swapping) await swapping;
    return fn(need());
  };

  // ---- rows -----------------------------------------------------------------

  const deleteNoteRows = (db: IndexDb, slug: string): void => {
    const chunkIds = db.db
      .prepare("SELECT id FROM chunks WHERE slug = ?")
      .all(slug)
      .map((r) => Number(r.id));
    const delVector = db.db.prepare("DELETE FROM chunk_vectors WHERE chunk_id = ?");
    const delVec = db.vec ? db.db.prepare("DELETE FROM chunk_vec WHERE chunk_id = ?") : null;
    for (const id of chunkIds) {
      delVector.run(id);
      delVec?.run(BigInt(id));
    }
    db.db.prepare("DELETE FROM chunks WHERE slug = ?").run(slug);
    db.db.prepare("DELETE FROM links WHERE from_slug = ?").run(slug);
    db.db.prepare("DELETE FROM mentions WHERE slug = ?").run(slug);
    const row = db.db.prepare("SELECT id FROM notes WHERE slug = ?").get(slug);
    if (row) {
      db.db.prepare("DELETE FROM notes_fts WHERE rowid = ?").run(Number(row.id));
      db.db.prepare("DELETE FROM notes WHERE id = ?").run(Number(row.id));
    }
  };

  /** Chunk a note's body and embed the chunks. Touches no database. */
  const prepareNote = async (note: Note): Promise<PreparedNote> => {
    let chunks = chunkBody(note.body);
    if (chunks.length === 0) chunks = [note.summary.trim() || note.title];

    let vectors: Float32Array[] | null = null;
    if (opts.embeddings !== false) {
      vectors = await embedder.embed(chunks.map((c) => chunkEmbeddingText(note.title, c)));
      if (vectors && vectors.length !== chunks.length) vectors = null;
    }
    return { chunks, vectors };
  };

  const writeNote = (db: IndexDb, note: Note, { chunks, vectors }: PreparedNote): void => {
    db.tx(() => {
      deleteNoteRows(db, note.slug);
      const inserted = db.db
        .prepare(
          `INSERT INTO notes(slug, path, title, type, summary, tags_json, created, updated, body, mtime_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          note.slug,
          note.path,
          note.title,
          note.type,
          note.summary,
          JSON.stringify(note.tags),
          note.created,
          note.updated,
          note.body,
          note.mtimeMs,
        );
      db.db
        .prepare("INSERT INTO notes_fts(rowid, slug, title, summary, tags, body) VALUES (?, ?, ?, ?, ?, ?)")
        .run(Number(inserted?.id), note.slug, note.title, note.summary, note.tags.join(" "), note.body);

      const link = db.db.prepare("INSERT OR IGNORE INTO links(from_slug, to_slug, ord) VALUES (?, ?, ?)");
      note.links.forEach((to, ord) => link.run(note.slug, to, ord));
      const mention = db.db.prepare("INSERT INTO mentions(slug, ord, path, key) VALUES (?, ?, ?, ?)");
      note.mentions.forEach((written, ord) => mention.run(note.slug, ord, written, pathKey(written)));

      const insChunk = db.db.prepare("INSERT INTO chunks(slug, ord, text) VALUES (?, ?, ?) RETURNING id");
      const insVector = db.db.prepare("INSERT INTO chunk_vectors(chunk_id, embedding) VALUES (?, ?)");
      const insVec = db.vec ? db.db.prepare("INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)") : null;
      chunks.forEach((text, ord) => {
        const row = insChunk.get(note.slug, ord, text);
        const id = Number(row?.id);
        const vec = vectors?.[ord];
        if (vec) {
          insVector.run(id, vectorToBlob(vec));
          insVec?.run(BigInt(id), vectorToBlob(vec));
        }
      });

      db.db.prepare("DELETE FROM invalid WHERE path = ?").run(note.path);
    });
  };

  const writeInvalid = (db: IndexDb, invalid: InvalidNote): void => {
    db.tx(() => {
      const stale = db.db.prepare("SELECT slug FROM notes WHERE path = ?").all(invalid.path);
      for (const row of stale) deleteNoteRows(db, String(row.slug));
      db.db
        .prepare("INSERT OR REPLACE INTO invalid(path, error) VALUES (?, ?)")
        .run(invalid.path, invalid.error);
    });
  };

  const deleteFileRows = (db: IndexDb, filePath: string): void => {
    const row = db.db.prepare("SELECT id FROM files WHERE path = ?").get(filePath);
    if (!row) return;
    db.db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(Number(row.id));
    db.db.prepare("DELETE FROM files WHERE id = ?").run(Number(row.id));
  };

  const writeFile = (db: IndexDb, file: FileEntry, text: string): void => {
    const title = path.basename(file.path);
    db.tx(() => {
      deleteFileRows(db, file.path);
      const inserted = db.db
        .prepare(`INSERT INTO files(path, title, ext, size_bytes, mtime_ms, text) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
        .get(file.path, title, file.ext, file.sizeBytes, file.mtimeMs, text);
      db.db
        .prepare("INSERT INTO files_fts(rowid, path, title, text) VALUES (?, ?, ?, ?)")
        .run(Number(inserted?.id), file.path, title, text);
    });
  };

  const countRows = (db: IndexDb): Omit<IndexStats, "durationMs"> => {
    const count = (table: string): number => Number(db.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c ?? 0);
    return { notes: count("notes"), files: count("files"), invalid: count("invalid") };
  };

  // ---- writes -------------------------------------------------------------

  const upsertNote = async (note: Note): Promise<void> => {
    assertOpen();
    const prepared = await prepareNote(note);
    await live((db) => {
      recording?.notes.add(note.slug);
      writeNote(db, note, prepared);
    });
  };

  const removeNote = (slug: string): Promise<void> =>
    live((db) => {
      recording?.notes.add(slug);
      db.tx(() => deleteNoteRows(db, slug));
    });

  const upsertFile = async (file: FileEntry, absolutePath: string): Promise<void> => {
    assertOpen();
    const text = await extractFileText(absolutePath, file.ext);
    await live((db) => {
      recording?.files.add(file.path);
      writeFile(db, file, text);
    });
  };

  const removeFile = (filePath: string): Promise<void> =>
    live((db) => {
      recording?.files.add(filePath);
      db.tx(() => deleteFileRows(db, filePath));
    });

  const recordInvalid = (invalid: InvalidNote): Promise<void> =>
    live((db) => {
      recording?.invalid.push(invalid);
      writeInvalid(db, invalid);
    });

  // ---- rebuild ------------------------------------------------------------

  /** Index everything in the store into `db`, in one transaction. */
  const fill = async (db: IndexDb, store: NoteStore): Promise<void> => {
    let notes = 0;
    db.db.exec("BEGIN");
    try {
      for await (const item of store.readAll()) {
        if ("slug" in item) {
          writeNote(db, item, await prepareNote(item));
          notes++;
          if (notes % PROGRESS_EVERY === 0) log(`indexed ${notes} notes…`);
        } else {
          writeInvalid(db, item);
        }
      }
      for (const entry of await store.files()) {
        writeFile(db, entry, await extractFileText(store.resolve(entry.path), entry.ext));
      }
      db.db.exec("COMMIT");
    } catch (err) {
      if (db.db.isTransaction) db.db.exec("ROLLBACK");
      throw err;
    }
  };

  /**
   * Apply to `db` the writes recorded so far, reading each note and file as it is now in the store, and clear them.
   * Writes recorded while this runs stay for the next call.
   */
  const replay = async (db: IndexDb, store: NoteStore, recorded: Recorded): Promise<void> => {
    const invalid = recorded.invalid.splice(0);
    const slugs = [...recorded.notes];
    const filePaths = [...recorded.files];
    recorded.notes.clear();
    recorded.files.clear();

    for (const item of invalid) writeInvalid(db, item);
    for (const slug of slugs) {
      let note: Note | null;
      try {
        note = await store.get(slug);
      } catch (err) {
        // The file is on disk but no longer parses: file it under its path, as a full read would.
        const row = db.db.prepare("SELECT path FROM notes WHERE slug = ?").get(slug);
        if (row) writeInvalid(db, { path: String(row.path), error: errorMessage(err) });
        continue;
      }
      if (note) writeNote(db, note, await prepareNote(note));
      else db.tx(() => deleteNoteRows(db, slug));
    }
    if (slugs.length > 0) {
      // A note deleted after the full read listed its folder, but before it read the file, was filed as invalid.
      for (const row of db.db.prepare("SELECT path FROM invalid").all()) {
        const rel = String(row.path);
        let gone = false;
        try {
          gone = !fs.existsSync(store.resolve(rel));
        } catch {
          // A path the store refuses to resolve: leave the row as it is.
        }
        if (gone) db.db.prepare("DELETE FROM invalid WHERE path = ?").run(rel);
      }
    }
    if (filePaths.length > 0) {
      const entries = new Map((await store.files()).map((f) => [f.path, f]));
      for (const filePath of filePaths) {
        const entry = entries.get(filePath);
        if (entry) writeFile(db, entry, await extractFileText(store.resolve(entry.path), entry.ext));
        else db.tx(() => deleteFileRows(db, filePath));
      }
    }
  };

  const hasRecorded = (r: Recorded): boolean => r.notes.size > 0 || r.files.size > 0 || r.invalid.length > 0;

  /** Rename `from` over `to`, retrying while Windows reports the file busy. */
  const replaceFile = async (from: string, to: string): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      try {
        renameFile(from, to);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const wait = SWAP_RETRY_MS[attempt];
        if (wait === undefined || !(code === "EBUSY" || code === "EPERM" || code === "EACCES")) throw err;
        await sleep(wait);
      }
    }
  };

  /**
   * Close the live connection, move the rebuilt file over the live one, and reopen. Starts synchronously, so it runs
   * in the same turn as the caller's last check for recorded writes. On failure the old file opens again and the
   * error is rethrown; the caller removes the rebuilt file.
   */
  const swapIn = async (built: string): Promise<void> => {
    const old = need();
    let done!: () => void;
    swapping = new Promise((resolve) => (done = resolve));
    const started = performance.now();
    try {
      old.close();
      idx = null;
      try {
        // SQLite removes the WAL when the last connection closes. If it is still there, another connection, such as
        // the server while `npm run reindex` runs, has the file open, and its WAL would corrupt a new file.
        if (fs.existsSync(`${opts.dbPath}-wal`)) {
          throw new Error(`${opts.dbPath} is open in another process, so the rebuilt index cannot replace it; rebuild through that process`);
        }
        await replaceFile(built, opts.dbPath);
      } finally {
        // The rebuilt file after a rename, the untouched old file otherwise.
        idx = openDb(opts.dbPath);
      }
      log(`index swapped in ${(performance.now() - started).toFixed(1)} ms`);
    } finally {
      swapping = null;
      done();
    }
  };

  const rebuildIntoNewFile = async (store: NoteStore): Promise<IndexStats> => {
    need();
    const started = performance.now();
    const built = buildingPath(opts.dbPath);
    removeDatabaseFiles(built);
    const next = openDb(built, "delete");
    const recorded: Recorded = { notes: new Set(), files: new Set(), invalid: [] };
    recording = recorded;

    let stats: Omit<IndexStats, "durationMs">;
    try {
      await fill(next, store);
      while (hasRecorded(recorded)) await replay(next, store, recorded);
      // From the check above to the swap nothing awaits: a write that has not been recorded by now waits in `live`
      // for the swap and lands in the new file.
      recording = null;
      stats = countRows(next);
      next.close();
      if (!idx) throw new Error("search index was closed during the rebuild");
      await swapIn(built);
    } catch (err) {
      recording = null;
      try {
        next.close();
      } catch {
        // Already closed.
      }
      try {
        removeDatabaseFiles(built);
      } catch (removeErr) {
        log(`could not remove the unfinished index rebuild, ${built}: ${errorMessage(removeErr)}. The next open() retries.`);
      }
      throw err;
    }

    const durationMs = Math.round(performance.now() - started);
    log(`index rebuilt: ${stats.notes} notes, ${stats.files} files, ${stats.invalid} invalid in ${durationMs} ms`);
    return { ...stats, durationMs };
  };

  /** A rebuild asked for while one runs joins it; the running one already replays every write made meanwhile. */
  const rebuild = (store: NoteStore): Promise<IndexStats> => {
    rebuilding ??= rebuildIntoNewFile(store).finally(() => {
      rebuilding = null;
    });
    return rebuilding;
  };

  // ---- reads --------------------------------------------------------------

  const search = async (query: string, options: SearchOptions = {}): Promise<SearchResult[]> => {
    assertOpen();
    if (query.trim().length === 0) return [];
    const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    const includeFiles = options.includeFiles ?? true;
    const filters = { tag: options.tag, type: options.type };
    const mode = options.mode ?? "hybrid";

    if (mode === "keyword" || opts.embeddings === false) {
      return live((db) => keywordSearch(db, query, filters, includeFiles, limit));
    }
    // Null when the model is unavailable: semantic degrades to keyword-only, hybrid to its keyword list.
    const qv = (await embedder.embed([query]))?.[0] ?? null;
    if (mode === "semantic") {
      return live((db) => (qv ? semanticSearch(db, qv, filters, limit) : keywordSearch(db, query, filters, includeFiles, limit)));
    }
    return live((db) => hybridSearch(db, qv, query, filters, includeFiles, limit));
  };

  const backlinks = (slug: string): Promise<NoteSummary[]> =>
    live((db) =>
      db.db
        .prepare(
          `SELECT n.slug, n.path, n.title, n.type, n.summary, n.tags_json, n.created, n.updated
           FROM links l JOIN notes n ON n.slug = l.from_slug
           WHERE l.to_slug = ?
           ORDER BY n.title COLLATE NOCASE, n.slug`,
        )
        .all(slug)
        .map((r) => ({
          slug: String(r.slug),
          path: String(r.path),
          title: String(r.title),
          type: String(r.type) as NoteType,
          summary: String(r.summary),
          tags: JSON.parse(String(r.tags_json)) as string[],
          created: String(r.created),
          updated: String(r.updated),
        })),
    );

  /**
   * The trail from the note graph. Instead of loading every hub, it walks up from the note: one indexed lookup per
   * level fetches the hubs linking to the current level, until no new hub appears. The walk does not continue past
   * the root hub, where every trail starts, so hubs that link back to `index` are not pulled in. findTrail over the
   * hubs found gives the same answer as over every hub (see findTrail). The work grows with the hubs above the note,
   * not with the number of notes.
   */
  const trail = (slug: string): Promise<NoteTrail | null> =>
    live((db) => {
      const note = db.db.prepare("SELECT type FROM notes WHERE slug = ?").get(slug);
      if (!note) return null;
      if (slug === ROOT_HUB) return { trail: [], inHub: String(note.type) === "hub" };

      const linkers = db.db.prepare(
        `SELECT l.from_slug, l.to_slug, l.ord, n.title
         FROM links l JOIN notes n ON n.slug = l.from_slug
         WHERE n.type = 'hub' AND l.to_slug IN (SELECT value FROM json_each(?))`,
      );
      const found = new Map<string, { title: string; links: Array<{ to: string; ord: number }> }>();
      const reached = new Set([slug]);
      for (let level = [slug]; level.length > 0; ) {
        const next: string[] = [];
        for (const r of linkers.all(JSON.stringify(level))) {
          const from = String(r.from_slug);
          let hub = found.get(from);
          if (!hub) found.set(from, (hub = { title: String(r.title), links: [] }));
          hub.links.push({ to: String(r.to_slug), ord: Number(r.ord) });
          if (!reached.has(from)) {
            reached.add(from);
            if (from !== ROOT_HUB) next.push(from);
          }
        }
        level = next;
      }

      const hubs = new Map<string, HubLinks>();
      for (const [hubSlug, hub] of found) {
        hubs.set(hubSlug, { title: hub.title, links: hub.links.sort((a, b) => a.ord - b.ord).map((l) => l.to) });
      }
      return findTrail(hubs, slug);
    });

  const isMentioned = (absolutePath: string): Promise<boolean> =>
    live((db) => {
      if (!checkDrivePath(absolutePath).ok) return false;
      return db.db.prepare("SELECT 1 FROM mentions WHERE key = ? LIMIT 1").get(pathKey(absolutePath)) !== undefined;
    });

  const hubMembership = (): Promise<HubMembershipReport> =>
    live((db) => {
      const rows = db.db
        .prepare(
          `SELECT n.slug, h.slug AS hub
           FROM notes n
           LEFT JOIN links l ON l.to_slug = n.slug
           LEFT JOIN notes h ON h.slug = l.from_slug AND h.type = 'hub'
           WHERE n.type = 'note'
           ORDER BY n.slug, h.slug`,
        )
        .all();
      const hubsOf = new Map<string, string[]>();
      for (const r of rows) {
        const slug = String(r.slug);
        const listed = hubsOf.get(slug) ?? [];
        if (r.hub !== null && r.hub !== undefined) listed.push(String(r.hub));
        hubsOf.set(slug, listed);
      }
      const report: HubMembershipReport = { notesWithoutHub: [], notesInSeveralHubs: [] };
      for (const [slug, hubs] of hubsOf) {
        if (hubs.length === 0) report.notesWithoutHub.push({ slug });
        else if (hubs.length > 1) report.notesInSeveralHubs.push({ slug, hubs });
      }
      return report;
    });

  const invalid = (): Promise<InvalidNote[]> =>
    live((db) =>
      db.db
        .prepare("SELECT path, error FROM invalid ORDER BY path")
        .all()
        .map((r) => ({ path: String(r.path), error: String(r.error) })),
    );

  const stats = () => live(countRows);

  // ---- lifecycle ----------------------------------------------------------

  const open = async (): Promise<void> => {
    while (swapping) await swapping;
    if (idx) return;
    // A rebuild file with no rebuild running is what a crash or kill mid-rebuild leaves.
    const built = buildingPath(opts.dbPath);
    if (!rebuilding && databaseFilesExist(built)) {
      try {
        removeDatabaseFiles(built);
        log(`removed an unfinished index rebuild: ${built}`);
      } catch (err) {
        log(`could not remove an unfinished index rebuild, ${built}: ${errorMessage(err)}`);
      }
    }
    idx = openDb(opts.dbPath);
  };

  const close = async (): Promise<void> => {
    while (swapping) await swapping;
    if (!idx) return;
    idx.close();
    idx = null;
  };

  const warm = async (): Promise<void> => {
    if (opts.embeddings === false) return;
    try {
      const vectors = await embedder.embed(["warm up"]);
      if (!vectors) log("embedding warm-up: model unavailable, search falls back to keywords");
    } catch (err) {
      log(`embedding warm-up failed: ${errorMessage(err)}`);
    }
  };

  return {
    open,
    close,
    warm,
    rebuild,
    upsertNote,
    removeNote,
    upsertFile,
    removeFile,
    recordInvalid,
    search,
    backlinks,
    trail,
    isMentioned,
    hubMembership,
    invalid,
    stats,
  };
}
