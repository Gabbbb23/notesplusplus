import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { TagBadge } from "../src/components/badges";
import { Breadcrumbs } from "../src/components/breadcrumbs";
import { TextLink } from "../src/components/text-link";
import { BreadcrumbLink } from "../src/components/ui/breadcrumb";
import { Button } from "../src/components/ui/button";
import { Input } from "../src/components/ui/input";
import { Select, SelectTrigger, SelectValue } from "../src/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../src/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "../src/components/ui/tabs";
import { Textarea } from "../src/components/ui/textarea";
import { Toggle } from "../src/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../src/components/ui/toggle-group";
import { FOCUS_RING } from "../src/lib/focus-ring";
import { readIndexCss } from "./contrast";

/*
 * Guards the one keyboard focus style (DECISIONS.md, 2026-09-15): a 2px outline in the ring colour,
 * 2px outside the element, shown only for keyboard focus.
 */

const RING_CLASSES = FOCUS_RING.split(" ");

/** The faint shadcn default this replaced: a 3px ring at half opacity. */
const OLD_RING = /(?:^|\s)(?:focus-visible:|focus:)(?:ring-|border-ring)/;

function expectFocusRing(element: HTMLElement) {
  expect(element).toHaveClass(...RING_CLASSES);
  expect(element.className).not.toMatch(OLD_RING);
}

const inRouter = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("FOCUS_RING", () => {
  it("is a solid 2px outline in the ring colour with a 2px offset, for keyboard focus only", () => {
    expect(RING_CLASSES).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-solid",
        "focus-visible:outline-2",
        "focus-visible:outline-offset-2",
        "focus-visible:outline-ring",
      ]),
    );
    expect(RING_CLASSES.every((cls) => cls.startsWith("focus-visible:"))).toBe(true);
  });

  it("index.css gives every other focusable element the same outline", () => {
    const css = readIndexCss().replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /(?:^|\n)\s*:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(rule, "a :focus-visible rule in index.css").not.toBeNull();
    expect(rule![1]).toMatch(/outline:\s*2px solid var\(--ring\)/);
    expect(rule![1]).toMatch(/outline-offset:\s*2px/);
    // The old base rule drew outlines at half opacity.
    expect(css).not.toMatch(/outline-ring\/50/);
  });
});

describe("every interactive primitive has the focus ring", () => {
  it("Button, in every variant, and as a link", () => {
    render(
      <>
        {(["default", "destructive", "outline", "secondary", "ghost", "link"] as const).map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
        <Button asChild variant="outline">
          <a href="/">Back home</a>
        </Button>
      </>,
    );
    for (const button of screen.getAllByRole("button")) expectFocusRing(button);
    expectFocusRing(screen.getByRole("link", { name: "Back home" }));
  });

  it("Input and Textarea", () => {
    render(
      <>
        <Input aria-label="Name" />
        <Textarea aria-label="Content" />
      </>,
    );
    expectFocusRing(screen.getByRole("textbox", { name: "Name" }));
    expectFocusRing(screen.getByRole("textbox", { name: "Content" }));
  });

  it("Select trigger", () => {
    render(
      <Select>
        <SelectTrigger aria-label="Tag filter">
          <SelectValue placeholder="Any tag" />
        </SelectTrigger>
      </Select>,
    );
    expectFocusRing(screen.getByRole("combobox", { name: "Tag filter" }));
  });

  it("Toggle and ToggleGroup items", () => {
    render(
      <>
        <Toggle aria-label="Bold">B</Toggle>
        <ToggleGroup type="single" variant="outline" aria-label="Search mode">
          <ToggleGroupItem value="hybrid">Smart</ToggleGroupItem>
          <ToggleGroupItem value="keyword">Keywords</ToggleGroupItem>
        </ToggleGroup>
      </>,
    );
    expectFocusRing(screen.getByRole("button", { name: "Bold" }));
    for (const item of within(screen.getByRole("radiogroup", { name: "Search mode" })).getAllByRole("radio")) {
      expectFocusRing(item);
    }
  });

  it("Tabs triggers", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Notes</TabsTrigger>
          <TabsTrigger value="b">Files</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    for (const tab of screen.getAllByRole("tab")) expectFocusRing(tab);
  });

  it("the Sheet's close button, at full opacity while focused", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Pages</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expectFocusRing(close);
    expect(close).toHaveClass("rounded-sm", "focus-visible:opacity-100");
  });

  it("breadcrumb links, both the shared Breadcrumbs and the primitive", () => {
    inRouter(
      <>
        <Breadcrumbs items={[{ label: "Home", to: "/" }]} />
        <BreadcrumbLink href="/tags">Tags</BreadcrumbLink>
      </>,
    );
    expectFocusRing(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Home" }));
    expectFocusRing(screen.getByRole("link", { name: "Tags" }));
  });

  it("TextLink in every variant, in-app and external, with a small radius", () => {
    inRouter(
      <>
        {(["inline", "strong", "title", "muted"] as const).map((variant) => (
          <TextLink key={variant} to={`/${variant}`} variant={variant}>
            {variant}
          </TextLink>
        ))}
        <TextLink href="/api/files/a.pdf">View</TextLink>
      </>,
    );
    for (const link of screen.getAllByRole("link")) {
      expectFocusRing(link);
      expect(link).toHaveClass("rounded-sm");
    }
  });

  it("tag pills (Badge links)", () => {
    inRouter(<TagBadge name="college" />);
    expectFocusRing(screen.getByRole("link", { name: "#college" }));
  });
});
