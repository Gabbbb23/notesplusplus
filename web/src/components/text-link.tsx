import { ExternalLinkIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { BreakableText } from "@/components/breakable-text";
import { cn } from "@/lib/utils";

/*
 * Every text link in the app: page links, card titles, note metadata, and links inside note
 * bodies. This is the only module that styles a link or draws the external-link icon.
 */

const LINK_CLASS = "min-w-0 text-primary hover:text-primary-hover hover:underline";

export type TextLinkVariant = "inline" | "strong" | "title";

const VARIANT_CLASS: Record<TextLinkVariant, string> = {
  /** Inherits the surrounding size and weight. */
  inline: "",
  /** Medium weight: a slug or tag that names the row it sits in. */
  strong: "font-medium",
  /** A card title. */
  title: "text-base font-medium",
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
