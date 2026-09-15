import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { Note, NoteSummary } from "../src/lib/types";
import { apiError, callsTo, reply, settle, stubApi, summary } from "./api-stub";

/*
 * mermaid is mocked, as in diagram.test.tsx: jsdom cannot draw. Each render waits for the test to
 * call finishDrawing(), so the test controls when a diagram leaves its loading state.
 */
const mermaid = vi.hoisted(() => {
  let finish: () => void = () => {};
  let gate = Promise.resolve();
  return {
    hold() {
      gate = new Promise<void>((resolve) => (finish = resolve));
    },
    finishDrawing: () => finish(),
    initialize: () => {},
    parse: async () => ({ diagramType: "flowchart" }),
    render: async (id: string) => {
      await gate;
      return { svg: `<svg id="${id}" viewBox="0 0 400 200"><text>drawn</text></svg>` };
    },
  };
});

vi.mock("mermaid", () => ({
  default: { initialize: mermaid.initialize, parse: mermaid.parse, render: mermaid.render },
}));

const MODULE = String.raw`C:\Important Files\College Files\GE08 - Ethics\Module 1.pdf`;

function note(n: NoteSummary, body: string, mentions: string[] = []): Note {
  return {
    ...n,
    frontmatter: { title: n.title, type: n.type, summary: n.summary, tags: n.tags, created: n.created, updated: n.updated },
    body,
    raw: "",
    links: [],
    mentions,
    mtimeMs: 0,
  };
}

const RIZAL: NoteSummary = {
  ...summary("rizal-day", "Rizal Day"),
  summary: "Rizal Day marks the anniversary of José Rizal's execution.",
  tags: ["college", "ge09"],
  created: "2026-09-01",
  updated: "2026-09-14",
};

const BODY = [
  "See [[rizal-law|the Rizal Law]] and [the Senate record](https://example.com/record).",
  "",
  `- The module: \`${MODULE}\``,
  "",
  "> [!NOTE]",
  "> Callouts print as they show.",
  "",
  "| Year | Event |",
  "|---|---|",
  "| 1896 | Execution |",
].join("\n");

const DIAGRAM = ["```mermaid", "flowchart LR", "  A --> B", "```"].join("\n");

function renderPrint(path: string, n: Note | null) {
  const fetchMock = stubApi(
    n ? { [`/api/notes/${n.slug}`]: () => reply(200, n) } : { "/api/notes/missing": () => apiError(404, "not_found", "not found: note missing") },
  );
  const { unmount } = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { fetchMock, unmount };
}

const printReady = () => document.documentElement.dataset.printReady;

