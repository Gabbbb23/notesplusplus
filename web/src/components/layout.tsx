import {
  CheckCircle2Icon,
  FolderIcon,
  HomeIcon,
  InboxIcon,
  MenuIcon,
  SearchIcon,
  TagIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-muted",
            )
          }
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
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
      <SearchInput name="q" value={q} onChange={setQ} placeholder="Search notes and files" label="Search" shape="pill" />
    </form>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar, desktop */}
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="flex h-16 items-center px-3">
          <Brand />
        </div>
        <div className="px-3">
          <NavLinks />
        </div>
        <div className="mt-auto px-5 py-4 text-xs text-muted-foreground">Read-only. The agent writes.</div>
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
            <SheetContent side="left" className="w-64 bg-sidebar p-3">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">Pages of the notes app</SheetDescription>
              <div className="mb-4 flex h-10 items-center">
                <Brand />
              </div>
              <NavLinks onNavigate={() => setOpen(false)} />
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
  );
}
