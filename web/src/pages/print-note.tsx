import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useSearchParams } from "react-router";
import { KindBadge, TagName } from "@/components/badges";
import { Callout } from "@/components/callout";
import { MetaItem, MetaList } from "@/components/meta";
import { NoteBody, SourceBody } from "@/components/note-body";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert, LoadingBlock } from "@/components/page-state";
import { createRenderTracker, RenderTrackerProvider } from "@/components/render-tracker";
import { api, ApiError } from "@/lib/api";
import { clearPrintState, fontsLoaded, setPrintState } from "@/lib/print-ready";
import type { Note } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

/*
 * /print/notes/:slug, outside the app layout: one note as it prints, for the server's PDF export and
 * for the browser's print dialog when Edge cannot start (DECISIONS.md, 2026-09-15, "Notes export as
 * Markdown or PDF"). The page is a 178mm sheet, the width A4 leaves inside the server's 16mm side
 * margins, so tables choose their layout on screen at the width they print at (index.css).
 */

function PrintedNote({ note }: { note: Note }) {
  return (
    <article>
      <PageHeader title={note.title} badge={<KindBadge kind={note.type} />}>
        {note.summary && <Callout>{note.summary}</Callout>}
        <MetaList>
          {note.tags.length > 0 && (
            <MetaItem label="Tags">
              {note.tags.map((tag) => (
                <TagName key={tag} name={tag} />
              ))}
            </MetaItem>
          )}
          <MetaItem label="Created">{note.created}</MetaItem>
          <MetaItem label="Updated">{note.updated}</MetaItem>
        </MetaList>
      </PageHeader>
      {note.type === "source" ? (
        <SourceBody text={note.body} />
      ) : (
        <NoteBody markdown={note.body} mentions={note.mentions} print />
      )}
    </article>
  );
}

/**
 * Marks the page ready to print (data-print-ready="true") once the note has rendered, every diagram
 * and image has finished, and the fonts have loaded; "error" with the reason when the note fails to
 * load. With ?autoprint=1 it then opens the print dialog, once.
 */
export function PrintNotePage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const autoprint = params.get("autoprint") === "1";
  const note = useAsync(() => api.getNote(slug), [slug]);
  const [tracker] = useState(createRenderTracker);
  const drawing = useSyncExternalStore(tracker.subscribe, tracker.pending);
  const printed = useRef(false);

  useEffect(() => clearPrintState, []);

  useEffect(() => {
    if (note.loading) return;
    if (note.error) {
      setPrintState({ ready: "error", error: note.error.message });
      return;
    }
    // Diagrams and images register in layout effects, so the ones this render mounted are counted already.
    if (!note.data || tracker.pending() > 0) return;
    let live = true;
    void fontsLoaded().then(() => {
      if (!live || tracker.pending() > 0) return;
      setPrintState({ ready: "true" });
      if (autoprint && !printed.current) {
        printed.current = true;
        window.print();
      }
    });
    return () => {
      live = false;
    };
  }, [note.loading, note.error, note.data, drawing, autoprint, tracker]);

  const missing = note.error instanceof ApiError && note.error.status === 404;

  return (
    <RenderTrackerProvider tracker={tracker}>
      <div data-slot="print-page" className="print-page">
        <div className="print-sheet">
          {note.loading && <LoadingBlock lines={10} />}
          {note.error && <ErrorAlert error={note.error} title={missing ? "Note not found" : undefined} />}
          {note.data && <PrintedNote note={note.data} />}
        </div>
      </div>
    </RenderTrackerProvider>
  );
}
