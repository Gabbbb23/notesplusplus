import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { restoreScroll } from "../src/components/history-nav";
import { reply, stubApi } from "./api-stub";

/*
 * Back and Forward in the top bar. jsdom lays nothing out, so the page's height, the viewport and
 * the scroll position are set by hand, and window.scrollTo is a spy.
 */

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderAt(path: string) {
  stubApi({
    "/api/tags": () => reply(200, []),
    "/api/stats": () => reply(200, { notes: 0, files: 0, invalid: 0 }),
    "/api/notes/index": () => reply(200, {
      slug: "index",
      title: "Index",
      type: "hub",
      summary: "",
      tags: [],
      created: "2026-01-01",
      updated: "2026-01-01",
      path: "notes/index.md",
      frontmatter: { title: "Index", type: "hub", summary: "", tags: [], created: "2026-01-01", updated: "2026-01-01" },
      body: "The root hub.",
      raw: "",
      links: [],
      mentions: [],
      mtimeMs: 0,
    }),
    "/api/notes?sort=created&limit=50": () => reply(200, { items: [], total: 0, limit: 50, offset: 0 }),
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId("location").textContent;
const back = () => screen.getByRole("button", { name: "Back" });
const forward = () => screen.getByRole("button", { name: "Forward" });
/** The sidebar's Home link (the Tags page's breadcrumbs hold another "Home"). */
const homeLink = () => within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Home" });

/** Give the page a height, a viewport and a scroll position, as a browser would have laid them out. */
function layOut({ scrollHeight, innerHeight, scrollY }: { scrollHeight: number; innerHeight: number; scrollY: number }) {
  Object.defineProperty(document.documentElement, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: innerHeight, configurable: true, writable: true });
  Object.defineProperty(window, "scrollY", { value: scrollY, configurable: true, writable: true });
}

let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Scrolls as a browser would: no further than the page allows.
  scrollTo = vi.fn((_x: number, y: number) => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    Object.defineProperty(window, "scrollY", { value: Math.min(y, max), configurable: true, writable: true });
  });
  Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true, writable: true });
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  layOut({ scrollHeight: 0, innerHeight: 768, scrollY: 0 });
});

describe("Back and Forward in the top bar", () => {
  it("lead nowhere on the first page, then follow the history", async () => {
    renderAt("/tags");
    await screen.findByRole("heading", { level: 1, name: "Tags" });
    expect(back()).toBeDisabled();
    expect(forward()).toBeDisabled();

    fireEvent.click(homeLink());
    await waitFor(() => expect(location()).toBe("/"));
    expect(back()).toBeEnabled();
    expect(forward()).toBeDisabled();

    fireEvent.click(back());
    await waitFor(() => expect(location()).toBe("/tags"));
    expect(back()).toBeDisabled();
    expect(forward()).toBeEnabled();

    fireEvent.click(forward());
    await waitFor(() => expect(location()).toBe("/"));
    expect(back()).toBeEnabled();
    expect(forward()).toBeDisabled();
  });

  it("open a link at the top and bring Back to the spot that was scrolled to", async () => {
    renderAt("/tags");
    await screen.findByRole("heading", { level: 1, name: "Tags" });
    layOut({ scrollHeight: 3000, innerHeight: 800, scrollY: 640 });
    fireEvent.scroll(window);

    fireEvent.click(homeLink());
    await waitFor(() => expect(location()).toBe("/"));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    fireEvent.click(back());
    await waitFor(() => expect(location()).toBe("/tags"));
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 640));
  });

  it("do not scroll when nothing was scrolled before leaving", async () => {
    renderAt("/tags");
    await screen.findByRole("heading", { level: 1, name: "Tags" });
    layOut({ scrollHeight: 3000, innerHeight: 800, scrollY: 0 });

    fireEvent.click(homeLink());
    await waitFor(() => expect(location()).toBe("/"));
    scrollTo.mockClear();

    fireEvent.click(back());
    await waitFor(() => expect(location()).toBe("/tags"));
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("restoreScroll", () => {
  it("waits for the page to grow before scrolling, then stops", async () => {
    layOut({ scrollHeight: 500, innerHeight: 800, scrollY: 0 });
    const stop = restoreScroll(640, 5_000);
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(scrollTo).not.toHaveBeenCalled();

    layOut({ scrollHeight: 3000, innerHeight: 800, scrollY: 0 });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
    expect(window.scrollY).toBe(640);
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps trying when a scroll did not land, as on a page that was tall and became a loading block", async () => {
    // Tall enough on paper, but the scroll goes nowhere: the page is shorter than its last layout said.
    layOut({ scrollHeight: 3000, innerHeight: 800, scrollY: 0 });
    scrollTo.mockImplementationOnce(() => {});
    restoreScroll(640, 5_000);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollY).toBe(0);
    await waitFor(() => expect(window.scrollY).toBe(640));
  });

  it("scrolls as far as it can once the deadline passes", async () => {
    layOut({ scrollHeight: 500, innerHeight: 800, scrollY: 0 });
    restoreScroll(640, 0);
    expect(scrollTo).toHaveBeenCalledWith(0, 640);
  });

  it("gives up when the reader scrolls on their own", async () => {
    layOut({ scrollHeight: 500, innerHeight: 800, scrollY: 0 });
    restoreScroll(640, 5_000);
    fireEvent.wheel(window);
    layOut({ scrollHeight: 3000, innerHeight: 800, scrollY: 0 });
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
