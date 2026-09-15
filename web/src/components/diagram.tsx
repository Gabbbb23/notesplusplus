import { CodeIcon } from "lucide-react";
import type { Mermaid } from "mermaid";
import { useEffect, useId, useRef, useState } from "react";
import { Notice } from "@/components/notice";
import { LoadingBlock } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { diagramThemeCss, diagramThemeVariables, readDiagramTokens } from "@/lib/diagram-theme";

/*
 * Every mermaid diagram in the app. This is the only module that imports mermaid, and it does so
 * with a dynamic import the first time a diagram renders, so the library sits in its own chunk
 * and a note without a diagram never loads it. The library is bundled, so diagrams work offline.
 */

let mermaidModule: Promise<Mermaid> | null = null;

function loadMermaid(): Promise<Mermaid> {
  mermaidModule ??= import("mermaid").then((m) => m.default);
  return mermaidModule;
}

/** Mermaid keeps one global configuration, so each configure-and-render runs after the previous one. */
let queue: Promise<unknown> = Promise.resolve();
/** Every render gets a fresh id: mermaid names a temporary element and the SVG's scoped styles after it. */
let renders = 0;

/** Below this figure width a gantt chart's weekly axis labels overlap, so it ticks monthly instead. */
const GANTT_WEEKLY_TICKS_MIN_PX = 560;

/** Gantt charts lay out to the figure's width instead of the page's, ticking monthly when narrow. */
export function ganttConfig(width: number): { useWidth?: number; tickInterval?: string } {
  if (width <= 0) return {};
  return width < GANTT_WEEKLY_TICKS_MIN_PX ? { useWidth: width, tickInterval: "1month" } : { useWidth: width };
}

/**
 * Parse and render one diagram to an SVG string. width is the space the figure has; gantt charts
 * lay themselves out to it instead of to the page width.
 */
export function drawDiagram(source: string, width: number): Promise<string> {
  const run = async () => {
    const mermaid = await loadMermaid();
    const tokens = readDiagramTokens(document.documentElement, document.body);
    mermaid.initialize({
      startOnLoad: false,
      // Notes are agent-written: no scripts, no click handlers, labels sanitized.
      securityLevel: "strict",
      theme: "base",
      themeVariables: diagramThemeVariables(tokens),
      themeCSS: diagramThemeCss(tokens),
      fontFamily: tokens.fontFamily,
      // Errors show as a Notice here, never as mermaid's own error graphic.
      suppressErrorRendering: true,
      gantt: ganttConfig(width),
    });
    await mermaid.parse(source);
    const { svg } = await mermaid.render(`diagram-${++renders}`, source);
    return svg;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/** The first non-empty line of an error: mermaid's parser puts the useful summary there. */
export function firstErrorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "Unknown error";
}

type DrawState =
  | { source: string; status: "ready"; svg: string }
  | { source: string; status: "error"; message: string };

function SourceBlock({ id, source, hidden }: { id?: string; source: string; hidden?: boolean }) {
  return (
    <pre id={id} hidden={hidden} data-slot="diagram-source" className="w-full text-foreground">
      <code className="language-mermaid">{source}</code>
    </pre>
  );
}

/**
 * A fenced mermaid block drawn as a figure: the SVG scaled to the content width, then a quiet
 * "Show source" toggle that reveals the text. While mermaid loads, grey bars hold the space. When
 * the diagram cannot be drawn, a warning Notice gives the parser's first error line and the source.
 */
export function Diagram({ source }: { source: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const sourceId = useId();
  const [drawn, setDrawn] = useState<DrawState | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let live = true;
    // The figure has 16px padding and a 1px border on each side.
    const width = Math.floor((boxRef.current?.clientWidth ?? 0) - 34);
    drawDiagram(source, width).then(
      (svg) => live && setDrawn({ source, status: "ready", svg }),
      (error: unknown) => live && setDrawn({ source, status: "error", message: firstErrorLine(error) }),
    );
    return () => {
      live = false;
    };
  }, [source]);

  // A result for an older source never shows.
  const state = drawn?.source === source ? drawn : null;

  return (
    <div ref={boxRef} data-slot="diagram" data-state={state?.status ?? "loading"} className="min-w-0">
      {state?.status === "error" ? (
        <Notice tone="warning" title="This diagram could not be drawn" live={false}>
          <p>{state.message}</p>
          <SourceBlock source={source} />
        </Notice>
      ) : (
        <figure className="min-w-0 rounded-lg border bg-card p-4">
          {state?.status === "ready" ? (
            <div
              data-slot="diagram-svg"
              className="flex min-w-0 justify-center [&_svg]:h-auto [&_svg]:max-w-full"
              // Mermaid output under securityLevel "strict": labels are sanitized and scripts removed.
              dangerouslySetInnerHTML={{ __html: state.svg }}
            />
          ) : (
            <LoadingBlock lines={3} />
          )}
          <div className="mt-3 flex flex-col items-start gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showSource}
              aria-controls={sourceId}
              onClick={() => setShowSource((open) => !open)}
            >
              <CodeIcon aria-hidden="true" />
              {showSource ? "Hide source" : "Show source"}
            </Button>
            <SourceBlock id={sourceId} source={source} hidden={!showSource} />
          </div>
        </figure>
      )}
    </div>
  );
}
