import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FileCodeIcon,
  FileTextIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { PIN_TARGET_NAME, usePins } from "@/components/pins";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportMarkdown, exportPdf, usePdfExportRunning } from "@/lib/export-note";
import type { NoteRef, PinTarget } from "@/lib/types";

/*
 * The three-dot menu for one note: pin it to Home or the sidebar, move it within a pinned list, and
 * export it. The note page header, every note card, and the sidebar's pinned links use it. This is
 * the only module that imports the shadcn DropdownMenu.
 */

const TRIGGER_SLOT = "note-actions-trigger";

export interface NoteActionsMenuProps {
  note: NoteRef;
  /** The pinned list the menu sits in, if any: adds Move up and Move down for that list. */
  pinnedList?: PinTarget;
  /**
   * Called when this menu unpins the note from pinnedList, which removes the menu's own row. Pass
   * the `rowRemoved` callback from usePinnedListFocus, so focus moves to a neighbouring row.
   */
  onRemovedFromList?: () => void;
  /** "default": a 32px button for cards and page headers. "small": 24px, for a sidebar link. */
  size?: "default" | "small";
}

export function NoteActionsMenu({ note, pinnedList, onRemovedFromList, size = "default" }: NoteActionsMenuProps) {
  const pins = usePins();
  const pdfRunning = usePdfExportRunning(note.slug);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Set when a click or Tab leaves the open menu: focus then stays where the user put it.
  const interactedOutside = useRef(false);

  const list = pinnedList ? pins.lists[pinnedList] : undefined;
  const index = list ? list.findIndex((n) => n.slug === note.slug) : -1;

  const togglePin = (target: PinTarget, pinned: boolean) => {
    pins.setPin(note, target, pinned);
    if (!pinned && target === pinnedList) onRemovedFromList?.();
  };

  return (
    // Not modal: the page stays readable, scrollable, and clickable while the small menu is open, and nothing
    // locks the page's scrolling, so opening and closing it never shifts the page.
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) pins.retryLoad();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size={size === "small" ? "icon-xs" : "icon-sm"}
          data-slot={TRIGGER_SLOT}
          aria-label={`More actions for ${note.title}`}
        >
          <EllipsisVerticalIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onInteractOutside={() => {
          interactedOutside.current = true;
        }}
        // After an item or Escape, focus goes back to the button. Radix's own return can scroll the page to it;
        // this one never moves the page.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!interactedOutside.current) triggerRef.current?.focus({ preventScroll: true });
          interactedOutside.current = false;
        }}
      >
        <DropdownMenuCheckboxItem
          checked={pins.isPinned(note.slug, "home")}
          onCheckedChange={(checked) => togglePin("home", checked)}
        >
          Pin to {PIN_TARGET_NAME.home}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={pins.isPinned(note.slug, "sidebar")}
          onCheckedChange={(checked) => togglePin("sidebar", checked)}
        >
          Pin to {PIN_TARGET_NAME.sidebar}
        </DropdownMenuCheckboxItem>
        {pinnedList && list && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={index <= 0} onSelect={() => pins.move(note.slug, pinnedList, "up")}>
              <ArrowUpIcon aria-hidden="true" />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === -1 || index >= list.length - 1}
              onSelect={() => pins.move(note.slug, pinnedList, "down")}
            >
              <ArrowDownIcon aria-hidden="true" />
              Move down
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <DownloadIcon aria-hidden="true" />
            Export as
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36">
            <DropdownMenuItem
              disabled={pdfRunning}
              aria-busy={pdfRunning || undefined}
              onSelect={() => void exportPdf(note)}
            >
              {pdfRunning ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <FileTextIcon aria-hidden="true" />
              )}
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportMarkdown(note)}>
              <FileCodeIcon aria-hidden="true" />
              Markdown
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * For a list of pinned notes whose own menus can remove a row. Put listRef on the element around the
 * rows and pass rowRemoved(index) to that row's menu as onRemovedFromList. When the row goes, focus
 * moves to the menu button of the row that took its place, or of the new last row, instead of
 * dropping to the top of the page.
 */
export function usePinnedListFocus<T extends HTMLElement>(
  rowCount: number,
): { listRef: RefObject<T | null>; rowRemoved: (index: number) => void } {
  const listRef = useRef<T>(null);
  const removedAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    const index = removedAt.current;
    if (index === null) return;
    removedAt.current = null;
    const triggers = listRef.current?.querySelectorAll<HTMLElement>(`[data-slot='${TRIGGER_SLOT}']`);
    if (!triggers || triggers.length === 0) return;
    triggers[Math.min(index, triggers.length - 1)]!.focus({ preventScroll: true });
  }, [rowCount]);

  return {
    listRef,
    rowRemoved: (index) => {
      removedAt.current = index;
    },
  };
}
