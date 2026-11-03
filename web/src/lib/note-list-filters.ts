import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { NoteSort, NoteType } from "./types";

/*
 * The filter field, sort, and type of a note list, kept in the URL as q, sort, and type so Back, reload,
 * and a copied link all show the same list. Each is left out of the URL at its default. Changes replace
 * the history entry, so Back leaves the page in one step instead of undoing one keystroke at a time.
 */

/** The orders GET /api/notes offers, as the sort menu names them. Title is the default. */
export const NOTE_SORT_OPTIONS: ReadonlyArray<{ value: NoteSort; label: string }> = [
  { value: "title", label: "Title A to Z" },
  { value: "created", label: "Recently added" },
  { value: "updated", label: "Recently updated" },
];

/** How long typing must pause before the filter field's text reaches the URL and the server. */
export const FILTER_DELAY_MS = 250;

export interface NoteListFilters {
  /** Words every listed note holds in its title or summary, as the URL has them. "" for none. */
  q: string;
  sort: NoteSort;
  /** undefined for any type. */
  type: NoteType | undefined;
  /** The filter field's text. It becomes q once typing pauses for FILTER_DELAY_MS. */
  draft: string;
  setDraft: (value: string) => void;
  setSort: (sort: NoteSort) => void;
  setType: (type: NoteType | undefined) => void;
  /** Empties the filter field and drops the type at once. The sort stays. */
  clear: () => void;
  /** q or type narrows the list. */
  filtered: boolean;
}

function asSort(value: string | null): NoteSort {
  return value === "created" || value === "updated" ? value : "title";
}

/** `types` are the types the list offers; a type in the URL outside them counts as any type. */
export function useNoteListFilters(types: readonly NoteType[]): NoteListFilters {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const sort = asSort(params.get("sort"));
  const typeParam = params.get("type");
  const type = types.find((t) => t === typeParam);

  const update = useCallback(
    (changes: Record<string, string | undefined>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [draft, setDraft] = useState(q);
  // The q this hook last wrote, so its own URL change does not overwrite text typed since.
  const written = useRef(q);

  // Back, a link, or clear() changed q: show it in the field.
  useEffect(() => {
    if (q === written.current) return;
    written.current = q;
    setDraft(q);
  }, [q]);

  useEffect(() => {
    const next = draft.trim();
    if (next === q) return;
    const timer = setTimeout(() => {
      written.current = next;
      update({ q: next });
    }, FILTER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, q, update]);

  const setSort = useCallback((value: NoteSort) => update({ sort: value === "title" ? undefined : value }), [update]);
  const setType = useCallback((value: NoteType | undefined) => update({ type: value }), [update]);
  const clear = useCallback(() => {
    written.current = "";
    setDraft("");
    update({ q: undefined, type: undefined });
  }, [update]);

  return { q, sort, type, draft, setDraft, setSort, setType, clear, filtered: q !== "" || type !== undefined };
}
