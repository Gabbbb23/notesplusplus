import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { TagName } from "@/components/badges";
import { LoadingCards } from "@/components/item-card";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorAlert } from "@/components/page-state";
import { SearchInput } from "@/components/search-input";
import { SearchResults } from "@/components/search-results";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import type { NoteType, SearchMode } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

const MODES: Array<{ value: SearchMode; label: string; hint: string }> = [
  { value: "hybrid", label: "Smart", hint: "Keywords and meaning combined" },
  { value: "keyword", label: "Keywords", hint: "Exact words only" },
  { value: "semantic", label: "Semantic", hint: "By meaning, even with different words" },
];
const TYPES: NoteType[] = ["note", "hub", "source"];
const ANY = "__any__";

function asMode(v: string | null): SearchMode {
  return v === "keyword" || v === "semantic" ? v : "hybrid";
}
function asType(v: string | null): NoteType | undefined {
  return TYPES.includes(v as NoteType) ? (v as NoteType) : undefined;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const mode = asMode(params.get("mode"));
  const tag = params.get("tag") ?? "";
  const type = asType(params.get("type"));

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
    () => api.search(q, { limit: 50, mode, tag: tag || undefined, type }),
    [q, mode, tag, type],
    q !== "",
  );

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
      <PageHeader title="Search" />
      <form onSubmit={submit} className="mb-8 space-y-4" role="search" aria-label="Search notes and files">
        <div className="flex gap-2">
          <SearchInput
            value={draftQ}
            onChange={setDraftQ}
            placeholder="What are you looking for?"
            label="Query"
            autoFocus
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
      {q !== "" && results.loading && <LoadingCards count={4} />}
      {q !== "" && results.error && <ErrorAlert error={results.error} />}
      {q !== "" && results.data && !results.loading && <SearchResults results={results.data} query={q} />}
    </>
  );
}
