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

/** The colour roles the theme reads, as theme.css defines them for the light scheme and the dark one. */
const LIGHT = {
  "--md-sys-color-on-surface": "#1a1b20",
  "--md-sys-color-on-surface-variant": "#44474f",
  "--md-sys-color-outline-variant": "#c4c6d0",
  "--md-sys-color-surface": "#f9f9ff",
  "--md-sys-color-surface-container": "#ededf4",
  "--md-sys-color-primary": "#435e91",
  "--md-sys-color-on-primary": "#ffffff",
  "--md-sys-color-primary-container": "#d8e2ff",
  "--md-sys-color-on-primary-container": "#2a4678",
};
const DARK = {
  ...LIGHT,
  "--md-sys-color-on-surface": "#e2e2e9",
  "--md-sys-color-surface": "#111318",
  "--md-sys-color-primary": "#adc7ff",
  "--md-sys-color-on-primary": "#0f2f60",
};

function setRoles(roles: Record<string, string>) {
  for (const [property, value] of Object.entries(roles)) document.documentElement.style.setProperty(property, value);
}

beforeAll(() => setRoles(LIGHT));

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
    expect(themeVariables).toMatchObject({ textColor: "#1a1b20", lineColor: "#44474f", mainBkg: "#ededf4", primaryColor: "#435e91" });
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

describe("<Diagram> and the system colour scheme", () => {
  /** A matchMedia whose dark query can be switched, as Windows does when the theme changes. */
  function stubColorScheme() {
    let dark = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return query === "(prefers-color-scheme: dark)" && dark;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));
    return (next: boolean) => {
      dark = next;
      listeners.forEach((listener) => listener());
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    setRoles(LIGHT);
  });

  it("draws again with the dark roles when the system switches to dark, keeping the drawing meanwhile", async () => {
    const setDark = stubColorScheme();
    const { container } = renderNote(fence("mermaid", TIMELINE));
    await waitFor(() => expect(svgIn(container)).not.toBeNull());
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    const firstId = svgIn(container)!.id;

    let finish: (value: { svg: string }) => void = () => {};
    mermaid.render.mockImplementationOnce(
      (id: string) => new Promise((resolve) => (finish = () => resolve({ svg: `<svg id="${id}"><text>dark</text></svg>` }))),
    );
    setRoles(DARK);
    act(() => setDark(true));

    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    // The light drawing stays, and nothing counts as loading, until the dark one is ready.
    expect(svgIn(container)).toHaveAttribute("id", firstId);
    expect(container.querySelector("[data-slot='diagram']")).toHaveAttribute("data-state", "ready");

    await act(async () => finish({ svg: "" }));
    await waitFor(() => expect(svgIn(container)).not.toHaveAttribute("id", firstId));
    const { themeVariables } = mermaid.initialize.mock.calls.at(-1)![0] as { themeVariables: Record<string, string> };
    expect(themeVariables).toMatchObject({ textColor: "#e2e2e9", background: "#111318", primaryColor: "#adc7ff", cScaleLabel0: "#0f2f60" });
  });
});

describe("diagram helpers", () => {
  it("firstErrorLine takes the first non-empty line", () => {
    expect(firstErrorLine(new Error("\n  Parse error on line 3:\nmore"))).toBe("Parse error on line 3:");
    expect(firstErrorLine("No diagram type detected")).toBe("No diagram type detected");
    expect(firstErrorLine(new Error(""))).toBe("Unknown error");
  });

  it("reads the theme from the M3 colour roles", () => {
    const tokens = readDiagramTokens(document.documentElement, document.body);
    expect(tokens).toMatchObject({
      text: "#1a1b20",
      mutedText: "#44474f",
      border: "#c4c6d0",
      surface: "#f9f9ff",
      container: "#ededf4",
      primary: "#435e91",
      onPrimary: "#ffffff",
      primaryContainer: "#d8e2ff",
      onPrimaryContainer: "#2a4678",
    });
    const vars = diagramThemeVariables({ ...tokens, fontFamily: "Roboto" });
    expect(vars).toMatchObject({
      background: "#f9f9ff",
      mainBkg: "#ededf4",
      primaryBorderColor: "#435e91",
      nodeBorder: "#435e91",
      primaryTextColor: "#1a1b20",
      gridColor: "#c4c6d0",
      taskBkgColor: "#435e91",
      taskTextColor: "#ffffff",
      fontFamily: "Roboto",
    });
    // Timeline periods: primary with on-primary labels in every section slot.
    expect(vars).toMatchObject({ cScale0: "#435e91", cScaleLabel0: "#ffffff", cScale11: "#435e91", cScaleLabel11: "#ffffff" });
    // Every variable is one of the tokens or the font, never a colour of its own.
    const allowed = new Set([...Object.values(tokens), "Roboto", "14px"]);
    expect(Object.values(vars).filter((v) => !allowed.has(v))).toEqual([]);

    const css = diagramThemeCss(tokens);
    expect(css).toContain(".eventWrapper { filter: none; }");
    expect(css).toContain(".lineWrapper line { stroke: #44474f; }");
    const colours = css.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(colours.filter((c) => !Object.values(tokens).includes(c))).toEqual([]);
  });

  it("lays gantt charts out to the figure width, ticking monthly below 560px", () => {
    expect(ganttConfig(0)).toEqual({});
    expect(ganttConfig(734)).toEqual({ useWidth: 734 });
    expect(ganttConfig(334)).toEqual({ useWidth: 334, tickInterval: "1month" });
  });
});
