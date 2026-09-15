import { Fragment, type ReactNode } from "react";
import { breakPieces } from "@/lib/break-points";
import { cn } from "@/lib/utils";

type BreakableTag = "span" | "code" | "p" | "div";

/**
 * A string that wraps at natural points instead of pushing the page sideways.
 * The break points come from breakPieces in lib/break-points.ts; as a last resort the
 * text breaks anywhere. Use it for file paths, slugs, tag names, inbox item names, and titles.
 */
export function BreakableText({
  text,
  className,
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  as?: BreakableTag;
}) {
  const pieces = breakPieces(text);
  const children: ReactNode[] = pieces.map((piece, i) => (
    <Fragment key={i}>
      {piece}
      {i < pieces.length - 1 && <wbr />}
    </Fragment>
  ));
  return (
    <Tag data-slot="breakable-text" className={cn("wrap-anywhere", className)}>
      {children}
    </Tag>
  );
}
