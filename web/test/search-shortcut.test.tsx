import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { SearchInput } from "../src/components/search-input";
import { createSearchShortcutRegistry, SearchShortcutProvider, type SearchShortcutTarget } from "../src/components/search-shortcut";
import { FOCUS_SEARCH } from "../src/lib/shortcuts";

/** The minimum of a fetch Response that lib/api.ts reads. */
function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body } as Response;
}

const ROUTES: Record<string, unknown> = {
  "/api/tags": [],
  "/api/inbox": [],
  "/api/search?q=ryzen&limit=20&mode=hybrid": { results: [], hasMore: false },
};

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url in ROUTES ? reply(200, ROUTES[url]) : reply(404, { error: { code: "not_found", message: "not found" } }),
    ),
  );
}

function renderAt(path: string) {
  stubApi();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/** Press a key the way a browser does: keydown on the focused element, bubbling to window. Returns false when prevented. */
function press(init: KeyboardEventInit) {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(document.activeElement ?? document.body, init);
  });
  return notPrevented;
}

const ALT_K = { code: "KeyK", key: "k", altKey: true };

const topBar = () => screen.getByRole("searchbox", { name: "Search" });
const selection = (input: HTMLElement) => [(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Alt+K in the app", () => {
  it("focuses the top bar field on a normal page and selects its text", async () => {
    renderAt("/tags");
    await screen.findByRole("heading", { level: 1, name: "Tags" });
    const field = topBar();
    fireEvent.change(field, { target: { value: "ryzen" } });
    expect(field).not.toHaveFocus();

    expect(press(ALT_K)).toBe(false);

    expect(field).toHaveFocus();
    expect(selection(field)).toEqual([0, 5]);
    expect(field).toHaveAttribute("aria-keyshortcuts", "Alt+K");
  });

  it("focuses the Search page box on /search, not the top bar, and selects its text", async () => {
    renderAt("/search?q=ryzen");
    const box = await screen.findByRole("searchbox", { name: "Query" });
    expect(box).toHaveValue("ryzen");
    act(() => topBar().focus());

    expect(press(ALT_K)).toBe(false);

    expect(box).toHaveFocus();
    expect(selection(box)).toEqual([0, 5]);
    expect(box).toHaveAttribute("aria-keyshortcuts", "Alt+K");
    expect(topBar()).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("works while typing in a textarea, and matches Option+K on macOS by its physical key", async () => {
    renderAt("/inbox");
    const content = await screen.findByRole("textbox", { name: "Content" });
    act(() => content.focus());

    expect(press({ code: "KeyK", key: "˚", altKey: true })).toBe(false);
    expect(topBar()).toHaveFocus();
  });

  it("leaves Ctrl+Alt+K (AltGr), Alt+Shift+K, repeats, and plain K alone", async () => {
    renderAt("/inbox");
    const content = await screen.findByRole("textbox", { name: "Content" });
    act(() => content.focus());

    for (const init of [
      { ...ALT_K, ctrlKey: true },
      { ...ALT_K, shiftKey: true },
      { ...ALT_K, repeat: true },
      { code: "KeyK", key: "k" },
    ]) {
      expect(press(init), JSON.stringify(init)).toBe(true);
      expect(content).toHaveFocus();
    }
  });

  it("opens /search and focuses its box when no search field is shown", async () => {
    renderAt("/tags");
    await screen.findByRole("heading", { level: 1, name: "Tags" });
    topBar().closest("form")!.style.display = "none";

    expect(press(ALT_K)).toBe(false);

    const box = await screen.findByRole("searchbox", { name: "Query" });
    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBeInTheDocument();
    expect(box).toHaveFocus();
  });
});

describe("createSearchShortcutRegistry", () => {
  const input = () => document.createElement("input");

  it("prefers the page box over the top bar, skips fields that are not shown, and forgets removed ones", () => {
    const registry = createSearchShortcutRegistry();
    const top = input();
    const page = input();
    const shown = new Set([top, page]);
    const isShown = (el: HTMLInputElement) => shown.has(el);
    const notify = vi.fn();
    registry.subscribe(notify);

    expect(registry.activeKind()).toBeNull();
    const removeTop = registry.register("top-bar", top);
    expect(registry.target(isShown)).toBe(top);

    const removePage = registry.register("page", page);
    expect(registry.activeKind()).toBe("page");
    expect(registry.target(isShown)).toBe(page);

    shown.delete(page);
    expect(registry.target(isShown)).toBe(top);
    shown.delete(top);
    expect(registry.target(isShown)).toBeNull();

    shown.add(top);
    removePage();
    expect(registry.activeKind()).toBe("top-bar");
    removeTop();
    expect(registry.activeKind()).toBeNull();
    expect(notify).toHaveBeenCalledTimes(4);
  });

  it("focuses and selects the next page box after a navigation to /search", () => {
    const registry = createSearchShortcutRegistry();
    const page = input();
    page.value = "ryzen";
    document.body.append(page);
    registry.focusPageBoxWhenRegistered();
    registry.register("top-bar", input());
    expect(page).not.toHaveFocus();

    registry.register("page", page);
    expect(page).toHaveFocus();
    expect(selection(page)).toEqual([0, 5]);
    page.remove();
  });
});

function Field({ initial = "", target }: { initial?: string; target?: SearchShortcutTarget }) {
  const [value, setValue] = useState(initial);
  return <SearchInput value={value} onChange={setValue} label="Search" placeholder="Search notes and files" shortcutTarget={target} />;
}

function renderFields(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <SearchShortcutProvider>{ui}</SearchShortcutProvider>
    </MemoryRouter>,
  );
}

const hint = (root: ParentNode = document) => root.querySelector<HTMLElement>("[data-slot='shortcut-hint']");

describe("the shortcut hint in <SearchInput>", () => {
  it("shows the keycaps, hidden from assistive tech, while the field is empty and unfocused", () => {
    renderFields(<Field target="top-bar" />);
    const field = screen.getByRole("searchbox", { name: "Search" });
    expect(field).toHaveAttribute("aria-keyshortcuts", "Alt+K");

    const shown = hint()!;
    expect(shown).toHaveAttribute("aria-hidden", "true");
    expect(Array.from(shown.querySelectorAll("kbd"), (k) => k.textContent)).toEqual([...FOCUS_SEARCH.keys]);
    // Only from the md width up, on devices with hover and a fine pointer, with room kept so text never runs under it.
    expect(shown).toHaveClass("hidden", "md:[@media(hover:hover)_and_(pointer:fine)]:flex", "pointer-events-none");
    expect(field).toHaveClass("md:[@media(hover:hover)_and_(pointer:fine)]:pr-20");
    expect(field.className).not.toMatch(/(?:^|\s)\[@media/);
  });

  it("hides on focus and on typed text", () => {
    renderFields(<Field target="top-bar" />);
    const field = screen.getByRole("searchbox", { name: "Search" });

    act(() => field.focus());
    expect(hint()).toBeNull();
    act(() => field.blur());
    expect(hint()).not.toBeNull();

    fireEvent.change(field, { target: { value: "ryzen" } });
    expect(hint()).toBeNull();
    fireEvent.change(field, { target: { value: "" } });
    expect(hint()).not.toBeNull();
  });

  it("stays hidden on a field that starts with text", () => {
    renderFields(<Field target="top-bar" initial="ryzen" />);
    expect(hint()).toBeNull();
  });

  it("stays hidden on a field that focuses itself on mount", () => {
    renderFields(<SearchInput value="" onChange={() => {}} label="Query" autoFocus shortcutTarget="page" />);
    expect(screen.getByRole("searchbox", { name: "Query" })).toHaveFocus();
    expect(hint()).toBeNull();
  });

  it("shows only on the field the shortcut goes to: the page box, when there is one", () => {
    const { container } = renderFields(
      <>
        <div data-testid="top">
          <Field target="top-bar" />
        </div>
        <div data-testid="page">
          <SearchInput value="" onChange={() => {}} label="Query" shortcutTarget="page" />
        </div>
      </>,
    );
    expect(hint(screen.getByTestId("top"))).toBeNull();
    expect(hint(screen.getByTestId("page"))).not.toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search" })).not.toHaveAttribute("aria-keyshortcuts");
    expect(screen.getByRole("searchbox", { name: "Query" })).toHaveAttribute("aria-keyshortcuts", "Alt+K");
    expect(container.querySelectorAll("[data-slot='shortcut-hint']")).toHaveLength(1);
  });

  it("is absent without shortcutTarget", () => {
    renderFields(<Field />);
    expect(hint()).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search" })).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("is absent outside the provider", () => {
    render(<SearchInput value="" onChange={() => {}} label="Search" shortcutTarget="top-bar" />);
    expect(hint()).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search" })).not.toHaveAttribute("aria-keyshortcuts");
  });
});
