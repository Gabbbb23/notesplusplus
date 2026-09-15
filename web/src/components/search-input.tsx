import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";
import { KbdGroup } from "@/components/kbd";
import { useSearchShortcutTarget, type SearchShortcutTarget } from "@/components/search-shortcut";
import { Input } from "@/components/ui/input";
import { FOCUS_SEARCH } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/*
 * The search field with its magnifier icon: the top bar on every page and the Search page.
 * The surrounding form, submit handling, and any button stay with the caller.
 */

export type SearchInputShape = "pill" | "box";

const SHAPE_CLASS: Record<SearchInputShape, string> = {
  /** Fully rounded, for the top bar. */
  pill: "rounded-full",
  /** The same radius as a button, to sit beside one. */
  box: "rounded-md",
};

/*
 * The keyboard hint shows only from the md width (768px) up and on devices with hover and a fine
 * pointer, so phones and narrow windows get none and keep the whole placeholder. The input keeps
 * room for it there (pr-20) whether or not it shows, so text never runs under it.
 * Tailwind finds classes by scanning for whole strings, so the variants are written out in full.
 */
const HINT_CLASS =
  "pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 md:[@media(hover:hover)_and_(pointer:fine)]:flex";
const HINT_ROOM_CLASS = "md:[@media(hover:hover)_and_(pointer:fine)]:pr-20";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name. */
  label: string;
  placeholder?: string;
  name?: string;
  autoFocus?: boolean;
  /** Default "box". */
  shape?: SearchInputShape;
  /**
   * Makes this field a target of the Alt+K shortcut (search-shortcut.tsx): "page" for the Search
   * page box, which wins, or "top-bar". While the shortcut goes here the field gets
   * aria-keyshortcuts and, when empty and unfocused, the keycap hint.
   */
  shortcutTarget?: SearchShortcutTarget;
}

export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
  name,
  autoFocus,
  shape = "box",
  shortcutTarget,
}: SearchInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const isTarget = useSearchShortcutTarget(shortcutTarget, ref);
  const showHint = isTarget && value === "" && !focused;

  return (
    <div data-slot="search-input" className="relative w-full min-w-0">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={ref}
        type="search"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-label={label}
        aria-keyshortcuts={isTarget ? FOCUS_SEARCH.aria : undefined}
        autoFocus={autoFocus}
        className={cn("h-10 bg-card pl-9 shadow-none", SHAPE_CLASS[shape], shortcutTarget && HINT_ROOM_CLASS)}
      />
      {showHint && (
        <span data-slot="shortcut-hint" aria-hidden="true" className={HINT_CLASS}>
          <KbdGroup keys={FOCUS_SEARCH.keys} />
        </span>
      )}
    </div>
  );
}
