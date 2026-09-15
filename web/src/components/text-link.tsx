import { ExternalLinkIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { BreakableText } from "@/components/breakable-text";
import { FOCUS_RING } from "@/lib/focus-ring";
import { cn } from "@/lib/utils";

/*
 * Every text link in the app: page links, card titles, note metadata, and links inside note
 * bodies. This is the only module that styles a link or draws the external-link icon.
 */

/** Every variant: underline on hover, and the app's keyboard focus outline with a small radius. */
const LINK_CLASS = `min-w-0 rounded-sm hover:underline ${FOCUS_RING}`;

/**
 * The link blue of every link except the quiet wayfinding ones: --link, darker than the button blue
 * so it reaches 4.5:1 on the page and on cards, and one step darker again on hover.
 */
const PRIMARY = "text-link hover:text-link-hover";

export type TextLinkVariant = "inline" | "strong" | "title" | "muted";

const VARIANT_CLASS: Record<TextLinkVariant, string> = {
  /** Inherits the surrounding size and weight. */
  inline: PRIMARY,
  /** Medium weight: a slug or tag that names the row it sits in. */
  strong: `${PRIMARY} font-medium`,
  /** A card title. */
  title: `${PRIMARY} text-base font-medium`,
  /**
   * Quiet wayfinding, such as a breadcrumb: muted text that turns foreground on hover, and a hit area at
   * least 24px tall (padding only, no visual change).
   */
  muted: "inline-block min-h-6 py-0.5 text-muted-foreground hover:text-foreground",
};

/** Shown after an external link's text. Sits inline so it follows the last line of wrapped text. */
function ExternalMark() {
  return <ExternalLinkIcon data-slot="external-link-icon" className="ml-1 inline size-3.5 align-[-0.125em]" aria-hidden="true" />;
}

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "style" | "href" | "target" | "rel" | "children">;

export type TextLinkProps = AnchorProps & {
  /** A string wraps at natural break points (BreakableText); other content renders as is. */
  children: ReactNode;
  variant?: TextLinkVariant;
} & (
    | {
        /** An in-app route, opened in the same tab through the router. */
        to: string;
        href?: never;
      }
    | {
        /** A file or site, opened in a new tab with the external-link icon. */
        href: string;
        to?: never;
      }
  );

export function TextLink({ children, variant = "inline", to, href, ...rest }: TextLinkProps) {
  const className = cn(LINK_CLASS, VARIANT_CLASS[variant]);
  const content = typeof children === "string" ? <BreakableText text={children} /> : children;
  if (to !== undefined) {
    return (
      <Link to={to} data-slot="text-link" className={className} {...rest}>
        {content}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-slot="text-link" className={className} {...rest}>
      {content}
      <ExternalMark />
    </a>
  );
}
