import { useEffect } from "react";

/*
 * The browser tab title. This is the only module that writes document.title; PageHeader calls
 * usePageTitle, so a page's tab title comes from the same place as its h1.
 */

export const APP_NAME = "notes++";

/** "College · notes++", or the app name alone for an empty or missing name. */
export function pageTitle(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? `${trimmed} · ${APP_NAME}` : APP_NAME;
}

/**
 * Sets the tab title while the calling component is mounted, and puts the app name back when it
 * unmounts. So a page that swaps its header for a loading or error state shows "notes++" instead of
 * the previous page's title.
 */
export function usePageTitle(name?: string): void {
  useEffect(() => {
    document.title = pageTitle(name);
    return () => {
      document.title = APP_NAME;
    };
  }, [name]);
}