beforeEach(() => {
  vi.stubGlobal("print", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the print page", () => {
  it("shows the note alone: no sidebar, top bar, breadcrumbs, menus, backlinks, or toasts", async () => {
    const { fetchMock } = renderPrint("/print/notes/rizal-day", note(RIZAL, BODY, [MODULE]));

    await screen.findByRole("heading", { level: 1, name: "Rizal Day" });
    await settle();

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    // The one header is the note's own, inside the article.
    expect(Array.from(document.querySelectorAll("header"), (h) => h.dataset.slot)).toEqual(["page-header"]);
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^More actions/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Backlinks" })).toBeNull();
    expect(document.querySelector("[data-sonner-toaster], section[aria-label^='Notifications']")).toBeNull();
    // Nothing the layout loads, and the note alone: no backlinks, trail, or pins.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/notes/rizal-day"]);
    expect(callsTo(fetchMock, "GET /api/pins")).toHaveLength(0);
  });

  it("prints the title, type, summary, tags, dates, and body", async () => {
    renderPrint("/print/notes/rizal-day", note(RIZAL, BODY, [MODULE]));
    const page = (await screen.findByRole("heading", { level: 1, name: "Rizal Day" })).closest<HTMLElement>("[data-slot='print-page']")!;

    expect(within(page).getByText("note")).toBeInTheDocument();
    expect(within(page).getByText(RIZAL.summary)).toHaveAttribute("data-slot", "callout");
    const meta = page.querySelector<HTMLElement>("[data-slot='meta-list']")!;
    expect(within(meta).getAllByRole("term").map((t) => t.textContent)).toEqual(["Tags", "Created", "Updated"]);
    expect(meta).toHaveTextContent("#college");
    expect(meta).toHaveTextContent("#ge09");
    expect(meta).toHaveTextContent("2026-09-01");
    expect(meta).toHaveTextContent("2026-09-14");
    // Tags are names here, not links back into the app.
    expect(within(meta).queryByRole("link")).toBeNull();

    expect(within(page).getByRole("note")).toHaveTextContent("Callouts print as they show.");
    expect(within(page).getByRole("table")).toHaveTextContent("Execution");
  });

  it("prints wikilinks as plain text and keeps links to sites", async () => {
    renderPrint("/print/notes/rizal-day", note(RIZAL, BODY, [MODULE]));
    await screen.findByRole("heading", { level: 1, name: "Rizal Day" });

    expect(screen.getByText(/the Rizal Law/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "the Rizal Law" })).toBeNull();
    expect(document.querySelector("a[href^='/']")).toBeNull();
    expect(screen.getByRole("link", { name: "the Senate record" })).toHaveAttribute("href", "https://example.com/record");
  });

  it("prints a mentioned path as code without file buttons", async () => {
    renderPrint("/print/notes/rizal-day", note(RIZAL, BODY, [MODULE]));
    await screen.findByRole("heading", { level: 1, name: "Rizal Day" });

    const item = screen.getByRole("listitem");
    const code = item.querySelector("code")!;
    expect(code.textContent).toBe(MODULE);
    expect(code).toHaveAttribute("data-slot", "breakable-text");
    expect(within(item).queryByRole("button")).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(document.querySelector("[data-slot='file-actions']")).toBeNull();
  });

  it("is ready to print only once every diagram has drawn, and has no Show source toggle", async () => {
    mermaid.hold();
    renderPrint("/print/notes/rizal-day", note(RIZAL, `${BODY}\n\n${DIAGRAM}\n\nAfter.\n\n${DIAGRAM.replace("A --> B", "C --> D")}`));

    await screen.findByRole("heading", { level: 1, name: "Rizal Day" });
    await settle(20);
    expect(document.querySelectorAll("[data-slot='diagram'][data-state='loading']")).toHaveLength(2);
    expect(printReady()).toBeUndefined();

    await act(async () => mermaid.finishDrawing());

    await waitFor(() => expect(printReady()).toBe("true"));
    expect(document.querySelectorAll("[data-slot='diagram'][data-state='ready']")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /source/i })).toBeNull();
    expect(document.documentElement.dataset.printError).toBeUndefined();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("says error, with the reason, when the note does not load", async () => {
    renderPrint("/print/notes/missing", null);

    await waitFor(() => expect(printReady()).toBe("error"));
    expect(document.documentElement.dataset.printError).toBe("not found: note missing");
    expect(screen.getByRole("alert")).toHaveTextContent("Note not found");
    expect(window.print).not.toHaveBeenCalled();
  });

  it("opens the print dialog once ready with ?autoprint=1", async () => {
    renderPrint("/print/notes/rizal-day?autoprint=1", note(RIZAL, BODY));

    await waitFor(() => expect(printReady()).toBe("true"));
    await settle();
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("prints a source's text verbatim, wrapped", async () => {
    const source = { ...summary("transcript", "Transcript", "source"), summary: "" };
    renderPrint("/print/notes/transcript", note(source, "Line one\n  [[not-a-link]] stays as written"));

    await waitFor(() => expect(printReady()).toBe("true"));
    const pre = document.querySelector("[data-slot='source-body']")!;
    expect(pre.textContent).toBe("Line one\n  [[not-a-link]] stays as written");
    expect(pre).toHaveClass("whitespace-pre-wrap");
  });

  it("removes the ready flag when the page goes away", async () => {
    const { unmount } = renderPrint("/print/notes/rizal-day", note(RIZAL, BODY));
    await waitFor(() => expect(printReady()).toBe("true"));
    unmount();
    expect(printReady()).toBeUndefined();
  });
});
