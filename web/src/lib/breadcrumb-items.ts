import { noteUrl, tagUrl } from "./api";
import type { NoteTrail } from "./types";

/*
 * Which breadcrumbs each page shows. A trail names where a page sits, never the page itself: the
 * title right below the breadcrumbs already shows it. Home stands in for the root hub `index`,
 * which the Home page shows. The Home page itself has no breadcrumbs.
 */

/** One breadcrumb: its label and the in-app route it links to. */
export interface Crumb<Label = string> {
  label: Label;
  to: string;
}

const ROOT_HUB = "index";

export const HOME_CRUMB: Crumb = { label: "Home", to: "/" };
export const TAGS_CRUMB: Crumb = { label: "Tags", to: "/tags" };

/** Pages that sit directly under Home: Search, Tags, Files, Inbox, Check, and not found. */
export const TOP_LEVEL_CRUMBS: readonly Crumb[] = [HOME_CRUMB];

/** The Tag page sits under Tags. */
export const TAG_PAGE_CRUMBS: readonly Crumb[] = [HOME_CRUMB, TAGS_CRUMB];

/**
 * A note's breadcrumbs from its trail (GET /api/notes/:slug/trail) and its tags.
 *
 * - No trail yet, or the request failed: Home alone, in the same spot, so the header does not jump.
 * - In the hub tree: Home, then each hub below `index` down to the hub that lists the note.
 *   `index` itself and the hubs `index` lists directly get Home alone.
 * - No hub reaches the note: Home › Tags › its first tag, or Home alone when it has no tags.
 *
 * tagLabel renders the tag crumb's label (the note page passes TagName), so this module stays free of React.
 */
export function noteCrumbs<TagLabel>(
  trail: NoteTrail | undefined,
  tags: readonly string[],
  tagLabel: (tag: string) => TagLabel,
): Crumb<string | TagLabel>[] {
  if (!trail) return [HOME_CRUMB];
  if (trail.inHub) {
    const hubs = trail.trail.filter((hub) => hub.slug !== ROOT_HUB);
    return [HOME_CRUMB, ...hubs.map((hub) => ({ label: hub.title, to: noteUrl(hub.slug) }))];
  }
  const tag = tags[0];
  if (tag === undefined) return [HOME_CRUMB];
  return [HOME_CRUMB, TAGS_CRUMB, { label: tagLabel(tag), to: tagUrl(tag) }];
}
