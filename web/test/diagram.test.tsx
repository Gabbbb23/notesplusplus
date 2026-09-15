import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { firstErrorLine, ganttConfig } from "../src/components/diagram";
import { NoteBody } from "../src/components/note-body";
import { diagramThemeCss, diagramThemeVariables, readDiagramTokens } from "../src/lib/diagram-theme";

/*
 * mermaid is mocked: jsdom has no layout, so the real library cannot draw. `imported` records
 * that the module was loaded at all. The module cache keeps it loaded for the rest of this file,
 * so the "never imports" test runs first.
 */
const mermaid = vi.hoisted(() => ({
  imported: vi.fn(),
  initialize: vi.fn(),
  parse: vi.fn(async (_text: string): Promise<unknown> => ({ diagramType: "timeline" })),
  render: vi.fn(async (id: string, text: string) => ({
    svg: `<svg id="${id}" viewBox="0 0 400 200" aria-roledescription="timeline"><text>${text.length} chars</text></svg>`,
  })),
}));

vi.mock("mermaid", () => {
  mermaid.imported();
  return { default: { initialize: mermaid.initialize, parse: mermaid.parse, render: mermaid.render } };
});

const TIMELINE = ["timeline", "  title Rizal Law", "  1956-04-12 : Senate bill filed", "  1956-06-12 : Signed as Republic Act 1425"].join("\n");

const note = (...blocks: string[]) => blocks.join("\n\n");
const fence = (lang: string, body: string) => "```" + lang + "\n" + body + "\n```";

function renderNote(markdown: string) {
  return render(
    <MemoryRouter>
      <NoteBody markdown={markdown} mentions={[]} />
    </MemoryRouter>,
  );
}

const svgIn = (root: ParentNode) => root.querySelector("[data-slot='diagram-svg'] svg");

beforeAll(() => {
  // The tokens the theme reads, as index.css defines them.
  const style = document.createElement("style");
  style.textContent = ":root { --foreground: #202124; --muted-foreground: #5f6368; --border: #dadce0; --card: #ffffff; --primary: #1a73e8; }";
  document.head.append(style);
});

afterEach(() => {
  mermaid.initialize.mockClear();
  mermaid.parse.mockClear();
  mermaid.render.mockClear();
});

describe("a note without a mermaid block", () => {
  it("never imports mermaid and leaves other code blocks alone", async () => {
    const { container } = renderNote(note("Intro.", fence("ts", "const a = 1;"), fence("", "plain block")));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mermaid.imported).not.toHaveBeenCalled();
    expect(container.querySelector("[data-slot='diagram']")).toBeNull();
    const blocks = container.querySelectorAll("pre > code");
    expect(Array.from(blocks, (b) => [b.className, b.textContent])).toEqual([
      ["language-ts", "const a = 1;\n"],
      ["", "plain block\n"],
    ]);
  });
});

