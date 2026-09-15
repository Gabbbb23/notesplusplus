/**
 * Keyword, semantic, and hybrid ranking over the index tables.
 *
 * Keyword: stop words dropped, then FTS5 MATCH with bm25 ranking and snippet()
 * excerpts, over notes and (optionally) files. Semantic: nearest chunks to the
 * query vector (sqlite-vec KNN or in-process cosine) above a similarity floor,
 * best chunk per note. Hybrid: reciprocal rank fusion of the two lists. Every
 * result set is sorted by descending score.
 *
 * Everything here is synchronous and takes an already embedded query, so a caller
 * can embed first and then run all of a search's SQL without yielding in between.
 */

import type { NoteType, SearchResult } from "../types.ts";
import { blobToVector, type IndexDb, type Row } from "./db.ts";

export interface SearchFilters {
  tag?: string;
  type?: NoteType;
}

/**
 * How many candidates each ranked list contributes before fusion or truncation. On 2026-09-15, 20 candidates moved
 * hybrid MRR by +0.003 on 30 held-out queries and not at all on 33 development queries, short of the 0.02 required.
 */
export const CANDIDATES = 50;
/** How many chunks the KNN step looks at before aggregating per note. */
const KNN_CHUNKS = 300;
export const RRF_K = 60;

/**
 * bm25 weights, one per FTS5 column in table order (db.ts). FTS5 counts UNINDEXED columns too, so `slug` and
 * `path` take a placeholder 0 that never applies: an unindexed column never matches.
 */
export const NOTE_BM25_WEIGHTS = { slug: 0, title: 4, summary: 3, tags: 2, body: 1 } as const;
export const FILE_BM25_WEIGHTS = { path: 0, title: 3, text: 1 } as const;

const bm25Args = (weights: Record<string, number>): string =>
  Object.values(weights)
    .map((w) => w.toFixed(1))
    .join(", ");

/**
 * Lowest cosine similarity (0 to 1, normalized bge vectors) a chunk needs to
 * count as a semantic match. Below it, semantic search drops the chunk, so it
 * never reaches hybrid fusion either. Measured on the owner's brain: semantic
 * results for queries with no answer went from 50 to 0 while 97% of correct
 * answers stayed.
 */
export const SEMANTIC_FLOOR = 0.55;

/**
 * Words dropped from keyword queries: English function words plus common
 * Tagalog ones. Kept, they make the AND step demand words like "is" and "the"
 * and let the OR fallback match nearly every note.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  // English. Words that often carry meaning in a query ("not", "May", "below") are left out.
  "a", "an", "the", "and", "or", "but", "nor", "so", "if", "then", "than", "because", "while",
  "of", "in", "on", "at", "to", "for", "from", "by", "with", "about", "into", "onto", "as",
  "between", "through", "during", "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "doing", "have", "has", "had", "having",
  "will", "would", "shall", "should", "can", "could", "might", "must",
  "i", "me", "my", "mine", "we", "us", "our", "ours", "you", "your", "yours", "he", "him", "his",
  "she", "her", "hers", "it", "its", "they", "them", "their", "theirs",
  "this", "that", "these", "those", "there", "here",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  "all", "any", "some", "each", "every", "such", "just", "also",
  "what's", "who's", "where's", "when's", "how's", "it's", "that's", "there's", "i'm",
  // Tagalog
  "ang", "ng", "mga", "sa", "na", "at", "ay", "si", "ni", "kay", "ko", "mo", "ba", "po", "nga",
  "kung", "para", "pag", "sino", "ano", "kailan", "nasaan", "bakit",
]);

/**
 * True when a query term is a stop word. Case and surrounding punctuation are
 * ignored, except that a term of two or more capitals ("IT", "US", "WHO") reads
 * as an acronym and is kept.
 */
