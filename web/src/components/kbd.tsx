import type { ReactNode } from "react";

/*
 * Every keycap in the app. This is the only module that renders a <kbd> element or styles one.
 */

/**
 * The app's own font (a <kbd> defaults to monospace) in label-medium, on-surface-variant, on
 * surface-container: 20px tall, 6px side padding, a 1px outline-variant border, and the extra-small
 * corner. No uppercase, shadow, or animation.
 */
const KBD_CLASS =
  "inline-flex h-5 items-center rounded-extra-small border border-outline-variant bg-surface-container px-1.5 font-sans text-label-medium text-on-surface-variant";

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
