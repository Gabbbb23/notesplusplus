import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
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
}

export function SearchInput({ value, onChange, label, placeholder, name, autoFocus, shape = "box" }: SearchInputProps) {
  return (
    <div data-slot="search-input" className="relative w-full min-w-0">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        className={cn("h-10 bg-card pl-9 shadow-none", SHAPE_CLASS[shape])}
      />
    </div>
  );
}
