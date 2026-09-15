/**
 * SearchIndex implementation: a rebuildable SQLite cache over the store.
 *
 * See db.ts (schema), embeddings.ts (model + chunking), extract.ts (file text),
 * search.ts (ranking). All SQL is synchronous through node:sqlite; the public
 * interface is async to match the contract in types.ts.
 */

import path from "node:path";
import type {
  FileEntry,
  IndexStats,
  InvalidNote,
  Note,
  NoteStore,
  NoteSummary,
  NoteType,
  SearchIndex,
  SearchOptions,
  SearchResult,
} from "../types.ts";
import { openIndexDb, vectorToBlob, type IndexDb } from "./db.ts";
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

export function createIndex(opts: IndexOptions): LocalSearchIndex {
  const log = opts.log ?? (() => {});
  const embedder: Embedder =
    opts.embeddings === false
      ? disabledEmbedder()
      : (opts.embedder ?? createEmbedder({ modelCachePath: opts.modelCachePath, log }));

  let idx: IndexDb | null = null;

  const need = (): IndexDb => {
    if (!idx) throw new Error("search index is not open: call open() first");
    return idx;
  };

  // ---- writes -------------------------------------------------------------

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
    const row = db.db.prepare("SELECT id FROM notes WHERE slug = ?").get(slug);
    if (row) {
      db.db.prepare("DELETE FROM notes_fts WHERE rowid = ?").run(Number(row.id));
      db.db.prepare("DELETE FROM notes WHERE id = ?").run(Number(row.id));
    }
  };

  const upsertNote = async (note: Note): Promise<void> => {
    const db = need();
    let chunks = chunkBody(note.body);
    if (chunks.length === 0) chunks = [note.summary.trim() || note.title];

    let vectors: Float32Array[] | null = null;
    if (opts.embeddings !== false) {
      vectors = await embedder.embed(chunks.map((c) => chunkEmbeddingText(note.title, c)));
      if (vectors && vectors.length !== chunks.length) vectors = null;
    }

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

      const link = db.db.prepare("INSERT OR IGNORE INTO links(from_slug, to_slug) VALUES (?, ?)");
      for (const to of note.links) link.run(note.slug, to);

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

  const removeNote = async (slug: string): Promise<void> => {
    const db = need();
    db.tx(() => deleteNoteRows(db, slug));
  };

  const deleteFileRows = (db: IndexDb, filePath: string): void => {
    const row = db.db.prepare("SELECT id FROM files WHERE path = ?").get(filePath);
    if (!row) return;
    db.db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(Number(row.id));
    db.db.prepare("DELETE FROM files WHERE id = ?").run(Number(row.id));
  };

  const upsertFile = async (file: FileEntry, absolutePath: string): Promise<void> => {
    const db = need();
    const text = await extractFileText(absolutePath, file.ext);
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

  const removeFile = async (filePath: string): Promise<void> => {
    const db = need();
    db.tx(() => deleteFileRows(db, filePath));
  };

  const recordInvalid = async (invalid: InvalidNote): Promise<void> => {
    const db = need();
    db.tx(() => {
      const stale = db.db.prepare("SELECT slug FROM notes WHERE path = ?").all(invalid.path);
      for (const row of stale) deleteNoteRows(db, String(row.slug));
      db.db
        .prepare("INSERT OR REPLACE INTO invalid(path, error) VALUES (?, ?)")
        .run(invalid.path, invalid.error);
    });
  };

  const clearAll = (db: IndexDb): void => {
    db.tx(() => {
      for (const t of ["notes_fts", "files_fts", "notes", "links", "chunks", "chunk_vectors", "files", "invalid"]) {
        db.db.exec(`DELETE FROM ${t}`);
      }
      if (db.vec) db.db.exec("DELETE FROM chunk_vec");
    });
  };

  const rebuild = async (store: NoteStore): Promise<IndexStats> => {
    const db = need();
    const started = performance.now();
    let notes = 0;
    let invalidCount = 0;
    let files = 0;

    db.db.exec("BEGIN");
    try {
      clearAll(db);
      for await (const item of store.readAll()) {
        if ("slug" in item) {
          await upsertNote(item);
          notes++;
          if (notes % PROGRESS_EVERY === 0) log(`indexed ${notes} notes…`);
        } else {
          await recordInvalid(item);
          invalidCount++;
        }
      }
      for (const entry of await store.files()) {
        await upsertFile(entry, store.resolve(entry.path));
        files++;
      }
      db.db.exec("COMMIT");
    } catch (err) {
      if (db.db.isTransaction) db.db.exec("ROLLBACK");
      throw err;
    }

    const durationMs = Math.round(performance.now() - started);
    log(`index rebuilt: ${notes} notes, ${files} files, ${invalidCount} invalid in ${durationMs} ms`);
    return { notes, files, invalid: invalidCount, durationMs };
  };

  // ---- reads --------------------------------------------------------------

  const search = async (query: string, options: SearchOptions = {}): Promise<SearchResult[]> => {
    const db = need();
    if (query.trim().length === 0) return [];
    const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    const includeFiles = options.includeFiles ?? true;
    const filters = { tag: options.tag, type: options.type };
    const mode = options.mode ?? "hybrid";

    if (mode === "keyword" || opts.embeddings === false) {
      return keywordSearch(db, query, filters, includeFiles, limit);
    }
    if (mode === "semantic") {
      const hits = await semanticSearch(db, embedder, query, filters, limit);
      // Model unavailable: degrade to keyword-only rather than failing.
      return hits ?? keywordSearch(db, query, filters, includeFiles, limit);
    }
    return hybridSearch(db, embedder, query, filters, includeFiles, limit);
  };

  const backlinks = async (slug: string): Promise<NoteSummary[]> => {
    const db = need();
    const rows = db.db
      .prepare(
        `SELECT n.slug, n.path, n.title, n.type, n.summary, n.tags_json, n.created, n.updated
         FROM links l JOIN notes n ON n.slug = l.from_slug
         WHERE l.to_slug = ?
         ORDER BY n.title COLLATE NOCASE, n.slug`,
      )
      .all(slug);
    return rows.map((r) => ({
      slug: String(r.slug),
      path: String(r.path),
      title: String(r.title),
      type: String(r.type) as NoteType,
      summary: String(r.summary),
      tags: JSON.parse(String(r.tags_json)) as string[],
      created: String(r.created),
      updated: String(r.updated),
    }));
  };

  const invalid = async (): Promise<InvalidNote[]> => {
    const db = need();
    return db.db
      .prepare("SELECT path, error FROM invalid ORDER BY path")
      .all()
      .map((r) => ({ path: String(r.path), error: String(r.error) }));
  };

  const stats = async (): Promise<Omit<IndexStats, "durationMs">> => {
    const db = need();
    const count = (table: string): number =>
      Number(db.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c ?? 0);
    return { notes: count("notes"), files: count("files"), invalid: count("invalid") };
  };

  // ---- lifecycle ----------------------------------------------------------

  const open = async (): Promise<void> => {
    if (idx) return;
    idx = openIndexDb({
      path: opts.dbPath,
      dims: embedder.dims,
      model: embedder.model,
      vec: opts.vec,
      log,
    });
  };

  const close = async (): Promise<void> => {
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
      log(`embedding warm-up failed: ${err instanceof Error ? err.message : String(err)}`);
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
    invalid,
    stats,
  };
}
