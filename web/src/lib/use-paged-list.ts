import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useLocation } from "react-router";

/** The part of a paged response the hook reads, such as GET /api/notes's envelope. */
export interface Page<T> {
  items: T[];
  total: number;
}

export interface PagedList<T> {
  /** Every item loaded so far, in order. undefined until the first page arrives. */
  items: T[] | undefined;
  /** Items across all pages, as the latest page reported. */
  total: number | undefined;
  error: Error | undefined;
  /** A page is on its way: the first one, or the next one after more(). */
  loading: boolean;
  /** Fewer items are loaded than total. */
  hasMore: boolean;
  /**
   * items and total still belong to the previous deps while the first page for the new ones loads. Only happens
   * when `listKey` stayed the same; see usePagedList.
   */
  stale: boolean;
  /** Fetch the page at offset items.length and append it. Ignored while a page loads. */
  more: () => void;
  /**
   * Fetch the page that failed again: the first page when none has loaded, otherwise the next one.
   * Ignored while a page loads.
   */
  retry: () => void;
}

interface State<T> {
  items?: T[];
  total?: number;
  error?: Error;
  loading: boolean;
  /** A page came back empty: stop offering more even if total says otherwise. */
  exhausted?: boolean;
  /** items belong to the previous deps. */
  stale?: boolean;
}

/** The most items one request may ask for: the API's maximum `limit`. */
export const LIST_LIMIT_MAX = 500;

export const LOADED_COUNTS_STORAGE_KEY = "notesplusplus.list-pages";

/** How many lists' counts are kept; the oldest go first. */
const LOADED_COUNTS_LIMIT = 50;

/*
 * How many items each list had loaded, by history entry, so that Back and Forward find the list as
 * long as it was left: the Tag page after "Show more" had 100 notes, and the scroll position
 * remembered for it (components/history-nav.tsx) is only reachable with all 100 on the page. Kept in
 * memory and mirrored to session storage so a reload keeps it. A fresh visit to the same page is a
 * new history entry, so it starts at one page again.
 */
const loadedCounts = new Map<string, number>(readStoredCounts());

function readStoredCounts(): Array<[string, number]> {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(LOADED_COUNTS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is [string, number] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number")
      .slice(-LOADED_COUNTS_LIMIT);
  } catch {
    return [];
  }
}

function rememberLoadedCount(id: string, count: number) {
  loadedCounts.delete(id);
  loadedCounts.set(id, count);
  while (loadedCounts.size > LOADED_COUNTS_LIMIT) {
    const oldest = loadedCounts.keys().next().value;
    if (oldest === undefined) break;
    loadedCounts.delete(oldest);
  }
  try {
    window.sessionStorage.setItem(LOADED_COUNTS_STORAGE_KEY, JSON.stringify([...loadedCounts]));
  } catch {
    // Storage blocked or full: the count lives on in memory for this page load.
  }
}

/** Forget every remembered count. For tests. */
export function forgetLoadedCounts() {
  loadedCounts.clear();
}

/**
 * A list loaded a page at a time by offset. The first page loads when `deps` change; more() appends
 * the next page of `pageSize` items. A response for an older `deps` never lands. `fetchPage` gets the
 * offset and how many items to ask for.
 *
 * A change of `deps` drops everything loaded before, unless `listKey` is given and stays the same: then
 * the old rows stay on screen, marked `stale`, until the new first page replaces them, so narrowing a
 * list does not blank it on every keystroke. If that first page fails, the stale rows go and the error
 * shows alone. The Tag page passes the tag as `listKey` and its filters in `deps`.
 *
 * Coming back to a history entry (Back, Forward, a reload) the first request asks for as many items as
 * the list had loaded when it was left, so "Show more" does not have to be pressed again and the
 * remembered scroll position is reachable.
 */
export function usePagedList<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  deps: DependencyList,
  listKey?: string,
  pageSize = 50,
): PagedList<T> {
  const [state, setState] = useState<State<T>>({ loading: true });
  const generation = useRef(0);
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });
  const keyRef = useRef<{ key: string | undefined } | undefined>(undefined);
  const entryId = `${useLocation().key}|${listKey ?? ""}|${JSON.stringify(deps)}`;
  const entryRef = useRef(entryId);
  entryRef.current = entryId;

  const load = useCallback(
    (offset: number, limit: number) => {
      const gen = generation.current;
      const id = entryRef.current;
      setState((s) => ({ ...s, loading: true, error: undefined }));
      fetchRef.current(offset, limit).then(
        (page) => {
          if (gen !== generation.current) return;
          setState((s) => {
            const items = [...(s.items ?? []).slice(0, offset), ...page.items];
            rememberLoadedCount(id, items.length);
            return { items, total: page.total, loading: false, exhausted: offset > 0 && page.items.length === 0 };
          });
        },
        (err: unknown) => {
          if (gen !== generation.current) return;
          const error = err instanceof Error ? err : new Error(String(err));
          setState((s) => (s.stale ? { error, loading: false } : { ...s, error, loading: false }));
        },
      );
    },
    [],
  );

  useEffect(() => {
    generation.current++;
    const keep = listKey !== undefined && keyRef.current?.key === listKey;
    keyRef.current = { key: listKey };
    setState((s) => (keep && s.items !== undefined ? { items: s.items, total: s.total, loading: true, stale: true } : { loading: true }));
    const remembered = loadedCounts.get(entryRef.current) ?? 0;
    load(0, Math.min(Math.max(pageSize, remembered), LIST_LIMIT_MAX));
    return () => {
      generation.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const { items, total, error, loading, exhausted, stale = false } = state;
  const more = useCallback(() => {
    if (loading || items === undefined) return;
    load(items.length, pageSize);
  }, [loading, items, load, pageSize]);

  // A failed page never changes items, so the page to fetch again always starts at items.length.
  const retry = useCallback(() => {
    if (loading) return;
    load(items?.length ?? 0, pageSize);
  }, [loading, items, load, pageSize]);

  const hasMore = items !== undefined && total !== undefined && !exhausted && !stale && items.length < total;
  return { items, total, error, loading, hasMore, more, retry, stale };
}
