import type { ReactNode } from "react";

/*
 * Every keycap in the app. This is the only module that renders a <kbd> element or styles one.
 */

/**
 * The app's own font (a <kbd> defaults to monospace) at 12px medium, muted, on the card surface:
 * 20px tall, 6px side padding, a 1px border, and a 4px radius. No uppercase, shadow, or animation.
 */
const KBD_CLASS =
  "inline-flex h-5 items-center rounded-sm border border-border bg-card px-1.5 font-sans text-xs leading-none font-medium text-muted-foreground";

/** One key, such as "Alt" or "K", written as it should read. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd data-slot="kbd" className={KBD_CLASS}>
      {children}
    </kbd>
  );
}

/** Keys pressed together, 4px apart. */
export function KbdGroup({ keys }: { keys: readonly string[] }) {
  return (
    <span data-slot="kbd-group" className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  );
}
