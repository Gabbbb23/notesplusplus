/**
 * PDF exports for GET /api/notes/:slug/export.pdf.
 *
 * A PDF is the web UI's print page for the note (/print/notes/:slug on this server) printed by headless Microsoft Edge.
 * The browser sits behind PrintBrowser, which the API takes through ApiOptions like the Launcher, so tests pass a fake
 * and never start Edge. This module owns the rest: the page URL, the ready wait, the PDF layout, one export at a time,
 * the time limit, and closing the browser.
 */
import { BrainError } from "../core/types.ts";

/** Starts a browser for one export. */
export interface PrintBrowser {
  /** Start the browser with one page `width` CSS pixels wide. Throws when the browser cannot start. */
  launch(width: number): Promise<PrintPage>;
}

/** The one page of a started browser. */
export interface PrintPage {
  goto(url: string): Promise<void>;
  /**
   * Wait until the root element's `data-print-ready` is "true" or "error", which the print page sets once the note and
   * its diagrams have rendered or failed. Returns that value and the page's `data-print-error`.
   */
  waitForPrintReady(): Promise<{ ready: "true" | "error"; error: string | null }>;
  pdf(options: PdfOptions): Promise<Uint8Array<ArrayBuffer>>;
  /** Close the browser. Calls still pending on the page reject. */
  close(): Promise<void>;
}

/** The subset of Playwright's page.pdf options an export uses. */
export interface PdfOptions {
  format: "A4";
  printBackground: boolean;
  margin: { top: string; bottom: string; left: string; right: string };
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
}

export interface NotePdfExporter {
  /** Print one note. Exports run one at a time: a second waits until the first has finished and closed its browser. */
  print(note: { slug: string; title: string }): Promise<Uint8Array<ArrayBuffer>>;
}

export interface PdfExporterOptions {
  browser: PrintBrowser;
  /** The port this server listens on, read when an export starts. Edge opens the print page on 127.0.0.1 at it. */
  listenPort: () => number;
  /** How long one export may take once its turn comes. Default EXPORT_TIMEOUT_MS. */
  timeoutMs?: number;
}

export const PRINT_PAGE_WIDTH = 1024;
export const EXPORT_TIMEOUT_MS = 30_000;

export function printPageUrl(port: number, slug: string): string {
  return `http://127.0.0.1:${port}/print/notes/${encodeURIComponent(slug)}`;
}

export function createPdfExporter({ browser, listenPort, timeoutMs = EXPORT_TIMEOUT_MS }: PdfExporterOptions): NotePdfExporter {
  let queue: Promise<void> = Promise.resolve();

  return {
    print(note) {
      const turn = queue;
      let release!: () => void;
      queue = new Promise((resolve) => (release = resolve));
      return turn.then(() => {
        const run = startPrint(browser, () => printPageUrl(listenPort(), note.slug), note.title);
        // The next export starts only once this one's browser is closed, even when this request has already timed out.
        void run.settled.then(release);
        return withTimeout(run.pdf, timeoutMs, run.abort);
      });
    },
  };
}

/** One export in flight: its PDF, a promise that settles once the browser is closed, and a way to cut it short. */
function startPrint(browser: PrintBrowser, url: () => string, title: string) {
  let page: PrintPage | null = null;
  let closed = false;
  let aborted = false;
  const close = async () => {
    if (!page || closed) return;
    closed = true;
    await page.close().catch(() => undefined);
  };

  const pdf = (async () => {
    try {
      const opened = await browser.launch(PRINT_PAGE_WIDTH).catch((err: unknown) => {
        throw new BrainError(
          `Microsoft Edge could not be started to make the PDF (${messageOf(err)}). Use the browser's print dialog instead.`,
          503,
          "pdf_unavailable",
        );
      });
      page = opened;
      if (aborted) throw new Error("export cut short");
      await opened.goto(url());
      const { ready, error } = await opened.waitForPrintReady();
      if (ready === "error") {
        throw new BrainError(`the print page could not render the note: ${error || "no reason given"}`, 500, "export_failed");
      }
      return await opened.pdf(pdfOptions(title));
    } finally {
      await close();
    }
  })();

  return {
    pdf,
    settled: pdf.then(
      () => undefined,
      () => undefined,
    ),
    abort: () => {
      aborted = true;
      void close();
    },
  };
}

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new BrainError(`the PDF export did not finish within ${ms / 1000} s`, 504, "export_timeout"));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** A4 with the note title on the left of a small grey footer and the page count on the right. */
export function pdfOptions(title: string): PdfOptions {
  const footer =
    `<div style="box-sizing: border-box; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between; gap: 12px; ` +
    `font-family: Roboto, 'Segoe UI', Arial, sans-serif; font-size: 8px; color: #5f6368;">` +
    `<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(title)}</span>` +
    `<span style="white-space: nowrap;">page <span class="pageNumber"></span> of <span class="totalPages"></span></span>` +
    `</div>`;
  return {
    format: "A4",
    printBackground: true,
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: footer,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!;
}

/** Installed Microsoft Edge, headless, through playwright-core. Loaded on first export, so startup never pays for it. */
export function createEdgeBrowser(): PrintBrowser {
  return {
    async launch(width) {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({ channel: "msedge", headless: true, timeout: EXPORT_TIMEOUT_MS });
      try {
        const page = await browser.newPage({ viewport: { width, height: 1400 } });
        return {
          goto: async (url) => {
            await page.goto(url, { waitUntil: "load", timeout: 0 });
          },
          waitForPrintReady: async () => {
            // The callback runs in the page. It is a string because this project compiles without the DOM types.
            await page.waitForFunction(`["true", "error"].includes(document.documentElement.getAttribute("data-print-ready"))`, undefined, {
              timeout: 0,
            });
            const [ready, error] = (await page.evaluate(
              `[document.documentElement.getAttribute("data-print-ready"), document.documentElement.getAttribute("data-print-error")]`,
            )) as ["true" | "error", string | null];
            return { ready, error };
          },
          pdf: async (options) => new Uint8Array(await page.pdf(options)),
          close: () => browser.close(),
        };
      } catch (err) {
        await browser.close();
        throw err;
      }
    },
  };
}
