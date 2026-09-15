import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteActionsMenu } from "../src/components/note-actions-menu";
import { PinsProvider } from "../src/components/pins";
import { exportPdf, filenameFromContentDisposition } from "../src/lib/export-note";
import type { PinTarget } from "../src/lib/types";
import { apiError, callsTo, deferred, pinned, reply, resetToasts, settle, stubApi, summary, type Route } from "./api-stub";

const RIZAL = summary("rizal-day", "Rizal Day");
const BUDGET = summary("fields-budget", "Fields budget", "hub");
const SPECS = summary("ryzen-laptop-specs", "Ryzen laptop specs", "source");

function renderMenu(
  note = RIZAL,
  { pinnedList, routes = {} }: { pinnedList?: PinTarget; routes?: Record<string, Route> } = {},
) {
  const fetchMock = stubApi({ "/api/pins": () => reply(200, pinned([RIZAL], [])), ...routes });
  render(
    <MemoryRouter>
      <PinsProvider>
        <NoteActionsMenu note={note} pinnedList={pinnedList} />
      </PinsProvider>
      <Toaster />
    </MemoryRouter>,
  );
  return fetchMock;
}

const trigger = (title = "Rizal Day") => screen.getByRole("button", { name: `More actions for ${title}` });

/** Open the menu from the keyboard, as a keyboard user would: focus the button, press a key. */
async function openMenu(key: "Enter" | " " = "Enter", title?: string) {
  const button = trigger(title);
  act(() => button.focus());
  fireEvent.keyDown(button, { key });
  return screen.findByRole("menu");
}

const item = (name: string) => screen.getByRole("menuitem", { name });
const checkbox = (name: string) => screen.getByRole("menuitemcheckbox", { name });

/** Open "Export as" from the keyboard and return its submenu. */
async function openExport() {
  await openMenu();
  const exportAs = item("Export as");
  act(() => exportAs.focus());
  fireEvent.keyDown(exportAs, { key: "ArrowRight" });
  const menus = await screen.findAllByRole("menu");
  return menus.find((m) => within(m).queryByRole("menuitem", { name: "PDF" }))!;
}

/** The links export-note.ts clicks to start a download, captured instead of followed. */
function captureDownloads() {
  const clicks: Array<{ href: string | null; download: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute("href"), download: this.download });
  });
  return clicks;
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:notes-pdf");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  resetToasts();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("<NoteActionsMenu> trigger", () => {
  it("is a ghost icon button named after the note", async () => {
    renderMenu();
    const button = trigger();
    expect(button).toHaveAttribute("data-variant", "ghost");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveTextContent("");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await settle();
  });

  it("opens with Enter or Space, and the arrow keys move through the items", async () => {
    renderMenu();
    await settle();

    const menu = await openMenu("Enter");
    const items = Array.from(menu.querySelectorAll<HTMLElement>("[role^='menuitem']"));
    expect(items.map((i) => i.textContent)).toEqual(["Pin to Home", "Pin to sidebar", "Export as"]);
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    await waitFor(() => expect(items[1]).toHaveFocus());
    fireEvent.keyDown(items[1]!, { key: "ArrowDown" });
    await waitFor(() => expect(items[2]).toHaveFocus());

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await openMenu(" ");
    expect(checkbox("Pin to Home")).toBeInTheDocument();
  });
});

