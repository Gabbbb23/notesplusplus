import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, fileUrl, localFileUrl, viewUrlFor } from "../src/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("file URLs", () => {
  it("encodes each segment of a brain path", () => {
    expect(fileUrl("files/sub dir/a#1.pdf")).toBe("/api/files/sub%20dir/a%231.pdf");
  });

  it("puts an absolute path, fully encoded, in the local-file query", () => {
    const path = String.raw`C:\Important Files\GE08 - Ethics\Module 1 & 2+.pdf`;
    const url = localFileUrl(path);
    expect(url).toBe(`/api/local-file?path=${encodeURIComponent(path)}`);
    expect(url).not.toContain("+.pdf");
    expect(new URL(url, "http://localhost").searchParams.get("path")).toBe(path);
  });

  it("viewUrlFor sends absolute paths to local-file and brain paths to files", () => {
    expect(viewUrlFor("C:/Videos/Lecture 1.mp4")).toBe(`/api/local-file?path=${encodeURIComponent("C:/Videos/Lecture 1.mp4")}`);
    expect(viewUrlFor("files/college/a b.pdf")).toBe("/api/files/college/a%20b.pdf");
    // A UNC path is not a local path for this feature, so it never reaches local-file.
    expect(viewUrlFor(String.raw`\\server\share\a.pdf`)).not.toContain("local-file");
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
