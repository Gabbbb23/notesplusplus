import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupActionsMenu, NoteActionsMenu } from "../src/components/note-actions-menu";
import { PinsProvider } from "../src/components/pins";
import { pinned, reply, settle, stubApi, summary } from "./api-stub";

const RIZAL = summary("rizal-day", "Rizal Day");
const GROUPS = { groups: [{ name: "college", slugs: ["rizal-day"] }, { name: "to-read", slugs: [] }] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Bookmark dialog", () => {
  async function openFromMenu() {
    stubApi({ "/api/pins": () => reply(200, pinned([], [])), "/api/bookmarks": () => reply(200, GROUPS) });
    render(
      <MemoryRouter>
        <PinsProvider>
          <NoteActionsMenu note={RIZAL} />
        </PinsProvider>
      </MemoryRouter>,
    );
    await settle();
    const trigger = screen.getByRole("button", { name: "More actions for Rizal Day" });
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("button", { name: "Bookmark" }));
    return screen.findByRole("dialog", { name: "Bookmark “Rizal Day”" });
  }

  it("lists each group as a checkbox, checked where the note is bookmarked", async () => {
    const dialog = await openFromMenu();
    await waitFor(() => expect(within(dialog).getByRole("checkbox", { name: "college" })).toBeChecked());
    expect(within(dialog).getByRole("checkbox", { name: "to read" })).not.toBeChecked();
    expect(within(dialog).getByRole("textbox", { name: "New bookmark group" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(["", "Cancel", "Save"]);
    expect(within(dialog).getByRole("button", { name: "Add to new group" })).toBeDisabled();
  });

  it("leaves the field and its caret alone when the pointer moves over it, though the menu item around the button would take focus", async () => {
    const dialog = await openFromMenu();
    const field = within(dialog).getByRole<HTMLInputElement>("textbox", { name: "New bookmark group" });
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "Readings" } });
    field.setSelectionRange(8, 8);
    fireEvent.pointerMove(field, { pointerType: "mouse" });
    expect(field).toHaveFocus();
    // Focus pulled out and back by the dialog's focus trap would select the whole text.
    expect([field.selectionStart, field.selectionEnd]).toEqual([8, 8]);
  });

  it("Cancel closes it", async () => {
    const dialog = await openFromMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("<GroupActionsMenu>", () => {
  async function open(index: number, count: number, onMove = vi.fn()) {
    render(<GroupActionsMenu name="to read" index={index} count={count} onMove={onMove} />);
    const trigger = screen.getByRole("button", { name: "More actions for to read" });
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen.findByRole("menu");
  }

  it("offers Move up and Move down, the first disabled for the top group", async () => {
    const menu = await open(0, 2);
    expect(within(menu).getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Move down" })).not.toHaveAttribute("aria-disabled");
  });

  it("Move down calls onMove", async () => {
    const onMove = vi.fn();
    const menu = await open(0, 2, onMove);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Move down" }));
    expect(onMove).toHaveBeenCalledWith("down");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("disables Move down for the bottom group", async () => {
    const menu = await open(1, 2);
    expect(within(menu).getByRole("menuitem", { name: "Move down" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Move up" })).not.toHaveAttribute("aria-disabled");
  });
});
