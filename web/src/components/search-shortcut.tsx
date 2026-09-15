import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { FOCUS_SEARCH, matchesShortcut } from "@/lib/shortcuts";

/*
 * The Alt+K shortcut that focuses the search field. Search fields register here through
 * SearchInput's shortcutTarget prop; nothing else looks fields up in the page. Layout mounts the
 * provider once, and with it the one global keydown listener.
 */

/** Where a search field sits. A Search page box takes priority over the top bar. */
export type SearchShortcutTarget = "page" | "top-bar";

const PRIORITY: readonly SearchShortcutTarget[] = ["page", "top-bar"];
const SEARCH_PATH = "/search";

/** Shown means rendered, connected, and not hidden by display: none or visibility: hidden. */
export function isShown(input: HTMLElement): boolean {
  if (!input.isConnected || getComputedStyle(input).visibility === "hidden") return false;
  for (let node: HTMLElement | null = input; node; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return false;
  }
  return true;
}

function focusAndSelect(input: HTMLInputElement) {
  input.focus();
  input.select();
}

export interface SearchShortcutRegistry {
  /** Add a field; returns the function that removes it. The latest field of a kind wins. */
  register(kind: SearchShortcutTarget, input: HTMLInputElement): () => void;
  subscribe(listener: () => void): () => void;
  /** The kind the shortcut goes to while every field is shown, or null when none is registered. */
  activeKind(): SearchShortcutTarget | null;
  /** The field to focus now: the highest-priority field that is shown, or null. */
  target(shown?: (input: HTMLInputElement) => boolean): HTMLInputElement | null;
  /** Focus and select the next page box that registers (after navigating to /search). */
  focusPageBoxWhenRegistered(): void;
}

export function createSearchShortcutRegistry(): SearchShortcutRegistry {
  const fields: Array<{ kind: SearchShortcutTarget; input: HTMLInputElement }> = [];
  const listeners = new Set<() => void>();
  let focusNextPageBox = false;
  const emit = () => listeners.forEach((listener) => listener());
  const latest = (kind: SearchShortcutTarget) => fields.findLast((f) => f.kind === kind);

  return {
    register(kind, input) {
      const field = { kind, input };
      fields.push(field);
      if (kind === "page" && focusNextPageBox) {
        focusNextPageBox = false;
        focusAndSelect(input);
      }
      emit();
      return () => {
        const i = fields.indexOf(field);
        if (i !== -1) fields.splice(i, 1);
        emit();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activeKind() {
      return PRIORITY.find((kind) => latest(kind)) ?? null;
    },
    target(shown = isShown) {
      for (const kind of PRIORITY) {
        const field = fields.findLast((f) => f.kind === kind && shown(f.input));
        if (field) return field.input;
      }
      return null;
    },
    focusPageBoxWhenRegistered() {
      focusNextPageBox = true;
    },
  };
}

const SearchShortcutContext = createContext<SearchShortcutRegistry | null>(null);

/**
 * Holds the search fields and listens for Alt+K anywhere on the page, including inside another
 * input. Alt+K focuses the Search page box on /search, the top bar field elsewhere, and selects its
 * text. When no field is shown, it opens /search and focuses the box there.
 */
export function SearchShortcutProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createSearchShortcutRegistry);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The listener is added once; it reads the current route through this ref.
  const route = useRef({ navigate, pathname });
  useEffect(() => {
    route.current = { navigate, pathname };
  }, [navigate, pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(FOCUS_SEARCH, event)) return;
      event.preventDefault();
      const input = registry.target();
      if (input) {
        focusAndSelect(input);
        return;
      }
      if (route.current.pathname === SEARCH_PATH) return;
      registry.focusPageBoxWhenRegistered();
      route.current.navigate(SEARCH_PATH);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry]);

  return <SearchShortcutContext.Provider value={registry}>{children}</SearchShortcutContext.Provider>;
}

const noSubscribe = () => () => {};
const noKind = () => null;

/**
 * Registers a search field as a shortcut target while it is mounted. Returns true when the
 * shortcut goes to this field, so it can announce the shortcut and show the hint. Outside a
 * SearchShortcutProvider, or without a kind, it registers nothing and returns false.
 */
export function useSearchShortcutTarget(
  kind: SearchShortcutTarget | undefined,
  ref: RefObject<HTMLInputElement | null>,
): boolean {
  const registry = useContext(SearchShortcutContext);
  useEffect(() => {
    const input = ref.current;
    if (!registry || !kind || !input) return;
    return registry.register(kind, input);
  }, [registry, kind, ref]);
  const active = useSyncExternalStore(registry?.subscribe ?? noSubscribe, registry?.activeKind ?? noKind);
  return kind !== undefined && active === kind;
}
