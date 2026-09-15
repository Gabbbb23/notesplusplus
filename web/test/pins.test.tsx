import { act, render, screen } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPinChange, PinsProvider, usePins, type PinLists, type Pins } from "../src/components/pins";
import { apiError, callsTo, deferred, pinned, refOf, reply, resetToasts, settle, stubApi, summary } from "./api-stub";

const RIZAL = summary("rizal-day", "Rizal Day");
const BUDGET = summary("fields-budget", "Fields budget", "hub");
const SPECS = summary("ryzen-laptop-specs", "Ryzen laptop specs", "source");

/** Renders the provider with a probe that shows the lists and hands the test the current value. */
function renderPins() {
  const current: { pins: Pins | null } = { pins: null };
  function Probe() {
    const pins = usePins();
    current.pins = pins;
    return (
      <>
        <output data-testid="status">{pins.status}</output>
        <output data-testid="home">{pins.lists.home.map((n) => n.slug).join(",")}</output>
        <output data-testid="sidebar">{pins.lists.sidebar.map((n) => n.slug).join(",")}</output>
      </>
    );
  }
  render(
    <PinsProvider>
      <Probe />
      <Toaster />
    </PinsProvider>,
  );
  const pins = () => current.pins!;
  return { pins, run: (fn: (p: Pins) => void) => act(() => fn(pins())) };
}

const shown = (target: "home" | "sidebar") => screen.getByTestId(target).textContent;

afterEach(() => {
  resetToasts();
  vi.unstubAllGlobals();
});

describe("applyPinChange", () => {
  const lists: PinLists = { home: [RIZAL, BUDGET, SPECS].map(refOf), sidebar: [] };
  const slugs = (l: PinLists, target: "home" | "sidebar" = "home") => l[target].map((n) => n.slug);

  it("appends a new pin, removes an unpinned note, and keeps a pinned note's place", () => {
    expect(slugs(applyPinChange(lists, { kind: "pin", note: refOf(RIZAL), target: "sidebar", pinned: true }), "sidebar")).toEqual([
      "rizal-day",
    ]);
    expect(slugs(applyPinChange(lists, { kind: "pin", note: refOf(BUDGET), target: "home", pinned: false }))).toEqual([
      "rizal-day",
      "ryzen-laptop-specs",
    ]);
    expect(applyPinChange(lists, { kind: "pin", note: refOf(RIZAL), target: "home", pinned: true })).toBe(lists);
  });

  it("swaps a note with its neighbour, and changes nothing at either end", () => {
    expect(slugs(applyPinChange(lists, { kind: "move", slug: "fields-budget", target: "home", direction: "up" }))).toEqual([
      "fields-budget",
      "rizal-day",
      "ryzen-laptop-specs",
    ]);
    expect(slugs(applyPinChange(lists, { kind: "move", slug: "rizal-day", target: "home", direction: "down" }))).toEqual([
      "fields-budget",
      "rizal-day",
      "ryzen-laptop-specs",
    ]);
    expect(applyPinChange(lists, { kind: "move", slug: "rizal-day", target: "home", direction: "up" })).toBe(lists);
    expect(applyPinChange(lists, { kind: "move", slug: "ryzen-laptop-specs", target: "home", direction: "down" })).toBe(lists);
  });
});

