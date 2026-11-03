import { Fragment, type ReactNode } from "react";
import { TextLink } from "@/components/text-link";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import type { Crumb } from "@/lib/breadcrumb-items";

/*
 * The breadcrumb trail above a page title. This is the only module that imports the shadcn
 * breadcrumb, and PageHeader is the only component that renders it, so every page places it the same way.
 * The list's look (body-medium in on-surface-variant, 4px either side of each chevron, wrapping) is the
 * primitive's own.
 */

/**
 * Where a page sits: every item is a link, never the current page, whose title sits right below.
 * Chevrons between items are hidden from assistive tech. Renders nothing for an empty list.
 */
export function Breadcrumbs({ items }: { items: readonly Crumb<ReactNode>[] }) {
  if (items.length === 0) return null;
  return (
    <Breadcrumb aria-label="Breadcrumb">
      <BreadcrumbList>
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
