/**
 * SQLite schema and access for the search index.
 *
 * The index is a cache. When the schema version, embedding model, or vector
 * dimensions recorded in `meta` differ from the running code, everything is
 * dropped and recreated; `rebuild` fills it again from disk.
 *
 * Vectors are always kept as Float32Array BLOBs in `chunk_vectors` (the JS
 * cosine path reads these). When the sqlite-vec extension loads, a `chunk_vec`
 * vec0 table mirrors them for KNN. Keeping both means the index survives the
 * extension appearing or disappearing between runs.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";

export const SCHEMA_VERSION = "1";

export type Row = Record<string, SQLOutputValue>;

export interface IndexDb {
  readonly db: DatabaseSync;
  /** True when sqlite-vec loaded and `chunk_vec` exists. */
  readonly vec: boolean;
  readonly dims: number;
  readonly model: string;
  /** Run `fn` inside a transaction (or a savepoint when already inside one). */
  tx<T>(fn: () => T): T;
  close(): void;
}

export interface OpenDbOptions {
  path: string;
  dims: number;
  model: string;
  /** Try to load sqlite-vec. Default true. */
  vec?: boolean;
  log?: (msg: string) => void;
}

const TABLES = [
  "notes_fts",
  "files_fts",
  "notes",
  "links",
  "chunks",
  "chunk_vectors",
  "files",
  "invalid",
  "meta",
];

export function openIndexDb(opts: OpenDbOptions): IndexDb {
  fs.mkdirSync(path.dirname(opts.path), { recursive: true });
  const db = new DatabaseSync(opts.path, { allowExtension: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=OFF");

  const log = opts.log ?? (() => {});
  const vec = opts.vec === false ? false : tryLoadVec(db, log);
  if (opts.vec !== false && !vec) {
    log("sqlite-vec unavailable, semantic search will use in-process cosine similarity");
  }
  db.enableLoadExtension(false);

  migrate(db, opts, vec);

  const tx = <T>(fn: () => T): T => {
    if (db.isTransaction) {
      db.exec("SAVEPOINT sp");
      try {
        const out = fn();
        db.exec("RELEASE sp");
        return out;
      } catch (err) {
        db.exec("ROLLBACK TO sp");
        db.exec("RELEASE sp");
        throw err;
      }
    }
    db.exec("BEGIN");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  return {
    db,
    vec,
    dims: opts.dims,
    model: opts.model,
    tx,
    close: () => db.close(),
  };
}

function tryLoadVec(db: DatabaseSync, log: (msg: string) => void): boolean {
  try {
    db.enableLoadExtension(true);
    db.loadExtension(sqliteVec.getLoadablePath());
    db.prepare("SELECT vec_version() AS v").get();
    return true;
  } catch (err) {
    log(`sqlite-vec failed to load: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function readMeta(db: DatabaseSync): Map<string, string> {
  const out = new Map<string, string>();
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get();
  if (!exists) return out;
  for (const row of db.prepare("SELECT key, value FROM meta").all()) {
    out.set(String(row.key), String(row.value));
  }
  return out;
}

function migrate(db: DatabaseSync, opts: OpenDbOptions, vec: boolean): void {
  const meta = readMeta(db);
  const fresh =
    meta.get("schema_version") !== SCHEMA_VERSION ||
    meta.get("model") !== opts.model ||
    meta.get("dims") !== String(opts.dims);

  if (fresh) dropAll(db);
  createSchema(db, opts.dims, vec);

  const hadVec = meta.get("vec") === "1";
  if (vec && (!hadVec || fresh)) {
    // The vec0 table is new (or was unavailable last run): fill it from the BLOB copy.
    refillVec(db);
  }

  const put = db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)");
  put.run("schema_version", SCHEMA_VERSION);
  put.run("model", opts.model);
  put.run("dims", String(opts.dims));
  put.run("vec", vec ? "1" : "0");
}

function dropAll(db: DatabaseSync): void {
  for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
  try {
    db.exec("DROP TABLE IF EXISTS chunk_vec");
  } catch {
    // vec0 module not loaded: the table cannot be dropped, but it is also unreachable.
  }
}

function createSchema(db: DatabaseSync, dims: number, vec: boolean): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notes(
      slug TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      body TEXT NOT NULL,
      mtime_ms REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_path ON notes(path);
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      slug UNINDEXED, title, summary, tags, body, tokenize = 'porter unicode61'
    );
    CREATE TABLE IF NOT EXISTS links(
      from_slug TEXT NOT NULL,
      to_slug TEXT NOT NULL,
      PRIMARY KEY (from_slug, to_slug)
    );
    CREATE INDEX IF NOT EXISTS links_to ON links(to_slug);
    CREATE TABLE IF NOT EXISTS chunks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      ord INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_slug ON chunks(slug);
    CREATE TABLE IF NOT EXISTS chunk_vectors(
      chunk_id INTEGER PRIMARY KEY,
      embedding BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files(
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      ext TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      path UNINDEXED, title, text, tokenize = 'porter unicode61'
    );
    CREATE TABLE IF NOT EXISTS invalid(path TEXT PRIMARY KEY, error TEXT NOT NULL);
  `);
  if (vec) {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dims}])`);
  }
}

function refillVec(db: DatabaseSync): void {
  db.exec("DELETE FROM chunk_vec");
  const insert = db.prepare("INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)");
  for (const row of db.prepare("SELECT chunk_id, embedding FROM chunk_vectors").all()) {
    insert.run(BigInt(Number(row.chunk_id)), row.embedding as Uint8Array);
  }
}

/** Decode a BLOB column back into the Float32Array it was stored from. */
export function blobToVector(blob: SQLOutputValue | undefined): Float32Array {
  if (!(blob instanceof Uint8Array)) return new Float32Array(0);
  const bytes = blob;
  // Copy so the view is 4-byte aligned regardless of the source offset.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

export function vectorToBlob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}