describe("<PinsProvider>", () => {
  it("loads GET /api/pins once and answers isPinned", async () => {
    const fetchMock = stubApi({ "/api/pins": () => reply(200, pinned([RIZAL], [BUDGET])) });
    const { pins } = renderPins();

    expect(shown("home")).toBe("");
    await settle();

    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(shown("home")).toBe("rizal-day");
    expect(shown("sidebar")).toBe("fields-budget");
    expect(pins().isPinned("rizal-day", "home")).toBe(true);
    expect(pins().isPinned("rizal-day", "sidebar")).toBe(false);
    expect(callsTo(fetchMock, "GET /api/pins")).toHaveLength(1);
  });

  it("shows a pin before the server answers, then takes the server's lists and toasts", async () => {
    const put = deferred();
    const fetchMock = stubApi({ "/api/pins": () => reply(200, pinned([BUDGET])), "PUT /api/pins/home": put.route });
    const { pins, run } = renderPins();
    await settle();

    run((p) => p.setPin(RIZAL, "home", true));

    expect(shown("home")).toBe("fields-budget,rizal-day");
    expect(pins().isPinned("rizal-day", "home")).toBe(true);
    await settle();
    const [call] = callsTo(fetchMock, "PUT /api/pins/home");
    expect(call!.body).toEqual({ slug: "rizal-day", pinned: true });
    expect(call!.headers.get("X-Brain-Tool")).toBe("web");
    expect(call!.headers.get("Content-Type")).toBe("application/json");

    await put.release(reply(200, pinned([BUDGET, RIZAL], [SPECS])));

    expect(await screen.findByText("Pinned to Home")).toBeInTheDocument();
    expect(shown("home")).toBe("fields-budget,rizal-day");
    // Every answer carries both lists, so a change made elsewhere shows too.
    expect(shown("sidebar")).toBe("ryzen-laptop-specs");
  });

  it("says Unpinned from sidebar, and Pinned to sidebar, when the server accepts", async () => {
    stubApi({
      "/api/pins": () => reply(200, pinned([], [RIZAL])),
      "PUT /api/pins/sidebar": (init) =>
        JSON.parse(String(init?.body)).pinned ? reply(200, pinned([], [RIZAL])) : reply(200, pinned([], [])),
    });
    const { run } = renderPins();
    await settle();

    run((p) => p.setPin(RIZAL, "sidebar", false));
    expect(shown("sidebar")).toBe("");
    expect(await screen.findByText("Unpinned from sidebar")).toBeInTheDocument();

    run((p) => p.setPin(RIZAL, "sidebar", true));
    expect(await screen.findByText("Pinned to sidebar")).toBeInTheDocument();
    expect(shown("sidebar")).toBe("rizal-day");
  });

  it("takes a pin back out when the server answers 404, with the server's message", async () => {
    const put = deferred();
    stubApi({ "/api/pins": () => reply(200, pinned([BUDGET])), "PUT /api/pins/home": put.route });
    const { pins, run } = renderPins();
    await settle();

    run((p) => p.setPin(RIZAL, "home", true));
    expect(shown("home")).toBe("fields-budget,rizal-day");

    await put.release(apiError(404, "not_found", "not found: note rizal-day"));

    expect(await screen.findByText("Could not pin to Home")).toBeInTheDocument();
    expect(screen.getByText("not found: note rizal-day")).toBeInTheDocument();
    expect(shown("home")).toBe("fields-budget");
    expect(pins().isPinned("rizal-day", "home")).toBe(false);
    expect(screen.queryByText("Pinned to Home")).toBeNull();
  });

  it("takes a pin back out when the list already holds 50", async () => {
    const full = Array.from({ length: 50 }, (_, i) => summary(`note-${i}`, `Note ${i}`));
    const limit = "home already holds 50 pins, the most it can hold. Unpin one first.";
    stubApi({ "/api/pins": () => reply(200, pinned(full)), "PUT /api/pins/home": () => apiError(400, "validation", limit) });
    const { pins, run } = renderPins();
    await settle();

    run((p) => p.setPin(RIZAL, "home", true));
    expect(pins().lists.home).toHaveLength(51);

    expect(await screen.findByText(limit)).toBeInTheDocument();
    expect(screen.getByText("Could not pin to Home")).toBeInTheDocument();
    expect(pins().lists.home).toHaveLength(50);
    expect(pins().isPinned("rizal-day", "home")).toBe(false);
  });

  it("puts a move's whole new order, shows it at once, and sends nothing for a move past the end", async () => {
    const put = deferred();
    const fetchMock = stubApi({
      "/api/pins": () => reply(200, pinned([RIZAL, BUDGET, SPECS])),
      "PUT /api/pins/home/order": put.route,
    });
    const { run } = renderPins();
    await settle();

    run((p) => p.move("ryzen-laptop-specs", "home", "up"));

    expect(shown("home")).toBe("rizal-day,ryzen-laptop-specs,fields-budget");
    await settle();
    const [call] = callsTo(fetchMock, "PUT /api/pins/home/order");
    expect(call!.body).toEqual({ slugs: ["rizal-day", "ryzen-laptop-specs", "fields-budget"] });
    expect(call!.headers.get("X-Brain-Tool")).toBe("web");

    await put.release(reply(200, pinned([RIZAL, SPECS, BUDGET])));
    expect(shown("home")).toBe("rizal-day,ryzen-laptop-specs,fields-budget");

    run((p) => p.move("rizal-day", "home", "up"));
    await settle();
    expect(callsTo(fetchMock, "PUT /api/pins/home/order")).toHaveLength(1);
  });

  it("sends changes one at a time and works a move's order out from the answer before it", async () => {
    const pin = deferred();
    const fetchMock = stubApi({
      "/api/pins": () => reply(200, pinned([RIZAL])),
      "PUT /api/pins/home": pin.route,
      "PUT /api/pins/home/order": () => reply(200, pinned([BUDGET, RIZAL])),
    });
    const { run } = renderPins();
    await settle();

    run((p) => p.setPin(BUDGET, "home", true));
    run((p) => p.move("fields-budget", "home", "up"));
    expect(shown("home")).toBe("fields-budget,rizal-day");
    await settle();
    expect(callsTo(fetchMock, "PUT /api/pins/home/order")).toHaveLength(0);

    await pin.release(reply(200, pinned([RIZAL, BUDGET])));
    await settle();

    expect(callsTo(fetchMock, "PUT /api/pins/home/order").map((c) => c.body)).toEqual([{ slugs: ["fields-budget", "rizal-day"] }]);
    expect(shown("home")).toBe("fields-budget,rizal-day");
  });

  it("reads as no pins when the load fails, and loads again on retryLoad", async () => {
    let fail = true;
    const fetchMock = stubApi({
      "/api/pins": () => (fail ? apiError(500, "internal", "pins exploded") : reply(200, pinned([RIZAL]))),
    });
    const { run } = renderPins();
    await settle();

    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(shown("home")).toBe("");
    // A failed load is quiet: the pinned lists simply do not show.
    expect(screen.queryByText("pins exploded")).toBeNull();

    fail = false;
    run((p) => p.retryLoad());
    await settle();

    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(shown("home")).toBe("rizal-day");
    expect(callsTo(fetchMock, "GET /api/pins")).toHaveLength(2);
  });
});
