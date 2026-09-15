import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

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
  /** Fetch the page at offset items.length and append it. Ignored while a page loads. */
  more: () => void;
}

interface State<T> {
  items?: T[];
  total?: number;
  error?: Error;
  loading: boolean;
  /** A page came back empty: stop offering more even if total says otherwise. */
  exhausted?: boolean;
}

/**
 * A list loaded a page at a time by offset. The first page loads when `deps` change, which also
 * drops everything loaded before; more() appends the next page. A response for an older `deps`
 * never lands.
 */
export function usePagedList<T>(fetchPage: (offset: number) => Promise<Page<T>>, deps: DependencyList): PagedList<T> {
  const [state, setState] = useState<State<T>>({ loading: true });
  const generation = useRef(0);
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });

  const load = useCallback((offset: number) => {
    const gen = generation.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fetchRef.current(offset).then(
      (page) => {
        if (gen !== generation.current) return;
        setState((s) => ({
          items: [...(s.items ?? []).slice(0, offset), ...page.items],
          total: page.total,
          loading: false,
          exhausted: offset > 0 && page.items.length === 0,
        }));
      },
      (err: unknown) => {
        if (gen !== generation.current) return;
        setState((s) => ({ ...s, error: err instanceof Error ? err : new Error(String(err)), loading: false }));
      },
    );
  }, []);

  useEffect(() => {
    generation.current++;
    setState({ loading: true });
    load(0);
    return () => {
      generation.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const { items, total, error, loading, exhausted } = state;
  const more = useCallback(() => {
    if (loading || items === undefined) return;
    load(items.length);
  }, [loading, items, load]);

  const hasMore = items !== undefined && total !== undefined && !exhausted && items.length < total;
  return { items, total, error, loading, hasMore, more };
}
