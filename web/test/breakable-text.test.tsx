import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BreakableText } from "../src/components/breakable-text";
import { breakPieces } from "../src/lib/break-points";

describe("<BreakableText>", () => {
  it("inserts <wbr> after each of / \\ _ - . , ? & = : and keeps the full text", () => {
    const value = "a/b\\c_d-e.f,g?h&i=j:k";
    const { container } = render(<BreakableText text={value} />);
    const span = container.querySelector("[data-slot='breakable-text']")!;
    expect(span.textContent).toBe(value);
    expect(span.querySelectorAll("wbr")).toHaveLength(10);
    // Each <wbr> sits right after one of the break characters.
    const before = Array.from(span.querySelectorAll("wbr")).map((w) => w.previousSibling?.textContent?.slice(-1));
    expect(before).toEqual(["/", "\\", "_", "-", ".", ",", "?", "&", "=", ":"]);
  });

  it("wraps a real file path at its separators", () => {
    const path = "files/fields/Cloud Hosting/V2/Cloud-Hosting-Budget-Proposal.pdf";
    const { container } = render(<BreakableText text={path} />);
    expect(container.textContent).toBe(path);
    expect(container.querySelectorAll("wbr").length).toBeGreaterThanOrEqual(6);
  });

  it("renders as the requested element with the last-resort wrap class", () => {
    const { container } = render(<BreakableText as="code" className="font-mono" text="notes/a.md" />);
    const code = container.querySelector("code")!;
    expect(code).toHaveClass("font-mono", "wrap-anywhere");
    expect(code.textContent).toBe("notes/a.md");
  });
});

describe("breakPieces", () => {
  it("always breaks after / \\ _ ? & = even between two digits", () => {
    expect(breakPieces("800164894_1057064503809638_6363216173991737476_n.png")).toEqual([
      "800164894_",
      "1057064503809638_",
      "6363216173991737476_",
      "n.png",
    ]);
    expect(breakPieces("11/3/2026")).toEqual(["11/", "3/", "2026"]);
    expect(breakPieces("files\\2026\\09")).toEqual(["files\\", "2026\\", "09"]);
    expect(breakPieces("a?1=2&3=4")).toEqual(["a?", "1=", "2&", "3=", "4"]);
  });

  it("breaks after - unless both neighbours are digits", () => {
    expect(breakPieces("files/fields/11-3-2026/002-PM_Procedure_")).toEqual([
      "files/",
      "fields/",
      "11-3-2026/",
      "002-",
      "PM_",
      "Procedure_",
    ]);
    expect(breakPieces("2026-09-14")).toEqual(["2026-09-14"]);
    expect(breakPieces("11-3-2026")).toEqual(["11-3-2026"]);
    expect(breakPieces("cross-region")).toEqual(["cross-", "region"]);
    expect(breakPieces("v2-final")).toEqual(["v2-", "final"]);
  });

  it("never breaks at . , or : between two digits", () => {
    expect(breakPieces("12.00")).toEqual(["12.00"]);
    expect(breakPieces("17:52")).toEqual(["17:52"]);
    expect(breakPieces("1,500,000")).toEqual(["1,500,000"]);
    expect(breakPieces("2026-09-14 17:52")).toEqual(["2026-09-14 17:52"]);
    expect(breakPieces("a.b,c:d")).toEqual(["a.", "b,", "c:", "d"]);
  });

  it("never breaks before a final file extension", () => {
    expect(breakPieces("Accounting-ACT.docx")).toEqual(["Accounting-", "ACT.docx"]);
    expect(breakPieces("v2.1/report.pdf")).toEqual(["v2.1/", "report.pdf"]);
    expect(breakPieces("notes_v2_.md")).toEqual(["notes_", "v2_.md"]);
    expect(breakPieces("archive.tar.gz")).toEqual(["archive.", "tar.gz"]);
    // Six characters after the dot is not an extension.
    expect(breakPieces("name.abcdef")).toEqual(["name.", "abcdef"]);
  });

  it("adds nothing at the end of the text or before whitespace", () => {
    expect(breakPieces("done. next")).toEqual(["done. next"]);
    expect(breakPieces("end/")).toEqual(["end/"]);
    expect(breakPieces("")).toEqual([""]);
  });
});
