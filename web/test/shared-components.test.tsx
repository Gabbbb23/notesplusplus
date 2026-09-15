import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { TagBadge, TagBadges, TagName } from "../src/components/badges";
import { Callout } from "../src/components/callout";
import { Kbd, KbdGroup } from "../src/components/kbd";
import { MetaItem, MetaList, MetaRow } from "../src/components/meta";
import { Notice } from "../src/components/notice";
import { ErrorAlert, NotFoundState } from "../src/components/page-state";
import { SearchInput } from "../src/components/search-input";
import { SectionHeading } from "../src/components/section-heading";
import { TextLink } from "../src/components/text-link";
import { ApiError } from "../src/lib/api";

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("<TextLink>", () => {
  it("renders a router link in the same tab, wrapping a string at break points", () => {
    inRouter(<TextLink to="/notes/fields-cloud-hosting-budget-v2">fields-cloud-hosting-budget-v2</TextLink>);
    const link = screen.getByRole("link", { name: "fields-cloud-hosting-budget-v2" });
    expect(link).toHaveAttribute("href", "/notes/fields-cloud-hosting-budget-v2");
    expect(link).not.toHaveAttribute("target");
    expect(link).toHaveClass("text-link", "hover:text-link-hover", "hover:underline");
    expect(link).not.toHaveClass("text-primary");
    expect(link.querySelector("[data-slot='breakable-text'] wbr")).not.toBeNull();
    expect(link.querySelector("[data-slot='external-link-icon']")).toBeNull();
  });

  it("opens an external link in a new tab with the one external-link icon", () => {
    inRouter(<TextLink href="/api/files/a.pdf">Open</TextLink>);
    const link = screen.getByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.querySelectorAll("[data-slot='external-link-icon']")).toHaveLength(1);
  });

  it("applies the variant's weight", () => {
    inRouter(
      <>
        <TextLink to="/a" variant="strong">
          a
        </TextLink>
        <TextLink to="/b" variant="title">
          b
        </TextLink>
      </>,
    );
    expect(screen.getByRole("link", { name: "a" })).toHaveClass("font-medium");
    expect(screen.getByRole("link", { name: "b" })).toHaveClass("font-medium", "text-base");
  });

  it("muted is quiet: grey until hover, a 24px hit area, and the same focus ring", () => {
    inRouter(
      <TextLink to="/" variant="muted">
        Home
      </TextLink>,
    );
    const link = screen.getByRole("link", { name: "Home" });
    expect(link).toHaveClass(
      "text-muted-foreground",
      "hover:text-foreground",
      "hover:underline",
      "min-h-6",
      "py-0.5",
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-ring",
    );
    expect(link).not.toHaveClass("text-link");
    expect(link).not.toHaveClass("hover:text-link-hover");
  });
});

describe("tags", () => {
  const long = "fields-group-cloud-hosting-budget-proposal-for-the-2026-rollout";

  it("TagBadge wraps: no nowrap, capped at its container, and break points in the name", () => {
    inRouter(<TagBadge name={long} />);
    const badge = screen.getByRole("link", { name: `#${long}` });
    expect(badge).toHaveAttribute("href", `/tags/${long}`);
    expect(badge).toHaveClass("whitespace-normal", "max-w-full", "shrink", "min-w-0");
    expect(badge).not.toHaveClass("whitespace-nowrap");
    expect(badge).not.toHaveClass("shrink-0");
    expect(badge.querySelectorAll("wbr").length).toBeGreaterThan(5);
  });

  it("TagBadges is capped at its container too", () => {
    const { container } = inRouter(<TagBadges tags={["a", long]} />);
    expect(container.querySelector("[data-slot='tag-badges']")).toHaveClass("max-w-full", "min-w-0", "flex-wrap");
  });

  it("TagName shows a muted # and the name", () => {
    const { container } = render(<TagName name="hardware" />);
    const name = container.querySelector("[data-slot='tag-name']")!;
    expect(name.textContent).toBe("#hardware");
    expect(name.firstElementChild).toHaveClass("text-muted-foreground");
  });
});

