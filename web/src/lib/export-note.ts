import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api, ApiError, noteExportUrl, printNoteUrl } from "@/lib/api";
import type { NoteRef } from "@/lib/types";

/*
 * Export a note as Markdown or PDF (DECISIONS.md, 2026-09-15, "Notes export as Markdown or PDF").
 * NoteActionsMenu's "Export as" submenu calls these. This is the only module that starts a download
 * from code and the only one that makes an object URL, so every menu exports the same way.
 */

/** Start a download of href, saved as filename, through a temporary same-origin link. */
function clickDownload(href: string, filename: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

/** Save a blob under filename. The URL is revoked straight after: the download already holds the blob. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    clickDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The file name a Content-Disposition header gives: the UTF-8 `filename*` when present, else
 * `filename`. Null when the header names none.
 */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const extended = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i.exec(header);
  if (extended) {
    const value = extended[1]!.trim().replace(/^"(.*)"$/, "$1");
    const encoded = /^[^']*'[^']*'(.*)$/.exec(value)?.[1] ?? value;
    try {
      const name = decodeURIComponent(encoded);
      if (name.trim() !== "") return name;
    } catch {
      // A malformed escape: fall back to the plain filename.
    }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/i.exec(header);
  const name = plain?.[1]?.replace(/\\(.)/g, "$1") ?? plain?.[2]?.trim();
  return name ? name : null;
}

/** Download the note's file exactly as stored, named <slug>.md. */
export function exportMarkdown(note: NoteRef): void {
  const filename = `${note.slug}.md`;
  clickDownload(noteExportUrl(note.slug, "md"), filename);
  toast.success(`Downloaded ${filename}`);
}

// Notes with a PDF export running. A menu shows PDF as busy for these, wherever it is.
const running = new Set<string>();
const listeners = new Set<() => void>();

function setRunning(slug: string, on: boolean): void {
  if (on) running.add(slug);
  else running.delete(slug);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a PDF export of this note runs. */
export function usePdfExportRunning(slug: string): boolean {
  return useSyncExternalStore(subscribe, () => running.has(slug));
}

export const PRINT_DIALOG_MESSAGE = "Opening the print dialog; choose Save as PDF";

/**
 * The server could not start Edge: open the print page in a new tab, which calls the print dialog
 * once the note has drawn. A tab the browser blocks (the request took long enough to lose the click)
 * gets a button in the toast that opens it.
 */
function openPrintDialog(note: NoteRef, toastId: string | number): void {
  const url = printNoteUrl(note.slug, { autoprint: true });
  const tab = window.open(url, "_blank");
  if (tab) {
    tab.opener = null;
    toast.info(PRINT_DIALOG_MESSAGE, { id: toastId });
    return;
  }
  toast.info(PRINT_DIALOG_MESSAGE, {
    id: toastId,
    action: { label: "Open print page", onClick: () => window.open(url, "_blank", "noopener") },
  });
}

/**
 * Ask the server for the note as a PDF and save it under the name the server gives (or <title>.pdf).
 * A toast shows the progress and the result. While one export of a note runs, another of the same
 * note does nothing.
 */
export async function exportPdf(note: NoteRef): Promise<void> {
  if (running.has(note.slug)) return;
  setRunning(note.slug, true);
  const toastId = toast.loading(`Preparing PDF of ${note.title}…`);
  try {
    const { blob, contentDisposition } = await api.exportPdf(note.slug);
    const filename = filenameFromContentDisposition(contentDisposition) ?? `${note.title}.pdf`;
    saveBlob(blob, filename);
    toast.success(`Downloaded ${filename}`, { id: toastId });
  } catch (err) {
    if (err instanceof ApiError && err.code === "pdf_unavailable") {
      openPrintDialog(note, toastId);
    } else {
      toast.error(`Could not export ${note.title} as PDF`, {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    setRunning(note.slug, false);
  }
}
