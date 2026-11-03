import {
  CheckCircle2Icon,
  FileTextIcon,
  FolderIcon,
  HomeIcon,
  InboxIcon,
  MenuIcon,
  NetworkIcon,
  ScrollTextIcon,
  SearchIcon,
  TagIcon,
  BookmarkIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { HistoryNav, HistoryProvider } from "@/components/history-nav";
import { NoteActionsMenu, usePinnedListFocus } from "@/components/note-actions-menu";
import { PinsProvider, usePins } from "@/components/pins";
import { SearchInput } from "@/components/search-input";
import { SearchShortcutProvider } from "@/components/search-shortcut";
import { Button } from "@/components/ui/button";
import { Ripple } from "@/components/ui/ripple";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { noteUrl } from "@/lib/api";
import type { NoteType } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * The app shell, by M3 window size class. Compact: a top app bar with the menu button, the brand mark,
 * Back and Forward, and the search bar; the menu opens the modal navigation drawer. Medium: a
 * navigation rail with the same menu button at its top. Expanded and up: a standard navigation drawer
 * with the pinned notes under the destinations. The rail and the standard drawer each render the
 * destinations, and `hidden` with display variants keeps the one not in use out of the accessibility
 * tree, so assistive tech always finds a single "Main" nav.
 */

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/tags", label: "Tags", icon: TagIcon },
  { to: "/bookmarks", label: "Bookmarks", icon: BookmarkIcon },
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/files", label: "Files", icon: FolderIcon },
  { to: "/check", label: "Check", icon: CheckCircle2Icon },
];

/**
 * The mark and name, linking Home. In a drawer its 16px inset lines the mark up with the item icons;
 * `markOnly` (the compact top app bar) keeps the name for screen readers alone, leaving room for the search bar.
 */
function Brand({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <Link
      to="/"
      className={cn("flex h-12 shrink-0 items-center gap-3 rounded-full text-title-large text-on-surface", markOnly ? "px-2" : "px-4")}
    >
      <span aria-hidden="true" className="grid size-6 place-items-center rounded-small bg-primary text-title-small text-on-primary">
        n
      </span>
      <span className={markOnly ? "sr-only" : undefined}>notes++</span>
    </Link>
  );
}

/** The colours of a drawer item, the destinations and the pinned notes alike: the secondary container while it is the current page. */
function navStateClass(isActive: boolean): string {
  return isActive ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant";
}

/** A navigation drawer item: a 56px pill with a 24px icon and a label-large label. */
function DrawerItem({ item: { to, label, icon: Icon }, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onNavigate}
      className={({ isActive }) => cn("relative flex h-14 items-center gap-3 rounded-full px-4 text-label-large", navStateClass(isActive))}
    >
      <Icon className="size-6 shrink-0" aria-hidden="true" />
      {label}
      <Ripple />
    </NavLink>
  );
}

/**
 * A navigation rail item: the icon in a 56×32 indicator, filled with the secondary container on the
 * current page, and a label-medium label under it. The state layer sits on the indicator.
 */
function RailItem({ item: { to, label, icon: Icon } }: { item: NavItem }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn("flex w-full flex-col items-center gap-1 rounded-medium pb-1 text-label-medium", isActive ? "text-on-surface" : "text-on-surface-variant")
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "relative flex h-8 w-14 items-center justify-center rounded-full",
              isActive && "bg-secondary-container text-on-secondary-container",
            )}
          >
            <Icon className="size-6" aria-hidden="true" />
            <Ripple />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}

function NavLinks({ layout, onNavigate }: { layout: "drawer" | "rail"; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className={cn("flex flex-col", layout === "rail" && "gap-3")}>
      {NAV.map((item) =>
        layout === "rail" ? <RailItem key={item.to} item={item} /> : <DrawerItem key={item.to} item={item} onNavigate={onNavigate} />,
      )}
    </nav>
  );
}

const TYPE_ICON: Record<NoteType, LucideIcon> = {
  note: FileTextIcon,
  hub: NetworkIcon,
  source: ScrollTextIcon,
};

/**
 * The notes pinned to the sidebar, under the destinations: a type icon and the title, at most two
 * lines, in pin order. Each row's menu (shown on hover or focus) pins, unpins, and moves it.
 * Nothing at all while there are none.
 */
