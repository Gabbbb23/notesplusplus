import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, noteExportUrl, printNoteUrl } from "../src/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("export and print URLs", () => {
  it("encode the slug", () => {
    expect(noteExportUrl("rizal day", "md")).toBe("/api/notes/rizal%20day/export.md");
    expect(noteExportUrl("rizal-day", "pdf")).toBe("/api/notes/rizal-day/export.pdf");
    expect(printNoteUrl("rizal-day")).toBe("/print/notes/rizal-day");
    expect(printNoteUrl("rizal-day", { autoprint: true })).toBe("/print/notes/rizal-day?autoprint=1");
  });
});

describe("api pins", () => {
  it("put JSON as the web tool and return the lists", async () => {
    const lists = { home: [], sidebar: [] };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => lists,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.setPin("home", "rizal-day", true)).resolves.toEqual(lists);
    await api.orderPins("sidebar", ["b", "a"]);

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ["/api/pins/home", "PUT", JSON.stringify({ slug: "rizal-day", pinned: true })],
      ["/api/pins/sidebar/order", "PUT", JSON.stringify({ slugs: ["b", "a"] })],
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("X-Brain-Tool")).toBe("web");
    }
  });
});

describe("api.openFile and api.revealFile", () => {
  it("post the path as JSON and return the reply", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ opened: "C:\\a.pdf" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.openFile("C:\\a.pdf")).resolves.toEqual({ opened: "C:\\a.pdf" });
    await api.revealFile("files/a.pdf");

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ["/api/open", "POST", JSON.stringify({ path: "C:\\a.pdf" })],
      ["/api/reveal", "POST", JSON.stringify({ path: "files/a.pdf" })],
    ]);
  });

  it("turn the error envelope into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({ error: { code: "forbidden", message: "Refusing to open .exe files" } }),
      })),
    );
    const err = await api.openFile("C:\\setup.exe").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "forbidden", message: "Refusing to open .exe files" });
  });
});
