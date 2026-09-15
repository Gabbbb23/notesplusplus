import { KindBadge, TagBadges, type Kind } from "@/components/badges";
import { BreakableText } from "@/components/breakable-text";
import { FileLink } from "@/components/file-actions";
import { CardList, ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/page-state";
import { Snippet } from "@/components/snippet";
import { noteUrl } from "@/lib/api";
import { plural } from "@/lib/format";
import type { SearchResult } from "@/lib/types";

function kindOf(r: SearchResult): Kind {
  return r.kind === "note" ? (r.type ?? "note") : "file";
}

/** A note result links to the note. A file result shows its path with View, Open, and Show in folder. */
export function SearchResultCard({ result }: { result: SearchResult }) {
  const isNote = result.kind === "note";
  return (
    <ItemCard
      title={isNote ? { text: result.title, to: noteUrl(result.id) } : { text: result.title }}
      badge={<KindBadge kind={kindOf(result)} />}
      summary={result.summary || undefined}
      snippet={result.snippet ? <Snippet snippet={result.snippet} /> : undefined}
      meta={
        <>
          <TagBadges tags={result.tags} />
          {isNote ? (
            <BreakableText as="code" className="font-mono" text={result.path} />
          ) : (
            <FileLink path={result.path} code />
          )}
        </>
      }
    />
  );
}

/** The count line, then a card per result. hasMore reads "More than 20 results": the server has more past the limit. */
export function SearchResults({
  results,
  query,
  hasMore = false,
}: {
  results: SearchResult[];
  query: string;
  hasMore?: boolean;
}) {
  if (results.length === 0) {
    return <EmptyState>No results for “{query}”.</EmptyState>;
  }
  const count = plural(results.length, "result");
  return (
    <CardList>
      <p className="text-muted-foreground text-sm" data-testid="result-count">
        {hasMore ? `More than ${count}` : count} for “{query}”
      </p>
      {results.map((r) => (
        <SearchResultCard key={`${r.kind}:${r.id}`} result={r} />
      ))}
    </CardList>
  );
}
