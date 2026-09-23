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
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { NoteActionsMenu, usePinnedListFocus } from "@/components/note-actions-menu";
import { PinsProvider, usePins } from "@/components/pins";
import { SearchInput } from "@/components/search-input";
import { SearchShortcutProvider } from "@/components/search-shortcut";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { noteUrl } from "@/lib/api";
import type { NoteType } from "@/lib/types";
import { cn } from "@/lib/utils";

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

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 px-2 text-lg font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
        n
      </span>
      notes++
    </Link>
  );
}

/** The colours of a sidebar link, the page links and the pinned links alike: accent while it is the current page. */
function navStateClass(isActive: boolean): string {
  return isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-muted";
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", navStateClass(isActive))
          }
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

const TYPE_ICON: Record<NoteType, LucideIcon> = {
  note: FileTextIcon,
  hub: NetworkIcon,
  source: ScrollTextIcon,
};

/**
 * The notes pinned to the sidebar, under the page links: a type icon and the title, at most two
 * lines, in pin order. Each row's menu (shown on hover or focus) pins, unpins, and moves it.
 * Nothing at all while there are none.
 */
function PinnedLinks({ onNavigate }: { onNavigate?: () => void }) {
  const notes = usePins().lists.sidebar;
  const labelId = useId();
  const { listRef, rowRemoved } = usePinnedListFocus<HTMLUListElement>(notes.length);
  if (notes.length === 0) return null;
  return (
    <nav aria-labelledby={labelId} className="mt-5">
      <div id={labelId} className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Pinned
      </div>
      <ul ref={listRef} className="flex flex-col gap-0.5">
        {notes.map((note, index) => {
          const Icon = TYPE_ICON[note.type];
          return (
            <li key={note.slug} className="group/pin relative">
              <NavLink
                to={noteUrl(note.slug)}
                onClick={onNavigate}
                title={note.title}
                data-slot="pinned-link"
                className={({ isActive }) =>
                  cn(
                    "flex min-w-0 items-start gap-2.5 rounded-md py-1.5 pr-9 pl-3 text-sm transition-colors",
                    navStateClass(isActive),
                    !isActive && "group-hover/pin:bg-muted",
                  )
                }
              >
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="line-clamp-2 min-w-0 wrap-anywhere">{note.title}</span>
              </NavLink>
              {/* Hidden until the row is hovered or holds focus, and while its menu is open; always shown without a mouse. */}
              <div className="absolute top-1 right-1 opacity-0 group-focus-within/pin:opacity-100 group-hover/pin:opacity-100 has-data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
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

/** The search box shown on every page. Submits to /search?q=... on Enter. */
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

export function Layout() {
  const [open, setOpen] = useState(false);
  return (
    // Mounts the one Alt+K listener and the registry that the search fields join, and the one copy of the pins.
    <SearchShortcutProvider>
      <PinsProvider>
        <div className="min-h-screen md:flex">
          {/* Sidebar, desktop */}
          <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:sticky md:top-0 md:flex md:h-screen md:flex-col">
            <div className="flex h-16 items-center px-3">
              <Brand />
            </div>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
              <NavLinks />
              <PinnedLinks />
            </div>
            <div className="px-5 py-4 text-xs text-muted-foreground">The agent writes the notes.</div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Top bar: search everywhere, plus the menu button under 768px */}
            <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-8">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                    <MenuIcon />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-64 bg-sidebar p-3"
                  // Radix focuses the first button that is not a link, which is now a pinned row's menu. Keep it on Close.
                  onOpenAutoFocus={(event) => {
                    const close = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-slot='sheet-close-button']");
                    if (!close) return;
                    event.preventDefault();
                    close.focus();
                  }}
                >
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <SheetDescription className="sr-only">Pages of the notes app</SheetDescription>
                  <div className="mb-4 flex h-10 items-center">
                    <Brand />
                  </div>
                  <div className="-mx-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3">
                    <NavLinks onNavigate={() => setOpen(false)} />
                    <PinnedLinks onNavigate={() => setOpen(false)} />
                  </div>
                </SheetContent>
              </Sheet>
              <div className="md:hidden">
                <Brand />
              </div>
              <TopSearch className="ml-auto w-full max-w-md" />
            </header>

            <main className="mx-auto w-full max-w-[52rem] flex-1 px-4 py-8 md:px-8">
              <Outlet />
            </main>
          </div>
        </div>
        <Toaster position="bottom-right" />
      </PinsProvider>
    </SearchShortcutProvider>
  );
}
