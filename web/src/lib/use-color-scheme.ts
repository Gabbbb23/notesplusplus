import { useSyncExternalStore } from "react";

/*
 * The system colour scheme, which theme.css follows. Something that reads the colour roles once, such as
 * a drawn diagram, uses this to read them again when Windows switches between light and dark.
 */

export type ColorScheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** null where there is no matchMedia (jsdom, server rendering): the scheme then reads as light. */
function darkQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const query = darkQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function currentScheme(): ColorScheme {
  return darkQuery()?.matches ? "dark" : "light";
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, currentScheme, () => "light");
}
