/**
 * Trails. Notes live in one flat folder; structure comes from hubs. The root hub `index` links domain hubs, which may
 * link sub-hubs, which link notes. A note's trail is the chain of hubs from `index` down to the hub that links to it.
 * Conventions put every note in exactly one hub, but nothing enforces that, so the search copes with notes listed
 * twice, hubs that link each other, and notes no hub reaches.
 */
import type { NoteTrail, TrailHub } from "../types.ts";

export const ROOT_HUB = "index";

/** A hub's title and its outgoing link targets in order of first appearance. */
export interface HubLinks {
  title: string;
  links: readonly string[];
}

/**
 * Breadth-first search from `index` through hub links only; a non-hub note's links are never followed.
 * The shortest chain wins. On a tie the hub dequeued first wins, which follows link order in each body.
 * Each hub is visited once, so hubs that link each other cannot loop. Links to slugs that are not in `hubs`,
 * including slugs that do not exist, are never followed. The caller checks that `slug` itself exists.
 *
 * `hubs` may hold only `index` and the hubs with a chain of links to `slug` that does not pass through `index`, each
 * with its links among those hubs and to `slug`. A hub that discovers one of them is itself one of them or `index`
 * (a shortest chain from `index` never returns to it), and the hub that finds `slug` links to it directly, so those
 * hubs leave the queue in the same relative order as in the search over every hub, and the answer is the same.
 */
export function findTrail(hubs: ReadonlyMap<string, HubLinks>, slug: string): NoteTrail {
  if (!hubs.has(ROOT_HUB)) return { trail: [], inHub: false };
  if (slug === ROOT_HUB) return { trail: [], inHub: true };

  const parent = new Map<string, string | null>([[ROOT_HUB, null]]);
  const queue = [ROOT_HUB];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    for (const link of hubs.get(current)!.links) {
      if (link === slug) return { trail: chainTo(current, parent, hubs), inHub: true };
      if (hubs.has(link) && !parent.has(link)) {
        parent.set(link, current);
        queue.push(link);
      }
    }
  }
  return { trail: [], inHub: false };
}

function chainTo(hub: string, parent: ReadonlyMap<string, string | null>, hubs: ReadonlyMap<string, HubLinks>): TrailHub[] {
  const out: TrailHub[] = [];
  for (let at: string | null = hub; at !== null; at = parent.get(at) ?? null) {
    out.push({ slug: at, title: hubs.get(at)!.title });
  }
  return out.reverse();
}
