import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { Note, NoteSummary } from "../src/lib/types";
import { apiError, reply, settle, stubApi, summary, type Route } from "./api-stub";

/*
 * Home's Recent section: the newest notes under the day they were created ("Recent", DECISIONS.md,
 * 2026-09-17). The day groups, their naming, the reveal, and the failed load are what the owner sees;
 * the sort itself is the server's, tested in test/api.test.ts.
 */

const RECENT_URL = "/api/notes?sort=created&limit=50";
const NOW = new Date("2026-09-17T10:00:00");

function on(date: string, slug: string, title: string, type: NoteSummary["type"] = "note"): NoteSummary {
  return { ...summary(slug, title, type), created: date, updated: date };
}

function page(items: NoteSummary[], total = items.length) {
  return { items, total, limit: 50, offset: 0 };
}

function hub(): Note {
  const s = summary("index", "Index", "hub");
  return {
    ...s,
    frontmatter: { title: s.title, type: s.type, summary: s.summary, tags: s.tags, created: s.created, updated: s.updated },
    body: "The root hub.",
    raw: "",
    links: [],
    mentions: [],
    mtimeMs: 0,
  };
}

/** Home with its three other requests answered, rendered and settled: every fetch has landed. */
async function renderHome(routes: Record<string, Route>) {
  const fetchMock = stubApi({
    "/api/notes/index": () => reply(200, hub()),
    "/api/stats": () => reply(200, { notes: 4, files: 0, invalid: 0 }),
    "/api/pins": () => reply(200, { home: [], sidebar: [] }),
    ...routes,
  });
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByText("The root hub.");
  await settle();
  return fetchMock;
}

/** The day headings in the section, in the order they render. */
function dayHeadings(): string[] {
  const section = screen.getByRole("region", { name: "Recent" });
  return within(section)
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent ?? "");
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Home's Recent section", () => {
  it("groups the notes by created date, newest day first, and names today and yesterday", async () => {
    await renderHome({
      [RECENT_URL]: () =>
        reply(
          200,
          page([
            on("2026-09-17", "fields-recent", "Fields prototype demo"),
            on("2026-09-17", "fields-approval", "Approval and consent"),
            on("2026-09-16", "rizal-reflection", "GE09 reflection", "source"),
            on("2026-09-14", "college", "College", "hub"),
          ]),
        ),
    });

    expect(dayHeadings()).toEqual(["2026-09-17today · 2 notes", "2026-09-16yesterday · 1 note", "2026-09-141 note"]);
    const section = screen.getByRole("region", { name: "Recent" });
    expect(within(section).getByRole("link", { name: "Fields prototype demo" })).toHaveAttribute(
      "href",
      "/notes/fields-recent",
    );
    // The type is on the card, so a source or a hub is recognisable without opening it.
    expect(within(section).getByText("source")).toBeInTheDocument();
    expect(within(section).getByText("hub")).toBeInTheDocument();
  });

  it("sits under the stats and above the root hub's content", async () => {
    await renderHome({ [RECENT_URL]: () => reply(200, page([on("2026-09-17", "a", "A note")])) });

    const section = screen.getByRole("region", { name: "Recent" });
    const stats = screen.getByLabelText("Stats");
    const body = screen.getByText("The root hub.");
    expect(stats.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the newest eight, then the rest from Show more notes", async () => {
    const notes = Array.from({ length: 11 }, (_, i) => on("2026-09-17", `n${i}`, `Note ${i}`));
    await renderHome({ [RECENT_URL]: () => reply(200, page(notes)) });
    const section = screen.getByRole("region", { name: "Recent" });

    expect(within(section).getAllByRole("link")).toHaveLength(8);
    expect(within(section).getByText("Showing 8 of 11")).toBeInTheDocument();
    expect(dayHeadings()).toEqual(["2026-09-17today · 8 notes"]);

    await act(async () => {
      fireEvent.click(within(section).getByRole("button", { name: "Show more notes" }));
    });

    expect(within(section).getAllByRole("link")).toHaveLength(11);
    expect(within(section).queryByRole("button", { name: "Show more notes" })).toBeNull();
    expect(dayHeadings()).toEqual(["2026-09-17today · 11 notes"]);
  });

  it("names the cap when the brain holds more notes than the section fetched", async () => {
    const notes = Array.from({ length: 8 }, (_, i) => on("2026-09-17", `n${i}`, `Note ${i}`));
    await renderHome({ [RECENT_URL]: () => reply(200, page(notes, 191)) });

    expect(screen.getByText("Showing the newest 8 notes of 191.")).toBeInTheDocument();
  });

  it("offers Try again when the request fails, and shows the notes on the retry", async () => {
    let attempt = 0;
    await renderHome({
      [RECENT_URL]: () => {
        attempt += 1;
        return attempt === 1
          ? apiError(500, "internal", "Index is rebuilding")
          : reply(200, page([on("2026-09-17", "a", "A note")]));
      },
    });
    const alert = screen.getByRole("alert");

    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(screen.getByRole("region", { name: "Recent" })).getByRole("link", { name: "A note" })).toBeInTheDocument();
  });

  it("renders nothing when the brain holds no notes", async () => {
    await renderHome({ [RECENT_URL]: () => reply(200, page([])) });

    expect(screen.queryByRole("region", { name: "Recent" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recent" })).toBeNull();
  });
});
