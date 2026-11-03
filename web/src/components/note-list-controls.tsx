import type { ReactNode } from "react";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NOTE_SORT_OPTIONS, type NoteListFilters } from "@/lib/note-list-filters";
import type { NoteSort, NoteType } from "@/lib/types";

const ANY_TYPE = "__any__";

/**
 * The controls above a note list that narrow and order it: the filter field on its own line, then the
 * type and sort chip menus and Clear filters while a filter is on. `trailing` goes at the right end of the
 * chip row, such as the Tag page's ViewSwitch. State comes from useNoteListFilters, so it lives in the URL.
 */
export function NoteListControls({
  filters,
  types,
  trailing,
}: {
  filters: NoteListFilters;
  types: readonly NoteType[];
  trailing?: ReactNode;
}) {
  return (
    <div data-slot="note-list-controls" className="mb-6 flex min-w-0 flex-col gap-3">
      <SearchInput
        shape="box"
        value={filters.draft}
        onChange={filters.setDraft}
        label="Filter notes"
        placeholder="Filter by title or summary"
        name="q"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.type ?? ANY_TYPE}
          onValueChange={(v) => filters.setType(types.find((t) => t === v))}
        >
          <SelectTrigger size="chip" aria-label="Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_TYPE}>Any type</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.sort} onValueChange={(v) => filters.setSort(v as NoteSort)}>
          <SelectTrigger size="chip" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTE_SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filters.filtered && (
          <Button variant="text" size="small" onClick={filters.clear}>
            Clear filters
          </Button>
        )}
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>
    </div>
  );
}
