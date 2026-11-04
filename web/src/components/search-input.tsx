import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";
import { KbdGroup } from "@/components/kbd";
import { useSearchShortcutTarget, type SearchShortcutTarget } from "@/components/search-shortcut";
import { Input } from "@/components/ui/input";
import { Ripple } from "@/components/ui/ripple";
import { FOCUS_SEARCH } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/*
 * The search field with its leading search icon: the top app bar on every page, the Search page, and
 * the Tag page filter. The surrounding form, submit handling, and any button stay with the caller.
 */

export type SearchInputShape = "pill" | "box";

/*
 * The text, padding, outline, and focus treatment come from Input, the M3 outlined text field; each
 * shape adds its leading icon's place and, for the pill, takes the outline away.
 */
const SHAPE_CLASS: Record<SearchInputShape, { field: string; icon: string; input: string }> = {
  /** The M3 search bar, for the top app bar: a 48px pill on surface-container-high with no outline, and a hover state layer. */
  pill: {
    field: "rounded-full bg-surface-container-high text-on-surface",
    icon: "left-4",
    input: "h-12 rounded-full border-0 pl-14 focus-visible:inset-ring-0",
  },
  /** The M3 outlined text field, 56px, with a leading icon. */
  box: {
    field: "",
    icon: "left-3",
    input: "pl-13",
  },
};

/*
 * The keyboard hint shows only from the medium window class (600px) up and on devices with hover and a
 * fine pointer, so phones and narrow windows get none and keep the whole placeholder. The input keeps
 * room for it there (pr-20) whether or not it shows, so text never runs under it.
 * Tailwind finds classes by scanning for whole strings, so the variants are written out in full.
 */
const HINT_CLASS =
  "pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 medium:[@media(hover:hover)_and_(pointer:fine)]:flex";
const HINT_ROOM_CLASS = "medium:[@media(hover:hover)_and_(pointer:fine)]:pr-12";

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
   * Makes this field a target of the / shortcut (search-shortcut.tsx): "page" for the Search
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
  const look = SHAPE_CLASS[shape];

  return (
    <div data-slot="search-input" className={cn("relative w-full min-w-0", look.field)}>
      <SearchIcon
        className={cn("pointer-events-none absolute top-1/2 size-6 -translate-y-1/2 text-on-surface-variant", look.icon)}
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
        className={cn(look.input, shortcutTarget && HINT_ROOM_CLASS)}
      />
      {showHint && (
        <span data-slot="shortcut-hint" aria-hidden="true" className={HINT_CLASS}>
          <KbdGroup keys={FOCUS_SEARCH.keys} />
        </span>
      )}
      {shape === "pill" && <Ripple />}
    </div>
  );
}
