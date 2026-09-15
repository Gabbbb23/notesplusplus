import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * The "show more" pattern for a list that grows in place: the Search page's results and the Tag
 * page's notes. Pages never build their own "Show more" button.
 */

/** The button's row and the cap line sit the same distance under the list. */
const SPACING = "mt-4";

export interface ShowMoreProps {
  /** What the button fetches: "Show more results", "Show more notes". */
  label: string;
  /** A request for more is on its way: the button stays where it is, disabled, with a spinner. */
  loading: boolean;
  /** How much of the list is shown, beside the button: "Showing 50 of 93". */
  progress?: ReactNode;
  onClick: () => void;
}

/**
 * An outline button under a list, and an optional progress text beside it that the button
 * names as its description. The icon swaps for a spinner while loading, so the button keeps its width.
 */
export function ShowMore({ label, loading, progress, onClick }: ShowMoreProps) {
  const progressId = useId();
  const Icon = loading ? Loader2Icon : ChevronDownIcon;
  return (
    <div data-slot="show-more" className={cn(SPACING, "flex flex-wrap items-center gap-x-3 gap-y-2")}>
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        aria-busy={loading || undefined}
        aria-describedby={progress ? progressId : undefined}
        onClick={onClick}
      >
        <Icon aria-hidden="true" className={loading ? "animate-spin" : undefined} />
        {label}
      </Button>
      {progress && (
        <span id={progressId} className="text-sm text-muted-foreground">
          {progress}
        </span>
      )}
    </div>
  );
}

/** A muted line in the button's place when a list stops growing at a cap: "Showing the top 100. ..." */
export function ShowMoreLimit({ children }: { children: ReactNode }) {
  return (
    <p data-slot="show-more-limit" className={cn(SPACING, "text-sm text-muted-foreground")}>
      {children}
    </p>
  );
}

const FOCUSABLE = "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";

/**
 * Moves focus into the first card that "show more" added, so a keyboard user carries on from the
 * new results instead of from a button that has moved below them.
 *
 * Put `listRef` on the element around the cards (`ItemCard`s) and call `expectMore()` when the
 * button is clicked. `count` is the number of cards rendered now; once it grows past the count at
 * the click, focus goes to the first link or button in the first new card. `listKey` names the
 * list (the query, the tag): when it changes, the pending focus is dropped, so a new search never
 * takes the focus away from the form.
 */
export function useFocusFirstNew(count: number, listKey: string) {
  const listRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ from: number; key: string } | null>(null);

  useEffect(() => {
    const wanted = pending.current;
    if (!wanted) return;
    if (wanted.key !== listKey) {
      pending.current = null;
      return;
    }
    if (count <= wanted.from) return;
    pending.current = null;
    const card = listRef.current?.querySelectorAll<HTMLElement>("[data-slot='item-card']")[wanted.from];
    if (!card) return;
    const target = card.querySelector<HTMLElement>(FOCUSABLE);
    if (target) {
      target.focus();
    } else {
      card.tabIndex = -1;
      card.focus();
    }
  }, [count, listKey]);

  const expectMore = useCallback(() => {
    pending.current = { from: count, key: listKey };
  }, [count, listKey]);

  return { listRef, expectMore };
}
