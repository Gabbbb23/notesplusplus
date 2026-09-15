import { describe, expect, it } from "vitest";
import { isOpenable, parseRequestedPath } from "../src/api/local-paths.ts";
import { ValidationError } from "../src/core/types.ts";

describe("parseRequestedPath", () => {
  it("accepts drive-letter paths in either slash style, normalized", () => {
    expect(parseRequestedPath("C:\\Important Files\\Module 1.pdf")).toEqual({ kind: "absolute", abs: "C:\\Important Files\\Module 1.pdf" });
    expect(parseRequestedPath("c:/Important Files//Module 1.pdf")).toEqual({ kind: "absolute", abs: "C:\\Important Files\\Module 1.pdf" });
    expect(parseRequestedPath("D:\\College\\")).toEqual({ kind: "absolute", abs: "D:\\College" });
    expect(parseRequestedPath("C:/")).toEqual({ kind: "absolute", abs: "C:\\" });
  });

  it("accepts brain-relative files/ paths", () => {
    expect(parseRequestedPath("files/college/a b.pdf")).toEqual({ kind: "brain", rel: "files/college/a b.pdf" });
    expect(parseRequestedPath("files\\college\\x.pdf")).toEqual({ kind: "brain", rel: "files/college/x.pdf" });
  });

  const rejected: Array<[string, string]> = [
    ["empty", ""],
    ["blank", "   "],
    ["UNC path", "\\\\server\\share\\Module 1.pdf"],
    ["UNC path with forward slashes", "//server/share/Module 1.pdf"],
    ["device path \\\\?\\", "\\\\?\\C:\\Module 1.pdf"],
    ["device path \\\\.\\", "\\\\.\\C:\\Module 1.pdf"],
    ["alternate data stream", "C:\\Module 1.pdf:hidden"],
    ["alternate data stream ::$DATA", "C:\\Module 1.pdf::$DATA"],
    ["alternate data stream on a files/ path", "files/invoice.pdf:hidden"],
    [".. segment", "C:\\College\\..\\Windows\\notepad.exe"],
    [".. segment with forward slashes", "C:/College/../Windows"],
    [".. segment in files/", "files/../.git/config"],
    ["relative path outside files/", "notes/index.md"],
    ["bare file name", "Module 1.pdf"],
    ["files with nothing after it", "files"],
    ["drive-relative path", "C:Module 1.pdf"],
    ["rooted path without a drive", "\\Windows\\notepad.exe"],
    ["double quote", 'C:\\a"b.pdf'],
    ["wildcard", "C:\\*.pdf"],
    ["control character", "C:\\a\u0000.pdf"],
  ];

  it.each(rejected)("rejects %s", (_label, input) => {
    expect(() => parseRequestedPath(input)).toThrow(ValidationError);
  });
});

describe("isOpenable", () => {
  it("allows documents, images, media, and zip", () => {
    for (const name of ["a.pdf", "B.PDF", "a.docx", "a.odt", "deck.pptx", "sheet.xlsm", "photo.jfif", "logo.svg", "clip.mkv", "song.flac", "archive.zip"]) {
      expect(isOpenable(`C:\\Files\\${name}`), name).toBe(true);
    }
  });

  it("refuses programs, scripts, shortcuts, databases, and names Windows would rewrite", () => {
    const refused = [
      "setup.exe", "run.bat", "run.cmd", "x.com", "x.ps1", "x.vbs", "x.js", "x.hta", "Desktop.lnk", "site.url",
      "x.msi", "x.scr", "x.reg", "x.jar", "db.accdb", "setup.exe.", "report.pdf.", "report.pdf ", "README", ".pdf",
    ];
    for (const name of refused) {
      expect(isOpenable(`C:\\Files\\${name}`), name).toBe(false);
    }
  });
});