function PinnedLinks({ onNavigate }: { onNavigate?: () => void }) {
  const notes = usePins().lists.sidebar;
  const labelId = useId();
  const { listRef, rowRemoved } = usePinnedListFocus<HTMLUListElement>(notes.length);
  if (notes.length === 0) return null;
  return (
    <nav aria-labelledby={labelId} className="mt-2">
      <div id={labelId} className="flex h-14 items-center px-4 text-title-small text-on-surface-variant">
        Pinned
      </div>
      <ul ref={listRef} className="flex flex-col">
        {notes.map((note, index) => {
          const Icon = TYPE_ICON[note.type];
          return (
            <li key={note.slug} className="group/pin relative">
              {/* Two lines of label-large and 8px above and below make a 56px row, the height of a one-line item. */}
              <NavLink
                to={noteUrl(note.slug)}
                onClick={onNavigate}
                title={note.title}
                data-slot="pinned-link"
                className={({ isActive }) =>
                  cn(
                    "relative flex min-h-14 min-w-0 items-center gap-3 rounded-full py-2 pr-12 pl-4 text-label-large",
                    navStateClass(isActive),
                  )
                }
              >
                <Icon className="size-6 shrink-0" aria-hidden="true" />
                <span className="line-clamp-2 min-w-0 wrap-anywhere">{note.title}</span>
                <Ripple />
              </NavLink>
              {/* Hidden until the row is hovered or holds focus, and while its menu is open; always shown without a mouse. */}
              <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-focus-within/pin:opacity-100 group-hover/pin:opacity-100 has-data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
                <NoteActionsMenu
                  note={note}
                  pinnedList="sidebar"
                  size="small"
                  onRemovedFromList={() => rowRemoved(index)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The search bar shown on every page. Submits to /search?q=... on Enter. */
function TopSearch({ className }: { className?: string }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const current = location.pathname === "/search" ? (params.get("q") ?? "") : "";
  const [q, setQ] = useState(current);

  useEffect(() => {
    setQ(current);
  }, [current]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = q.trim();
    if (trimmed === "") return;
    const next = new URLSearchParams();
    next.set("q", trimmed);
    // Keep the mode and filters when already on the search page.
    if (location.pathname === "/search") {
      for (const k of ["mode", "tag", "type"]) {
        const v = params.get(k);
        if (v) next.set(k, v);
      }
    }
    navigate(`/search?${next.toString()}`);
  };

  return (
    <form role="search" onSubmit={submit} className={className}>
      <SearchInput
        name="q"
        value={q}
        onChange={setQ}
        placeholder="Search notes and files"
        label="Search"
        shape="pill"
        shortcutTarget="top-bar"
      />
    </form>
  );
}

function subscribeToScroll(onChange: () => void): () => void {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

const pageIsScrolled = () => window.scrollY > 0;

/** Whether the page is scrolled down at all, so the top app bar takes the colour of content scrolled under it. */
function usePageScrolled(): boolean {
  return useSyncExternalStore(subscribeToScroll, pageIsScrolled);
}

/** The standard icon button that opens the modal navigation drawer, in the compact top app bar and at the top of the rail. */
function MenuButton({ className, onOpen }: { className?: string; onOpen: (button: HTMLElement) => void }) {
  return (
    <SheetTrigger asChild>
      <Button
        variant="standard"
        size="icon"
        className={className}
        aria-label="Open menu"
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <MenuIcon aria-hidden="true" />
      </Button>
    </SheetTrigger>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  // Two buttons open the drawer, and Radix returns focus to whichever mounted last, which may be the hidden one.
  const opener = useRef<HTMLElement | null>(null);
  const rememberOpener = (button: HTMLElement) => {
    opener.current = button;
  };
  const close = () => setOpen(false);
  const scrolled = usePageScrolled();

  return (
    // Mounts the one Alt+K listener and the registry that the search fields join, the one copy of the pins,
    // and the history position and scroll memory behind Back and Forward.
    <SearchShortcutProvider>
      <PinsProvider>
        <HistoryProvider>
          <Sheet open={open} onOpenChange={setOpen}>
            <div className="min-h-screen medium:flex">
              <aside
                data-slot="navigation-rail"
                className="sticky top-0 hidden h-screen w-20 shrink-0 flex-col items-center bg-surface medium:flex expanded:hidden"
              >
                <div className="flex h-16 shrink-0 items-center">
                  <MenuButton onOpen={rememberOpener} />
                </div>
                {/* The inset leaves room for each item's focus outline inside the scrolling area. */}
                <div className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto p-1.5">
                  <NavLinks layout="rail" />
                </div>
              </aside>

              <aside
                data-slot="navigation-drawer"
                className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col bg-surface-container-low expanded:flex"
              >
                <div className="flex h-16 shrink-0 items-center px-3">
                  <Brand />
                </div>
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
                  <NavLinks layout="drawer" />
                  <PinnedLinks />
                </div>
                <div className="px-7 py-4 text-body-small text-on-surface-variant">The agent writes the notes.</div>
              </aside>

              <div className="flex min-w-0 flex-1 flex-col">
                <header
                  data-slot="top-app-bar"
                  className={cn(
                    "sticky top-0 z-10 flex h-16 items-center gap-2 px-2 transition-colors duration-200 ease-standard medium:px-4 expanded:px-6",
                    scrolled ? "bg-surface-container" : "bg-surface",
                  )}
                >
                  <MenuButton className="medium:hidden" onOpen={rememberOpener} />
                  <div className="medium:hidden">
                    <Brand markOnly />
                  </div>
                  <HistoryNav className="flex shrink-0 items-center gap-1" />
                  <TopSearch className="ml-auto w-full max-w-md min-w-0" />
                </header>

                <main className="mx-auto w-full max-w-[52rem] flex-1 px-4 py-8 medium:px-6">
                  <Outlet />
                </main>
              </div>
            </div>

            <SheetContent
              side="left"
              className="gap-0 px-3"
              // Radix focuses the first button that is not a link, which is now a pinned row's menu. Keep it on Close.
              onOpenAutoFocus={(event) => {
                const closeButton = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-slot='sheet-close-button']");
                if (!closeButton) return;
                event.preventDefault();
                closeButton.focus();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                opener.current?.focus();
              }}
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">Pages of the notes app</SheetDescription>
              <div className="flex h-16 shrink-0 items-center">
                <Brand />
              </div>
              <div className="-mx-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
                <NavLinks layout="drawer" onNavigate={close} />
                <PinnedLinks onNavigate={close} />
              </div>
            </SheetContent>
          </Sheet>
        </HistoryProvider>
        <Toaster position="bottom-center" />
      </PinsProvider>
    </SearchShortcutProvider>
  );
}
