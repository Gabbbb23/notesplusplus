import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { TagName } from "../src/components/badges";
import { Breadcrumbs } from "../src/components/breadcrumbs";
import { PageHeader } from "../src/components/page-header";

const inRouter = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

const NESTED = [
  { label: "Home", to: "/" },
  { label: "College", to: "/notes/college" },
  { label: "GE09 Life and Works of Rizal", to: "/notes/ge09-life-and-works-of-rizal" },
];

describe("<Breadcrumbs>", () => {
  it("is a navigation landmark named Breadcrumb holding an ordered list of links", () => {
    inRouter(<Breadcrumbs items={NESTED} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const list = within(nav).getByRole("list");
    expect(list.tagName).toBe("OL");

    // Only the three crumbs are list items; the chevrons between them are not.
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Home", "/"],
      ["College", "/notes/college"],
      ["GE09 Life and Works of Rizal", "/notes/ge09-life-and-works-of-rizal"],
    ]);
  });

  it("hides the chevron separators from assistive tech", () => {
    const { container } = inRouter(<Breadcrumbs items={NESTED} />);
    const separators = container.querySelectorAll("[data-slot='breadcrumb-separator']");
    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      expect(separator).toHaveAttribute("aria-hidden", "true");
      expect(separator).toHaveAttribute("role", "presentation");
      expect(separator.querySelector("svg")).not.toBeNull();
    }
    // Nothing but the link names is exposed.
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).queryAllByRole("presentation")).toHaveLength(0);
    expect(within(nav).queryAllByRole("img")).toHaveLength(0);
  });

  it("renders every crumb through TextLink's muted variant, wrapping long titles", () => {
    inRouter(<Breadcrumbs items={NESTED} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("data-slot", "text-link");
      expect(link).toHaveClass("text-muted-foreground", "hover:text-foreground", "hover:underline", "min-h-6");
      expect(link).not.toHaveClass("text-primary");
      expect(link).not.toHaveAttribute("target");
      expect(link).not.toHaveAttribute("aria-current");
    }
    const hub = screen.getByRole("link", { name: "GE09 Life and Works of Rizal" });
    expect(hub.querySelector("[data-slot='breakable-text']")).not.toBeNull();
  });

  it("uses small muted text in a wrapping row and never scrolls sideways", () => {
    const { container } = inRouter(<Breadcrumbs items={NESTED} />);
    const list = container.querySelector("[data-slot='breadcrumb-list']")!;
    expect(list).toHaveClass("flex-wrap", "text-muted-foreground", "text-[0.8125rem]/5", "gap-1", "sm:gap-1");
    expect(list).not.toHaveClass("text-sm", "gap-1.5", "sm:gap-2.5");
    expect(container.innerHTML).not.toMatch(/overflow-(?:x-)?(?:auto|scroll)|truncate|text-ellipsis/);
  });

  it("accepts a node label, such as a tag name", () => {
    inRouter(<Breadcrumbs items={[{ label: <TagName name="hardware" />, to: "/tags/hardware" }]} />);
    const link = screen.getByRole("link", { name: "#hardware" });
    expect(link).toHaveAttribute("href", "/tags/hardware");
    expect(link.querySelector("[data-slot='tag-name']")).not.toBeNull();
  });

  it("renders nothing for an empty list", () => {
    const { container } = inRouter(<Breadcrumbs items={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("<PageHeader> breadcrumbs", () => {
  it("sit above the title row and never repeat the current title", () => {
    const { container } = inRouter(<PageHeader title="Rizal Day is Rizal's death anniversary" breadcrumbs={NESTED} />);
    const header = container.querySelector("header[data-slot='page-header']")!;
    const nav = within(header as HTMLElement).getByRole("navigation", { name: "Breadcrumb" });
    expect(header.firstElementChild).toBe(nav);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Rizal Day is Rizal's death anniversary");
    expect(nav.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav).not.toHaveTextContent("Rizal Day");
  });

  it("are absent without the prop", () => {
    inRouter(<PageHeader title="Home" />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