describe("<Diagram> in a note body", () => {
  it("draws a mermaid block as a figure with the SVG, under strict security and the base theme", async () => {
    const { container } = renderNote(note("The Rizal Law dates:", fence("mermaid", TIMELINE), fence("ts", "const a = 1;")));

    // Grey bars hold the space while mermaid loads.
    expect(container.querySelector("[data-slot='diagram']")).toHaveAttribute("data-state", "loading");

    const figure = await screen.findByRole("figure");
    await waitFor(() => expect(svgIn(figure)).not.toBeNull());
    expect(mermaid.imported).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-slot='diagram']")).toHaveAttribute("data-state", "ready");
    expect(figure.querySelector("[data-slot='diagram-svg']")).toHaveClass("[&_svg]:max-w-full", "[&_svg]:h-auto");
    expect(container.innerHTML).not.toMatch(/overflow-(?:x-)?(?:auto|scroll)/);

    expect(mermaid.parse).toHaveBeenCalledWith(TIMELINE);
    const [id, text] = mermaid.render.mock.calls[0]!;
    expect(id).toMatch(/^diagram-\d+$/);
    expect(text).toBe(TIMELINE);
    expect(svgIn(figure)).toHaveAttribute("id", id);

    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict", theme: "base", suppressErrorRendering: true }),
    );
    const { themeVariables, themeCSS } = mermaid.initialize.mock.calls[0]![0] as {
      themeVariables: Record<string, string>;
      themeCSS: string;
    };
    expect(themeVariables).toMatchObject({ textColor: "#202124", lineColor: "#5f6368", mainBkg: "#ffffff", primaryColor: "#1a73e8" });
    expect(themeCSS).toContain(".eventWrapper");

    // The other code block is still a code block.
    expect(container.querySelector("pre > code.language-ts")).not.toBeNull();
  });

  it("toggles the source with aria-expanded", async () => {
    renderNote(fence("mermaid", TIMELINE));
    const figure = await screen.findByRole("figure");
    await waitFor(() => expect(svgIn(figure)).not.toBeNull());

    const toggle = within(figure).getByRole("button", { name: "Show source" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const source = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(source).not.toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide source");
    expect(source).toBeVisible();
    expect(source.querySelector("code")?.textContent).toBe(TIMELINE);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a warning with the parser's first error line and the source when the diagram cannot be drawn", async () => {
    mermaid.parse.mockRejectedValueOnce(
      new Error("Parse error on line 2:\n...timeline  1956 :: x\n----------^\nExpecting 'EOF', got 'COLON'"),
    );
    const broken = "timeline\n  1956 :: x";
    const { container } = renderNote(fence("mermaid", broken));

    // A broken diagram is part of the note's content, so it is a static note, not an announced alert.
    const alert = await screen.findByRole("note");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(alert).toHaveAttribute("data-tone", "warning");
    expect(alert).toHaveTextContent("This diagram could not be drawn");
    expect(alert).toHaveTextContent("Parse error on line 2:");
    expect(alert).not.toHaveTextContent("Expecting");
    expect(alert.querySelector("pre > code")?.textContent).toBe(broken);
    expect(screen.queryByRole("figure")).toBeNull();
    expect(container.querySelector("[data-slot='diagram']")).toHaveAttribute("data-state", "error");
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("gives every render its own id, including StrictMode's double effects and two diagrams in a note", async () => {
    const { container } = render(
      <StrictMode>
        <MemoryRouter>
          <NoteBody markdown={note(fence("mermaid", TIMELINE), fence("mermaid", "pie\n  \"Tuition\" : 3200\n  \"Fees\" : 2445"))} mentions={[]} />
        </MemoryRouter>
      </StrictMode>,
    );
    await waitFor(() => expect(container.querySelectorAll("[data-slot='diagram-svg'] svg")).toHaveLength(2));

    const ids = mermaid.render.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const shown = Array.from(container.querySelectorAll("[data-slot='diagram-svg'] svg"), (s) => s.id);
    expect(new Set(shown).size).toBe(2);
  });

  it("never shows a drawing of the previous source after the markdown changes", async () => {
    let finishFirst: (value: { svg: string }) => void = () => {};
    mermaid.render.mockImplementationOnce(
      (id: string) =>
        new Promise((resolve) => {
          finishFirst = () => resolve({ svg: `<svg id="${id}"><text>old</text></svg>` });
        }),
    );
    const view = renderNote(fence("mermaid", "timeline\n  2025 : old"));
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));

    view.rerender(
      <MemoryRouter>
        <NoteBody markdown={fence("mermaid", "timeline\n  2026 : new")} mentions={[]} />
      </MemoryRouter>,
    );
    await act(async () => finishFirst({ svg: "" }));

    await waitFor(() => expect(svgIn(view.container)).not.toBeNull());
    expect(view.container.querySelector("[data-slot='diagram-svg']")).not.toHaveTextContent("old");
    expect(mermaid.render.mock.calls.map(([, text]) => text)).toEqual(["timeline\n  2025 : old", "timeline\n  2026 : new"]);
  });
});

describe("diagram helpers", () => {
  it("firstErrorLine takes the first non-empty line", () => {
    expect(firstErrorLine(new Error("\n  Parse error on line 3:\nmore"))).toBe("Parse error on line 3:");
    expect(firstErrorLine("No diagram type detected")).toBe("No diagram type detected");
    expect(firstErrorLine(new Error(""))).toBe("Unknown error");
  });

  it("reads the theme from the CSS tokens", () => {
    const tokens = readDiagramTokens(document.documentElement, document.body);
    expect(tokens).toMatchObject({ text: "#202124", mutedText: "#5f6368", border: "#dadce0", card: "#ffffff", primary: "#1a73e8" });
    const vars = diagramThemeVariables({ ...tokens, fontFamily: "Google Sans" });
    expect(vars).toMatchObject({
      background: "#ffffff",
      primaryBorderColor: "#1a73e8",
      nodeBorder: "#1a73e8",
      primaryTextColor: "#202124",
      gridColor: "#dadce0",
      taskBkgColor: "#1a73e8",
      fontFamily: "Google Sans",
    });
    // Timeline periods: blue with card-coloured labels in every section slot.
    expect(vars).toMatchObject({ cScale0: "#1a73e8", cScaleLabel0: "#ffffff", cScale11: "#1a73e8", cScaleLabel11: "#ffffff" });
    // Every variable is one of the tokens or the font, never a colour of its own.
    const allowed = new Set([...Object.values(tokens), "Google Sans", "14px"]);
    expect(Object.values(vars).filter((v) => !allowed.has(v))).toEqual([]);

    const css = diagramThemeCss(tokens);
    expect(css).toContain(".eventWrapper { filter: none; }");
    expect(css).toContain(".lineWrapper line { stroke: #5f6368; }");
    const colours = css.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(colours.filter((c) => !Object.values(tokens).includes(c))).toEqual([]);
  });

  it("lays gantt charts out to the figure width, ticking monthly below 560px", () => {
    expect(ganttConfig(0)).toEqual({});
    expect(ganttConfig(734)).toEqual({ useWidth: 734 });
    expect(ganttConfig(334)).toEqual({ useWidth: 334, tickInterval: "1month" });
  });
});
