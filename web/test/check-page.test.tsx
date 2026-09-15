import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckPage } from "../src/pages/check";
import type { LinkReport } from "../src/lib/types";

/** The minimum of a fetch Response that lib/api.ts reads. */
function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body } as Response;
}

const EMPTY: LinkReport = {
  brokenLinks: [],
  missingFiles: [],
  missingSources: [],
  invalidNotes: [],
  notesWithoutHub: [],
  notesInSeveralHubs: [],
  missingPins: [],
};

function renderWith(report: LinkReport) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/api/check-links" ? reply(200, report) : reply(404, {}))),
  );
  return render(
    <MemoryRouter>
      <CheckPage />
    </MemoryRouter>,
  );
}

/** The SectionCard whose heading starts with `title`. */
async function section(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { level: 2, name: new RegExp(`^${title}`) });
  return heading.closest<HTMLElement>("[data-slot='section-card']")!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Check page hub membership", () => {
  it("lists notes no hub lists and notes listed by more than one hub, linking each note and hub", async () => {
    renderWith({
      ...EMPTY,
      notesWithoutHub: [{ slug: "orphan-note" }, { slug: "stray-note" }],
      notesInSeveralHubs: [{ slug: "rizal-day", hubs: ["college", "ge09-life-and-works-of-rizal"] }],
    });

    const without = await section("Notes no hub lists");
    expect(within(without).getByRole("heading", { level: 2 })).toHaveTextContent("Notes no hub lists2");
    expect(within(without).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["orphan-note", "/notes/orphan-note"],
      ["stray-note", "/notes/stray-note"],
    ]);

    const several = await section("Notes listed by more than one hub");
    const item = within(several).getByRole("listitem");
    expect(item).toHaveTextContent("rizal-day in college, ge09-life-and-works-of-rizal");
    expect(within(item).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/notes/rizal-day",
      "/notes/college",
      "/notes/ge09-life-and-works-of-rizal",
    ]);

    // The other sections still show, empty.
    expect(within(await section("Broken links")).getByText("None.")).toBeInTheDocument();
  });

  it("counts hub membership against All clear", async () => {
    renderWith(EMPTY);
    expect(await screen.findByRole("alert")).toHaveTextContent("every note is in exactly one hub");
  });
});

describe("Check page pins", () => {
  it("lists pins to missing notes, one row per slug, as code without links", async () => {
    renderWith({ ...EMPTY, missingPins: ["deleted-note", "renamed-by-hand"] });

    const pins = await section("Pins to missing notes");
    expect(within(pins).getByRole("heading", { level: 2 })).toHaveTextContent("Pins to missing notes2");
    const rows = within(pins).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["deleted-note", "renamed-by-hand"]);
    expect(rows[0]!.querySelector("code")).toHaveAttribute("data-slot", "breakable-text");
    // The notes are gone, so there is nothing to link to.
    expect(within(pins).queryByRole("link")).toBeNull();
    expect(screen.queryByText("All clear")).toBeNull();
  });

  it("a missing pin alone withholds All clear and shows every section", async () => {
    renderWith({ ...EMPTY, missingPins: ["deleted-note"] });
    expect(within(await section("Pins to missing notes")).getByText("deleted-note")).toBeInTheDocument();
    expect(within(await section("Broken links")).getByText("None.")).toBeInTheDocument();
    expect(screen.queryByText("All clear")).toBeNull();
  });

  it("says pins to missing notes are covered when all is clear", async () => {
    renderWith(EMPTY);
    expect(await screen.findByRole("alert")).toHaveTextContent("pins to missing notes");
    expect(screen.queryByRole("heading", { name: /Pins to missing notes/ })).toBeNull();
  });
});
