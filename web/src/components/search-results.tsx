import { KindBadge, TagBadges, type Kind } from "@/components/badges";
import { BreakableText } from "@/components/breakable-text";
import { CardList, ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/page-state";
import { Snippet } from "@/components/snippet";
import { fileUrl, noteUrl } from "@/lib/api";
import { plural } from "@/lib/format";
import type { SearchResult } from "@/lib/types";

function kindOf(r: SearchResult): Kind {
  return r.kind === "note" ? (r.type ?? "note") : "file";
}

export function SearchResultCard({ result }: { result: SearchResult }) {
  return (
    <ItemCard
      title={
        result.kind === "note"
          ? { text: result.title, to: noteUrl(result.id) }
          : { text: result.title, href: fileUrl(result.path) }
      }
      badge={<KindBadge kind={kindOf(result)} />}
      summary={result.summary || undefined}
      snippet={result.snippet ? <Snippet snippet={result.snippet} /> : undefined}
      meta={
        <>
          <TagBadges tags={result.tags} />
          <BreakableText as="code" className="font-mono" text={result.path} />
        </>
      }
    />
  );
}

export function SearchResults({ results, query }: { results: SearchResult[]; query: string }) {
  if (results.length === 0) {
    return <EmptyState>No results for “{query}”.</EmptyState>;
  }
  return (
    <CardList>
      <p className="text-muted-foreground text-sm" data-testid="result-count">
        {plural(results.length, "result")} for “{query}”
      </p>
      {results.map((r) => (
        <SearchResultCard key={`${r.kind}:${r.id}`} result={r} />
      ))}
    </CardList>
  );
}
