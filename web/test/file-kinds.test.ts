// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extensionOf, fileNameOf, isFolderPath, isOpenable } from "../src/lib/file-kinds";

const MODULE = String.raw`C:\Important Files\College Files\College Junior Year\1st Sem\GE08 - Ethics\Module 1.pdf`;

describe("fileNameOf and extensionOf", () => {
  it("takes the last segment with either slash style", () => {
    expect(fileNameOf(MODULE)).toBe("Module 1.pdf");
    expect(fileNameOf("C:/Important Files/Module 1.pdf")).toBe("Module 1.pdf");
    expect(fileNameOf("files/college/4th-year/Syllabus.docx")).toBe("Syllabus.docx");
    expect(fileNameOf("C:\\Important Files\\College Files\\")).toBe("College Files");
    expect(fileNameOf("invoice.pdf")).toBe("invoice.pdf");
    expect(fileNameOf("C:\\")).toBe("C:\\");
  });

  it("lowercases the extension and finds none on folders and dotfiles", () => {
    expect(extensionOf(MODULE)).toBe("pdf");
    expect(extensionOf("files/Report.Final.DOCX")).toBe("docx");
    expect(extensionOf(String.raw`C:\Important Files\1st Sem`)).toBe("");
    expect(extensionOf("C:\\Important Files\\v1.2\\")).toBe("");
    expect(extensionOf("files/.gitignore")).toBe("");
    expect(extensionOf(String.raw`C:\Some.Folder\Module 1`)).toBe("");
  });
});

describe("isOpenable", () => {
  it("decides by extension, whatever its case", () => {
    expect(isOpenable(MODULE)).toBe(true);
    expect(isOpenable(String.raw`C:\Photos\IMG_0001.JPG`)).toBe(true);
    expect(isOpenable("files/Deck.PPTX")).toBe(true);
  });

  it("opens documents, Office files, media, and archives", () => {
    for (const path of ["files/a.docx", "files/a.pptx", "files/a.xlsx", "C:/Videos/a.mkv", "C:/a.zip", "C:/a.flac"]) {
      expect(isOpenable(path), path).toBe(true);
    }
  });

  it("never opens programs or scripts, and treats a path without an extension as a folder", () => {
    for (const path of ["C:/Tools/setup.exe", "C:/a.bat", "C:/a.ps1", "C:/Desktop/App.lnk", "files/a.js"]) {
      expect(isOpenable(path), path).toBe(false);
    }
    const folder = String.raw`C:\Important Files\College Files\College Junior Year\1st Sem`;
    expect(isFolderPath(folder)).toBe(true);
    expect(isOpenable(folder)).toBe(true);
    expect(isFolderPath(MODULE)).toBe(false);
  });
});
