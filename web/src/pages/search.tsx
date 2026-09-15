import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { TagName } from "@/components/badges";
import { LoadingCards } from "@/components/item-card";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorAlert } from "@/components/page-state";
import { SearchInput } from "@/components/search-input";
import { SearchResults } from "@/components/search-results";
import { ShowMore, ShowMoreLimit, useFocusFirstNew } from "@/components/show-more";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { TOP_LEVEL_CRUMBS } from "@/lib/breadcrumb-items";
import type { NoteType, SearchMode } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

const MODES: Array<{ value: SearchMode; label: string; hint: string }> = [
  { value: "hybrid", label: "Smart", hint: "Keywords and meaning combined" },
  { value: "keyword", label: "Keywords", hint: "Exact words only" },
  { value: "semantic", label: "Semantic", hint: "By meaning, even with different words" },
];
const TYPES: NoteType[] = ["note", "hub", "source"];
const ANY = "__any__";

/**
 * Results per step and the most the server returns. "Show more results" re-runs the query with
 * the limit raised by a step instead of fetching an offset, so the ranking stays the same.
 * The limit lives in the URL as n (left out at the first step), so Back restores the longer list.
 */
const STEP = 20;
const MAX_RESULTS = 100;

function asMode(v: string | null): SearchMode {
  return v === "keyword" || v === "semantic" ? v : "hybrid";
}
function asType(v: string | null): NoteType | undefined {
  return TYPES.includes(v as NoteType) ? (v as NoteType) : undefined;
}
function asLimit(v: string | null): number {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(Math.max(n, STEP), MAX_RESULTS) : STEP;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const mode = asMode(params.get("mode"));
  const tag = params.get("tag") ?? "";
  const type = asType(params.get("type"));
  const limit = asLimit(params.get("n"));
  // Names the search apart from its limit: a larger n for the same key keeps the shown rows.
  const searchKey = JSON.stringify([q, mode, tag, type ?? ""]);

  // Draft form state; the URL is the source of truth once submitted.
  const [draftQ, setDraftQ] = useState(q);
  const [draftMode, setDraftMode] = useState<SearchMode>(mode);
  const [draftTag, setDraftTag] = useState(tag);
  const [draftType, setDraftType] = useState<string>(type ?? ANY);
  useEffect(() => {
    setDraftQ(q);
    setDraftMode(mode);
    setDraftTag(tag);
    setDraftType(type ?? ANY);
  }, [q, mode, tag, type]);

  const tags = useAsync(() => api.tags(), []);
  const results = useAsync(
    async () => ({ key: searchKey, limit, ...(await api.search(q, { limit, mode, tag: tag || undefined, type })) }),
    [q, mode, tag, type, limit],
    q !== "",
  );
  // The rows on screen: kept while a larger limit for the same search loads, dropped for a new search.
  const shown = results.data?.key === searchKey ? results.data : undefined;
  const { listRef, expectMore } = useFocusFirstNew(shown?.results.length ?? 0, searchKey);

  const showMore = () => {
    if (!shown) return;
    expectMore();
    const next = Math.min(shown.limit + STEP, MAX_RESULTS);
    // The URL already asks for that limit when the last attempt failed: try it again.
    if (next === limit) {
      results.reload();
      return;
    }
    const nextParams = new URLSearchParams(params);
    nextParams.set("n", String(next));
    // Replace, so Back leaves the search instead of shrinking the list a step at a time.
    setParams(nextParams, { replace: true });
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = draftQ.trim();
    const next = new URLSearchParams();
    if (trimmed) next.set("q", trimmed);
    if (draftMode !== "hybrid") next.set("mode", draftMode);
    if (draftTag) next.set("tag", draftTag);
    if (draftType !== ANY) next.set("type", draftType);
    setParams(next);
  };

  return (
    <>
      <PageHeader title="Search" tabTitle={q ? `Search: ${q}` : "Search"} breadcrumbs={TOP_LEVEL_CRUMBS} />
      <form onSubmit={submit} className="mb-8 space-y-4" role="search" aria-label="Search notes and files">
        <div className="flex gap-2">
          <SearchInput
            value={draftQ}
            onChange={setDraftQ}
            placeholder="What are you looking for?"
            label="Query"
            autoFocus
            shortcutTarget="page"
          />
          <Button type="submit" size="lg">
            Search
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            value={draftMode}
            onValueChange={(v) => {
              if (v) setDraftMode(asMode(v));
            }}
            aria-label="Search mode"
          >
            {MODES.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value} title={m.hint} className="bg-card px-3">
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={draftTag || ANY} onValueChange={(v) => setDraftTag(v === ANY ? "" : v)}>
            <SelectTrigger className="bg-card" aria-label="Tag filter">
              <SelectValue placeholder="Any tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any tag</SelectItem>
              {(tags.data ?? []).map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  <TagName name={t.name} />
                </SelectItem>
              ))}
              {draftTag && !(tags.data ?? []).some((t) => t.name === draftTag) && (
                <SelectItem value={draftTag}>
                  <TagName name={draftTag} />
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <Select value={draftType} onValueChange={setDraftType}>
            <SelectTrigger className="bg-card" aria-label="Type filter">
              <SelectValue placeholder="Any type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any type</SelectItem>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </form>

      {q === "" && <EmptyState>Type a query to search notes and files.</EmptyState>}
      {q !== "" && !shown && results.loading && <LoadingCards count={4} />}
      {shown && (
        <div ref={listRef}>
          <SearchResults results={shown.results} hasMore={shown.hasMore} query={q} />
        </div>
      )}
      {shown?.hasMore && shown.limit < MAX_RESULTS && (
        <ShowMore label="Show more results" loading={results.loading} onClick={showMore} />
      )}
      {shown?.hasMore && shown.limit >= MAX_RESULTS && (
        <ShowMoreLimit>Showing the top {MAX_RESULTS}. Refine the search to narrow it.</ShowMoreLimit>
      )}
      {q !== "" && results.error && (
        <div className={shown ? "mt-4" : undefined}>
          <ErrorAlert
            error={results.error}
            onRetry={() => {
              results.reload();
              if (tags.error) tags.reload();
            }}
          />
        </div>
      )}
    </>
  );
}