export function isStopWord(term: string): boolean {
  const bare = term.replace(/’/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (bare.length > 1 && /\p{Lu}/u.test(bare) && bare === bare.toUpperCase()) return false;
  return STOP_WORDS.has(bare.toLowerCase());
}

/** Split a query on whitespace and drop stop words. A query of only stop words keeps all its terms. */
export function keywordTerms(query: string): string[] {
  const terms = query.split(/\s+/).filter((t) => t.length > 0);
  const content = terms.filter((t) => !isStopWord(t));
  return content.length > 0 ? content : terms;
}

/**
 * Build an FTS5 MATCH expression from free text, without stop words. Every term
 * is double-quoted (inner quotes doubled) so operators and punctuation in the
 * query are literal.
 */
export function buildMatchExpression(query: string, joiner: " " | " OR " = " "): string {
  return keywordTerms(query)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(joiner);
}

/** Reciprocal rank fusion. Each list is ordered best first; ids may repeat across lists. */
export function reciprocalRankFusion(lists: string[][], k: number = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return scores;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** The JS fallback for KNN: cosine similarity over every stored vector, top `k`. */
export function cosineTopK(
  query: Float32Array,
  rows: Iterable<{ id: number; vector: Float32Array }>,
  k: number,
): Array<{ id: number; similarity: number }> {
  const scored: Array<{ id: number; similarity: number }> = [];
  for (const row of rows) scored.push({ id: row.id, similarity: cosine(query, row.vector) });
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}

interface NoteHit {
  slug: string;
  path: string;
  title: string;
  type: NoteType;
  summary: string;
  tags: string[];
  snippet: string;
  score: number;
}

interface FileHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

function filterSql(filters: SearchFilters, alias: string): { sql: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.type) {
    clauses.push(`${alias}.type = ?`);
    params.push(filters.type);
  }
  if (filters.tag) {
    clauses.push(`EXISTS (SELECT 1 FROM json_each(${alias}.tags_json) WHERE json_each.value = ?)`);
    params.push(filters.tag);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", params };
}

function parseTags(json: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(json));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function noteRowToHit(row: Row, snippet: string, score: number): NoteHit {
  return {
    slug: String(row.slug),
    path: String(row.path),
    title: String(row.title),
    type: String(row.type) as NoteType,
    summary: String(row.summary),
    tags: parseTags(row.tags_json),
    snippet,
    score,
  };
}

function keywordNotes(idx: IndexDb, match: string, filters: SearchFilters, limit: number): NoteHit[] {
  const f = filterSql(filters, "n");
  const rows = idx.db
    .prepare(
      `SELECT n.slug, n.path, n.title, n.type, n.summary, n.tags_json,
              bm25(notes_fts, ${bm25Args(NOTE_BM25_WEIGHTS)}) AS rank,
              snippet(notes_fts, -1, '«', '»', '…', 24) AS snippet
       FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid
       WHERE notes_fts MATCH ?${f.sql}
       ORDER BY rank LIMIT ?`,
    )
    .all(match, ...f.params, limit);
  return rows.map((r) => noteRowToHit(r, String(r.snippet ?? ""), -Number(r.rank)));
}

function keywordFiles(idx: IndexDb, match: string, limit: number): FileHit[] {
  const rows = idx.db
    .prepare(
      `SELECT f.path, f.title, bm25(files_fts, ${bm25Args(FILE_BM25_WEIGHTS)}) AS rank,
              snippet(files_fts, -1, '«', '»', '…', 24) AS snippet
       FROM files_fts JOIN files f ON f.id = files_fts.rowid
       WHERE files_fts MATCH ?
       ORDER BY rank LIMIT ?`,
    )
    .all(match, limit);
  return rows.map((r) => ({
    path: String(r.path),
    title: String(r.title),
    snippet: String(r.snippet ?? ""),
    score: -Number(r.rank),
  }));
}

function toResult(hit: NoteHit | FileHit, score: number): SearchResult {
  if ("slug" in hit) {
    return {
      kind: "note",
      id: hit.slug,
      path: hit.path,
      title: hit.title,
      summary: hit.summary,
      snippet: hit.snippet,
      score,
      tags: hit.tags,
      type: hit.type,
    };
  }
  return {
    kind: "file",
    id: hit.path,
    path: hit.path,
    title: hit.title,
    summary: "",
    snippet: hit.snippet,
    score,
    tags: [],
  };
}

/** Keyword search: notes and files merged and sorted by bm25. Retries with OR when AND finds nothing. */
export function keywordSearch(
  idx: IndexDb,
  query: string,
  filters: SearchFilters,
  includeFiles: boolean,
  limit: number,
): SearchResult[] {
  // Files carry no tags or type, so a filter on either excludes them.
  const withFiles = includeFiles && !filters.tag && !filters.type;
  const run = (match: string): SearchResult[] => {
    if (match.length === 0) return [];
    const hits: SearchResult[] = keywordNotes(idx, match, filters, limit).map((h) => toResult(h, h.score));
    if (withFiles) {
      for (const h of keywordFiles(idx, match, limit)) hits.push(toResult(h, h.score));
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  };
  const strict = run(buildMatchExpression(query, " "));
  if (strict.length > 0) return strict;
  return run(buildMatchExpression(query, " OR "));
}

function nearestChunks(idx: IndexDb, vector: Float32Array, k: number): Array<{ id: number; similarity: number }> {
  if (idx.vec) {
    const rows = idx.db
      .prepare(
        `SELECT chunk_id, distance FROM chunk_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
      )
      .all(vector, BigInt(k));
    // vec0 reports L2 distance; for unit vectors cos = 1 - d^2 / 2.
    return rows.map((r) => {
      const d = Number(r.distance);
      return { id: Number(r.chunk_id), similarity: 1 - (d * d) / 2 };
    });
  }
  const rows = idx.db.prepare("SELECT chunk_id, embedding FROM chunk_vectors").all();
  return cosineTopK(
    vector,
    rows.map((r) => ({ id: Number(r.chunk_id), vector: blobToVector(r.embedding) })),
    k,
  );
}

/**
 * Semantic search for an embedded query: best chunk per note, filtered, top `limit`. Chunks below
 * SEMANTIC_FLOOR are ignored, so a query with no close match returns [].
 */
export function semanticSearch(idx: IndexDb, qv: Float32Array, filters: SearchFilters, limit: number): SearchResult[] {
  const nearest = nearestChunks(idx, qv, KNN_CHUNKS).filter((c) => c.similarity >= SEMANTIC_FLOOR);
  if (nearest.length === 0) return [];

  const chunkStmt = idx.db.prepare("SELECT slug, text FROM chunks WHERE id = ?");
  const best = new Map<string, { similarity: number; text: string }>();
  for (const { id, similarity } of nearest) {
    const row = chunkStmt.get(id);
    if (!row) continue;
    const slug = String(row.slug);
    const prev = best.get(slug);
    if (!prev || similarity > prev.similarity) best.set(slug, { similarity, text: String(row.text) });
  }

  const f = filterSql(filters, "n");
  const noteStmt = idx.db.prepare(
    `SELECT n.slug, n.path, n.title, n.type, n.summary, n.tags_json FROM notes n WHERE n.slug = ?${f.sql}`,
  );
  const hits: SearchResult[] = [];
  for (const [slug, { similarity, text }] of best) {
    const row = noteStmt.get(slug, ...f.params);
    if (!row) continue;
    hits.push(toResult(noteRowToHit(row, text.slice(0, 200), similarity), similarity));
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/**
 * Hybrid: reciprocal rank fusion of the keyword and semantic lists, each list counting in full, including a
 * keyword list that fell back to OR. `qv` is the embedded query, or null when the model is unavailable, which
 * leaves the keyword list alone.
 *
 * Counting an OR fallback at half weight was checked on 2026-09-15 and not adopted: it lowered hybrid MRR by 0.019
 * on 30 held-out queries and left 33 development queries unchanged.
 */
export function hybridSearch(
  idx: IndexDb,
  qv: Float32Array | null,
  query: string,
  filters: SearchFilters,
  includeFiles: boolean,
  limit: number,
): SearchResult[] {
  const keyword = keywordSearch(idx, query, filters, includeFiles, CANDIDATES);
  const semantic = qv ? semanticSearch(idx, qv, filters, CANDIDATES) : [];
  if (semantic.length === 0) return keyword.slice(0, limit);

  const key = (r: SearchResult) => `${r.kind}:${r.id}`;
  const fused = reciprocalRankFusion([keyword.map(key), semantic.map(key)]);

  // Prefer the keyword hit (its snippet carries match markers) when both lists have the item.
  const byKey = new Map<string, SearchResult>();
  for (const r of semantic) byKey.set(key(r), r);
  for (const r of keyword) byKey.set(key(r), r);

  const out: SearchResult[] = [];
  for (const [k, score] of fused) {
    const r = byKey.get(k);
    if (r) out.push({ ...r, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