describe("<NoteActionsMenu> pins", () => {
  it("checks Pin to Home and Pin to sidebar from the pins", async () => {
    renderMenu();
    await settle();
    await openMenu();

    expect(checkbox("Pin to Home")).toHaveAttribute("aria-checked", "true");
    expect(checkbox("Pin to sidebar")).toHaveAttribute("aria-checked", "false");
  });

  it("toggling puts the pin as the web tool, closes the menu, and puts focus back on the button", async () => {
    const fetchMock = renderMenu(RIZAL, {
      routes: { "PUT /api/pins/sidebar": () => reply(200, pinned([RIZAL], [RIZAL])) },
    });
    await settle();
    await openMenu();

    fireEvent.keyDown(checkbox("Pin to sidebar"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(trigger()).toHaveFocus());
    const [call] = callsTo(fetchMock, "PUT /api/pins/sidebar");
    expect(call!.body).toEqual({ slug: "rizal-day", pinned: true });
    expect(call!.headers.get("X-Brain-Tool")).toBe("web");
    expect(await screen.findByText("Pinned to sidebar")).toBeInTheDocument();

    await openMenu();
    expect(checkbox("Pin to sidebar")).toHaveAttribute("aria-checked", "true");
  });

  it("unchecking Pin to Home unpins it", async () => {
    const fetchMock = renderMenu(RIZAL, { routes: { "PUT /api/pins/home": () => reply(200, pinned([], [])) } });
    await settle();
    await openMenu();

    fireEvent.click(checkbox("Pin to Home"));

    expect(await screen.findByText("Unpinned from Home")).toBeInTheDocument();
    expect(callsTo(fetchMock, "PUT /api/pins/home").map((c) => c.body)).toEqual([{ slug: "rizal-day", pinned: false }]);
  });

  it("offers Move up and Move down only in a pinned list", async () => {
    renderMenu();
    await settle();
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move down" })).toBeNull();
  });

  it.each([
    ["the first", RIZAL, { up: false, down: true }],
    ["a middle", BUDGET, { up: true, down: true }],
    ["the last", SPECS, { up: true, down: false }],
  ] as const)("disables the move that would go past the end for %s pin", async (_label, note, enabled) => {
    renderMenu(note, { pinnedList: "home", routes: { "/api/pins": () => reply(200, pinned([RIZAL, BUDGET, SPECS])) } });
    await settle();
    await openMenu("Enter", note.title);

    const expectEnabled = (name: string, on: boolean) =>
      on ? expect(item(name)).not.toHaveAttribute("aria-disabled") : expect(item(name)).toHaveAttribute("aria-disabled", "true");
    expectEnabled("Move up", enabled.up);
    expectEnabled("Move down", enabled.down);
  });

  it("Move down puts the new order", async () => {
    const fetchMock = renderMenu(RIZAL, {
      pinnedList: "home",
      routes: {
        "/api/pins": () => reply(200, pinned([RIZAL, BUDGET])),
        "PUT /api/pins/home/order": () => reply(200, pinned([BUDGET, RIZAL])),
      },
    });
    await settle();
    await openMenu();

    fireEvent.click(item("Move down"));
    await settle();

    expect(callsTo(fetchMock, "PUT /api/pins/home/order").map((c) => c.body)).toEqual([{ slugs: ["fields-budget", "rizal-day"] }]);
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
});

describe("<NoteActionsMenu> Export as", () => {
  it("opens its submenu with ArrowRight and offers PDF and Markdown", async () => {
    renderMenu();
    await settle();
    const submenu = await openExport();

    expect(within(submenu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["PDF", "Markdown"]);
    expect(item("Export as")).toHaveAttribute("aria-expanded", "true");
  });

  it("Markdown downloads the export URL as <slug>.md through a same-origin link", async () => {
    const downloads = captureDownloads();
    renderMenu();
    await settle();
    await openExport();

    fireEvent.click(item("Markdown"));

    expect(downloads).toEqual([{ href: "/api/notes/rizal-day/export.md", download: "rizal-day.md" }]);
    expect(await screen.findByText("Downloaded rizal-day.md")).toBeInTheDocument();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("PDF shows a loading toast, then saves the blob under the server's file name and revokes its URL", async () => {
    const downloads = captureDownloads();
    const pdf = deferred();
    const fetchMock = renderMenu(RIZAL, { routes: { "/api/notes/rizal-day/export.pdf": pdf.route } });
    await settle();
    await openExport();

    fireEvent.click(item("PDF"));

    expect(await screen.findByText("Preparing PDF of Rizal Day…")).toBeInTheDocument();
    expect(callsTo(fetchMock, "GET /api/notes/rizal-day/export.pdf")).toHaveLength(1);

    const blob = new Blob(["%PDF-1.7"], { type: "application/pdf" });
    await pdf.release(
      reply(200, null, {
        blob,
        headers: { "Content-Disposition": `attachment; filename="Rizal_s Day.pdf"; filename*=UTF-8''Rizal%E2%80%99s%20Day.pdf` },
      }),
    );

    expect(await screen.findByText("Downloaded Rizal’s Day.pdf")).toBeInTheDocument();
    expect(screen.queryByText("Preparing PDF of Rizal Day…")).toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(downloads).toEqual([{ href: "blob:notes-pdf", download: "Rizal’s Day.pdf" }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:notes-pdf");
  });

  it("PDF falls back to <title>.pdf when the server names no file", async () => {
    const downloads = captureDownloads();
    renderMenu(RIZAL, { routes: { "/api/notes/rizal-day/export.pdf": () => reply(200, null, { blob: new Blob(["%PDF"]) }) } });
    await settle();
    await openExport();

    fireEvent.click(item("PDF"));

    expect(await screen.findByText("Downloaded Rizal Day.pdf")).toBeInTheDocument();
    expect(downloads.map((d) => d.download)).toEqual(["Rizal Day.pdf"]);
  });

  it("PDF opens the print page with autoprint when Edge is unavailable", async () => {
    const open = vi.fn(() => ({ opener: window }) as unknown as Window);
    vi.stubGlobal("open", open);
    renderMenu(RIZAL, {
      routes: { "/api/notes/rizal-day/export.pdf": () => apiError(503, "pdf_unavailable", "Microsoft Edge could not be started") },
    });
    await settle();
    await openExport();

    fireEvent.click(item("PDF"));

    expect(await screen.findByText("Opening the print dialog; choose Save as PDF")).toBeInTheDocument();
    expect(open).toHaveBeenCalledWith("/print/notes/rizal-day?autoprint=1", "_blank");
    expect(open.mock.results[0]!.value.opener).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("PDF shows the server's message on any other error", async () => {
    renderMenu(RIZAL, {
      routes: {
        "/api/notes/rizal-day/export.pdf": () => apiError(500, "export_failed", "the print page could not render the note: boom"),
      },
    });
    await settle();
    await openExport();

    fireEvent.click(item("PDF"));

    expect(await screen.findByText("the print page could not render the note: boom")).toBeInTheDocument();
    expect(screen.getByText("Could not export Rizal Day as PDF")).toBeInTheDocument();
  });

  it("PDF is busy and disabled while its export runs, and a second one starts nothing", async () => {
    captureDownloads();
    const pdf = deferred();
    const fetchMock = renderMenu(RIZAL, { routes: { "/api/notes/rizal-day/export.pdf": pdf.route } });
    await settle();
    await openExport();

    fireEvent.click(item("PDF"));
    await screen.findByText("Preparing PDF of Rizal Day…");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await openExport();
    const busy = item("PDF");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveAttribute("aria-busy", "true");
    fireEvent.click(busy);
    await act(() => exportPdf(RIZAL));
    expect(callsTo(fetchMock, "GET /api/notes/rizal-day/export.pdf")).toHaveLength(1);

    await pdf.release(reply(200, null, { blob: new Blob(["%PDF"]) }));
    await screen.findByText("Downloaded Rizal Day.pdf");
    expect(item("PDF")).not.toHaveAttribute("aria-disabled");
  });
});

describe("filenameFromContentDisposition", () => {
  it("prefers the UTF-8 filename*, then the quoted or bare filename", () => {
    expect(filenameFromContentDisposition(`attachment; filename="a_b.pdf"; filename*=UTF-8''a%E2%80%99b.pdf`)).toBe("a’b.pdf");
    expect(filenameFromContentDisposition(`attachment; filename="Rizal \\"Day\\".pdf"`)).toBe(`Rizal "Day".pdf`);
    expect(filenameFromContentDisposition("attachment; filename=notes.pdf")).toBe("notes.pdf");
    expect(filenameFromContentDisposition(`attachment; filename*=UTF-8''%E0%A4%A; filename="fallback.pdf"`)).toBe("fallback.pdf");
    expect(filenameFromContentDisposition("attachment")).toBeNull();
    expect(filenameFromContentDisposition(null)).toBeNull();
  });
});
