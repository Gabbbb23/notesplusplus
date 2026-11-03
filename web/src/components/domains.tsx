import { createContext, useContext, useId, useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { NoteChip } from "@/components/badges";
import { TextLink } from "@/components/text-link";
import { Button } from "@/components/ui/button";
import { Ripple } from "@/components/ui/ripple";
import { api, ApiError, noteUrl, tagUrl } from "@/lib/api";
import { plural } from "@/lib/format";
import type { IsoDate, NoteRef, NoteSummary, TagWithCount } from "@/lib/types";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";

/*
 * The brain's domains: the hubs the root hub `index` links to, in its order. Layout mounts
 * DomainsProvider once, so Home's domain cards and the navigation drawer read one copy, loaded once.
 */

export const ROOT_HUB = "index";

export interface Domain {
  slug: string;
  title: string;
  updated: IsoDate;
  /** The tag the domain's notes carry: the hub's tag named like its slug, else its first tag. */
  tag?: string;
  /** How many notes carry `tag`. */
  count?: number;
  /** The other hubs that carry `tag`, by title. */
  subHubs: NoteRef[];
}

export type DomainsStatus = "loading" | "ready" | "missing" | "error";

export interface Domains {
  /** "missing" when the brain has no root hub. */
  status: DomainsStatus;
  error: Error | undefined;
  /** Empty unless status is "ready". */
  domains: Domain[];
  /** Load again, after an error. */
  retry: () => void;
}

const ref = ({ slug, title, type }: NoteRef): NoteRef => ({ slug, title, type });

/** The domains, from the root hub's links, every hub, and the tag counts. A link that is not a hub is skipped. */
export function buildDomains(rootLinks: readonly string[], hubs: readonly NoteSummary[], tags: readonly TagWithCount[]): Domain[] {
  const hubBySlug = new Map(hubs.map((hub) => [hub.slug, hub]));
  const counts = new Map(tags.map((tag) => [tag.name, tag.count]));
  const domainHubs = rootLinks.flatMap((slug) => {
    const hub = hubBySlug.get(slug);
    return hub && slug !== ROOT_HUB ? [hub] : [];
  });
  const isDomain = new Set(domainHubs.map((hub) => hub.slug));
  const byTitle = [...hubs].sort((a, b) => a.title.localeCompare(b.title));

  return domainHubs.map((hub) => {
    const tag = hub.tags.includes(hub.slug) ? hub.slug : hub.tags[0];
    const subHubs = tag
      ? byTitle.filter((other) => other.slug !== ROOT_HUB && !isDomain.has(other.slug) && other.tags.includes(tag)).map(ref)
      : [];
    return { slug: hub.slug, title: hub.title, updated: hub.updated, tag, count: tag ? counts.get(tag) : undefined, subHubs };
  });
}

/** null when the root hub does not exist. The hubs and counts are asked for only once it does. */
async function loadDomains(): Promise<Domain[] | null> {
  let links: string[];
  try {
    links = (await api.getNote(ROOT_HUB)).links;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
  const [hubs, tags] = await Promise.all([api.listNotes({ type: "hub", limit: 500 }), api.tags()]);
  return buildDomains(links, hubs.items, tags);
}

const DomainsContext = createContext<Domains | null>(null);

export function DomainsProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useAsync(loadDomains, []);
  const value = useMemo<Domains>(() => {
    const status: DomainsStatus = error ? "error" : data === undefined ? "loading" : data === null ? "missing" : "ready";
    return { status, error, domains: status === "ready" && data ? data : [], retry: reload };
  }, [data, error, reload]);
  return <DomainsContext.Provider value={value}>{children}</DomainsContext.Provider>;
}

/** The domains. Only inside DomainsProvider, which layout.tsx mounts around every page. */
export function useDomains(): Domains {
  const domains = useContext(DomainsContext);
  if (!domains) throw new Error("useDomains needs a DomainsProvider around it (layout.tsx mounts one).");
  return domains;
}

/** A domain's letter avatar: 24px in the navigation drawer, 40px on its card. */
export function DomainAvatar({ title, size }: { title: string; size: "small" | "large" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-secondary-container text-on-secondary-container",
        size === "small" ? "size-6 text-label-medium" : "size-10 text-title-medium",
      )}
    >
      {[...title.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

/**
 * One domain as an M3 filled card, the whole card a link to its hub: the avatar and title, when the hub was
 * last updated, its sub-hubs as chips, and a text button to every note carrying the domain's tag. The chips and
 * the button are raised above the card's link, so each opens its own page.
 */
export function DomainCard({ domain }: { domain: Domain }) {
  const titleId = useId();
  const { slug, title, updated, tag, count, subHubs } = domain;
  return (
    <li
      data-slot="domain-card"
      className="relative flex min-w-0 flex-col gap-4 rounded-medium bg-surface-container-highest p-4 wrap-break-word [&_a:not([data-card-link])]:z-10"
    >
      <div className="flex items-center gap-4">
        <DomainAvatar title={title} size="large" />
        <div className="min-w-0">
          <h3 id={titleId}>
            <TextLink to={noteUrl(slug)} variant="card">
              {title}
            </TextLink>
          </h3>
          <p className="text-body-medium text-on-surface-variant">updated {updated}</p>
        </div>
      </div>
      {subHubs.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {subHubs.map((hub) => (
            <li key={hub.slug} className="max-w-full min-w-0">
              <NoteChip note={hub} />
            </li>
          ))}
        </ul>
      )}
      {tag && count !== undefined && (
        <div className="-mr-3 -mb-2 mt-auto flex justify-end">
          <Button variant="text" asChild>
            <Link to={tagUrl(tag)} aria-describedby={titleId}>
              {plural(count, "note")}
            </Link>
          </Button>
        </div>
      )}
      <Ripple />
    </li>
  );
}
