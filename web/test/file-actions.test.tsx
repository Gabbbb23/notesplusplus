import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileActions, FileLink } from "../src/components/file-actions";

const MODULE = String.raw`C:\Important Files\College Files\College Junior Year\1st Sem\GE08 - Ethics\Module 1.pdf`;

function renderWithToasts(ui: ReactNode) {
  return render(
    <>
      {ui}
      <Toaster />
    </>,
  );
}

/** The minimum of a fetch Response that lib/api.ts reads. */
function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body } as Response;
}

function stubFetch(respond: () => Promise<Response>) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<FileActions> controls", () => {
  it("gives a PDF outside the brain View, Open, and Show in folder, each named after the file", () => {
    render(<FileActions path={MODULE} />);

    const view = screen.getByRole("link", { name: "View Module 1.pdf in a new tab" });
    expect(view).toHaveAttribute("href", `/api/local-file?path=${encodeURIComponent(MODULE)}`);
    expect(view).toHaveAttribute("target", "_blank");
    expect(view).toHaveAttribute("rel", "noopener noreferrer");

    const open = screen.getByRole("button", { name: "Open Module 1.pdf in its default app" });
    expect(open).toHaveTextContent("Open");
    const show = screen.getByRole("button", { name: "Show Module 1.pdf in File Explorer" });
    expect(show).toHaveTextContent("Show in folder");
  });

  it("views a brain file through /api/files", () => {
    render(<FileActions path="files/college/4th-year/Course Syllabus.pdf" />);
    expect(screen.getByRole("link", { name: "View Course Syllabus.pdf in a new tab" })).toHaveAttribute(
      "href",
      "/api/files/college/4th-year/Course%20Syllabus.pdf",
    );
  });

  it("offers View only for types a browser shows", () => {
    render(<FileActions path="files/fields/Budget.xlsx" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Open Budget.xlsx in its default app" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Budget.xlsx in File Explorer" })).toBeInTheDocument();
  });

  it("never offers Open for a program, but still offers Show in folder", () => {
    render(<FileActions path={String.raw`C:\Tools\setup.EXE`} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Open/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Show setup.EXE in File Explorer" })).toBeInTheDocument();
  });

  it("offers Open folder for a path without an extension", () => {
    render(<FileActions path={String.raw`C:\Important Files\College Files\College Junior Year\1st Sem`} />);
    expect(screen.queryByRole("link")).toBeNull();
    const open = screen.getByRole("button", { name: "Open folder 1st Sem in File Explorer" });
    expect(open).toHaveTextContent("Open folder");
    expect(screen.getByRole("button", { name: "Show 1st Sem in File Explorer" })).toBeInTheDocument();
  });

  it("uses name, when given, in the accessible names", () => {
    render(<FileActions path={MODULE} name="Ethics module 1" />);
    expect(screen.getByRole("button", { name: "Open Ethics module 1 in its default app" })).toBeInTheDocument();
  });

  it("compact size shows icons with a tooltip and keeps the full accessible names", () => {
    const { container } = render(<FileActions path={MODULE} size="compact" />);
    expect(container.querySelector("[data-slot='file-actions']")).toHaveAttribute("data-size", "compact");
    const open = screen.getByRole("button", { name: "Open Module 1.pdf in its default app" });
    expect(open).toHaveTextContent("");
    expect(open).toHaveAttribute("title", "Open in its default app");
    expect(open.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Show Module 1.pdf in File Explorer" })).toHaveAttribute(
      "title",
      "Show in File Explorer",
    );
    expect(screen.getByRole("link", { name: "View Module 1.pdf in a new tab" })).toBeInTheDocument();
  });
});

describe("<FileActions> requests", () => {
  it("clicking Open posts the path to /api/open, disables the button while it runs, and toasts", async () => {
    let finish: (res: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => (finish = resolve)));
    renderWithToasts(<FileActions path={MODULE} />);

    const open = screen.getByRole("button", { name: "Open Module 1.pdf in its default app" });
    const show = screen.getByRole("button", { name: "Show Module 1.pdf in File Explorer" });
    fireEvent.click(open);

    expect(open).toBeDisabled();
    expect(show).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/open");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ path: MODULE });

    await act(async () => finish(reply(200, { opened: MODULE })));

    expect(await screen.findByText("Opening Module 1.pdf")).toBeInTheDocument();
    expect(open).toBeEnabled();
  });

  it("clicking Show in folder posts the brain path to /api/reveal and toasts", async () => {
    const fetchMock = stubFetch(async () => reply(200, { revealed: "C:\\brain\\files\\a.docx" }));
    renderWithToasts(<FileActions path="files/a.docx" />);

    fireEvent.click(screen.getByRole("button", { name: "Show a.docx in File Explorer" }));

    expect(await screen.findByText("Showing a.docx in File Explorer")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/reveal");
    expect(JSON.parse(String(init?.body))).toEqual({ path: "files/a.docx" });
  });

  it("a 403 shows the friendly message with the server's reason under it", async () => {
    stubFetch(async () => reply(403, { error: { code: "forbidden", message: "No note mentions this path" } }));
    renderWithToasts(<FileActions path={MODULE} />);

    const open = screen.getByRole("button", { name: "Open Module 1.pdf in its default app" });
    fireEvent.click(open);

    expect(await screen.findByText("Only files mentioned in a note can be opened")).toBeInTheDocument();
    expect(screen.getByText("No note mentions this path")).toBeInTheDocument();
    expect(open).toBeEnabled();
  });

  it("a 404 names the missing path", async () => {
    stubFetch(async () => reply(404, { error: { code: "not_found", message: "not found" } }));
    renderWithToasts(<FileActions path={MODULE} />);

    fireEvent.click(screen.getByRole("button", { name: "Show Module 1.pdf in File Explorer" }));

    expect(await screen.findByText(`File not found: ${MODULE}`)).toBeInTheDocument();
  });

  it("any other error shows the server's message", async () => {
    stubFetch(async () => reply(400, { error: { code: "validation", message: "path must be a string" } }));
    renderWithToasts(<FileActions path={MODULE} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Module 1.pdf in its default app" }));

    expect(await screen.findByText("path must be a string")).toBeInTheDocument();
  });
});

describe("<FileLink>", () => {
  it("shows the path with break points, then the compact actions", () => {
    const { container } = render(<FileLink path={MODULE} />);
    const link = container.querySelector("[data-slot='file-link']")!;
    const text = link.querySelector("[data-slot='breakable-text']")!;
    expect(text.tagName).toBe("SPAN");
    expect(text.textContent).toBe(MODULE);
    expect(text.querySelectorAll("wbr").length).toBeGreaterThan(3);
    expect(link.querySelector("[data-slot='file-actions']")).toHaveAttribute("data-size", "compact");
    expect(screen.getByRole("button", { name: "Open Module 1.pdf in its default app" })).toBeInTheDocument();
  });

  it("shows name instead of the path, and code style when asked", () => {
    const { container } = render(<FileLink path="files/college/Syllabus.pdf" name="Syllabus" code />);
    const text = container.querySelector("[data-slot='breakable-text']")!;
    expect(text.tagName).toBe("CODE");
    expect(text.textContent).toBe("Syllabus");
    expect(screen.getByRole("link", { name: "View Syllabus in a new tab" })).toHaveAttribute(
      "href",
      "/api/files/college/Syllabus.pdf",
    );
  });
});
