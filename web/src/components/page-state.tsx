import { PlugZapIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { BreakableText } from "@/components/breakable-text";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, NetworkError } from "@/lib/api";
import { TOP_LEVEL_CRUMBS } from "@/lib/breadcrumb-items";

/*
 * Loading, error, empty, and not-found states. Card placeholders (LoadingCards) live in
 * item-card.tsx so they share the card shell.
 */

/** Rows of grey bars standing in for a list or a note body while it loads. */
export function LoadingBlock({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={className ?? "space-y-3"} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-2/5" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${88 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

/** An error from the API, or the "server not reachable" hint when fetch itself threw. */
export function ErrorAlert({ error, title }: { error: Error; title?: string }) {
  if (error instanceof NetworkError) {
    return (
      <Notice tone="danger" icon={PlugZapIcon} title="Brain server not reachable">
        The web UI could not reach the API. Start the server with <code className="font-mono">npm start</code> in the
        project folder and reload this page.
      </Notice>
    );
  }
  const heading = title ?? (error instanceof ApiError ? `Error ${error.status}` : "Something went wrong");
  return (
    <Notice tone="danger" title={heading}>
      {error.message}
    </Notice>
  );
}

/** Quiet grey text for an empty list. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground py-6 text-center text-sm">{children}</p>;
}

/**
 * A page for something that does not exist: a title, one sentence ending in the missing
 * value as code ("There is no note with the slug x."), and a way back home. Its breadcrumbs are Home alone.
 */
export function NotFoundState({ title, message, value }: { title: string; message: string; value: string }) {
  return (
    <div data-slot="not-found-state">
      <PageHeader
        title={title}
        breadcrumbs={TOP_LEVEL_CRUMBS}
        description={
          <>
            {message} <BreakableText as="code" className="font-mono" text={value} />.
          </>
        }
      />
      <Button asChild variant="outline">
        <Link to="/">Back home</Link>
      </Button>
    </div>
  );
}
