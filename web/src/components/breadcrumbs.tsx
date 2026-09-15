import { Fragment, type ReactNode } from "react";
import { TextLink } from "@/components/text-link";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import type { Crumb } from "@/lib/breadcrumb-items";

/*
 * The breadcrumb trail above a page title. This is the only module that imports the shadcn
 * breadcrumb, and PageHeader is the only component that renders it, so every page places it the same way.
 */

/**
 * 13px muted text on a 20px line, 4px either side of each chevron, wrapping onto more lines when narrow.
 * sm:gap-1 replaces the primitive's wider gap from 640px up.
 */
const LIST_CLASS = "gap-1 text-[0.8125rem]/5 font-normal sm:gap-1";

/**
 * Where a page sits: every item is a link, never the current page, whose title sits right below.
 * Chevrons between items are hidden from assistive tech. Renders nothing for an empty list.
 */
export function Breadcrumbs({ items }: { items: readonly Crumb<ReactNode>[] }) {
  if (items.length === 0) return null;
  return (
    <Breadcrumb aria-label="Breadcrumb">
      <BreadcrumbList className={LIST_CLASS}>
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="min-w-0">
              <TextLink to={item.to} variant="muted">
                {item.label}
              </TextLink>
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