describe("<MetaList> and <MetaRow>", () => {
  it("renders label and value pairs in a description list", () => {
    const { container } = render(
      <MetaList>
        <MetaItem label="Created">2026-09-14</MetaItem>
        <MetaItem label="Path">notes/a.md</MetaItem>
      </MetaList>,
    );
    const list = container.querySelector<HTMLElement>("dl[data-slot='meta-list']")!;
    expect(within(list).getAllByRole("term").map((t) => t.textContent)).toEqual(["Created", "Path"]);
    expect(within(list).getAllByRole("definition").map((d) => d.textContent)).toEqual(["2026-09-14", "notes/a.md"]);
  });

  it("MetaRow wraps its details", () => {
    const { container } = render(
      <MetaRow>
        <span>updated 2026-09-14</span>
      </MetaRow>,
    );
    expect(container.querySelector("[data-slot='meta-row']")).toHaveClass("flex-wrap", "text-xs");
  });
});

describe("<Notice>", () => {
  it("renders each tone with its title, description, and the card padding", () => {
    for (const tone of ["info", "success", "warning", "danger"] as const) {
      const { unmount } = render(
        <Notice tone={tone} title={`Title ${tone}`}>
          Body {tone}
        </Notice>,
      );
      const alert = screen.getByRole("alert");
      expect(alert).toHaveAttribute("data-tone", tone);
      expect(alert).toHaveClass("p-4", "rounded-lg");
      expect(alert).not.toHaveClass("py-3");
      expect(alert.textContent).toContain(`Title ${tone}`);
      expect(alert.textContent).toContain(`Body ${tone}`);
      expect(alert.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("ErrorAlert is a danger Notice that is still announced (role alert)", () => {
    render(<ErrorAlert error={new ApiError("boom", 500, "internal")} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-tone", "danger");
    expect(alert.textContent).toContain("boom");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("live={false} makes a static note that is not announced", () => {
    render(
      <Notice tone="warning" title="Warning" live={false}>
        The syllabus lists the wrong room.
      </Notice>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-slot", "notice");
    expect(note).toHaveAttribute("data-tone", "warning");
    expect(note).toHaveTextContent("The syllabus lists the wrong room.");
  });
});

describe("<Kbd> and <KbdGroup>", () => {
  it("draws each key as a keycap in the app font, 20px tall, muted, on the card surface", () => {
    render(<Kbd>Alt</Kbd>);
    const cap = screen.getByText("Alt");
    expect(cap.tagName).toBe("KBD");
    expect(cap).toHaveClass(
      "font-sans",
      "text-xs",
      "font-medium",
      "text-muted-foreground",
      "h-5",
      "px-1.5",
      "border",
      "border-border",
      "rounded-sm",
      "bg-card",
    );
    expect(cap.className).not.toMatch(/uppercase|shadow|font-mono|animate|transition/);
  });

  it("KbdGroup sets the keys 4px apart, written as given", () => {
    const { container } = render(<KbdGroup keys={["Alt", "K"]} />);
    const group = container.querySelector("[data-slot='kbd-group']")!;
    expect(group).toHaveClass("gap-1");
    expect(Array.from(group.querySelectorAll("kbd"), (k) => k.textContent)).toEqual(["Alt", "K"]);
  });
});

describe("page pieces", () => {
  it("NotFoundState shows the title, the missing value as code, and a way home", () => {
    inRouter(<NotFoundState title="Note not found" message="There is no note with the slug" value="missing-note" />);
    expect(screen.getByRole("heading", { level: 1, name: "Note not found" })).toBeInTheDocument();
    expect(screen.getByText("missing-note").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "Back home" })).toHaveAttribute("href", "/");
  });

  it("SectionHeading is an h2 that passes its id through", () => {
    render(<SectionHeading id="backlinks-heading">Backlinks</SectionHeading>);
    const heading = screen.getByRole("heading", { level: 2, name: "Backlinks" });
    expect(heading).toHaveAttribute("id", "backlinks-heading");
    expect(heading).toHaveClass("border-b", "text-xl");
  });

  it("Callout renders its text", () => {
    render(<Callout>The summary.</Callout>);
    expect(screen.getByText("The summary.")).toHaveAttribute("data-slot", "callout");
  });

  it("SearchInput is a labelled search field with the icon", () => {
    const { container } = render(<SearchInput value="ryzen" onChange={() => {}} label="Search" shape="pill" />);
    const input = screen.getByRole("searchbox", { name: "Search" });
    expect(input).toHaveValue("ryzen");
    expect(input).toHaveClass("rounded-full", "pl-9");
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
