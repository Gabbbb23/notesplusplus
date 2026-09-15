// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  extensionOf,
  fileNameOf,
  isBrowserViewable,
  isFolderPath,
  isLocalAbsolutePath,
  isOpenable,
} from "../src/lib/file-kinds";

const MODULE = String.raw`C:\Important Files\College Files\College Junior Year\1st Sem\GE08 - Ethics\Module 1.pdf`;

describe("isLocalAbsolutePath", () => {
  it("accepts drive paths with backslashes, forward slashes, spaces, and any drive letter", () => {
    expect(isLocalAbsolutePath(MODULE)).toBe(true);
    expect(isLocalAbsolutePath("C:/Important Files/College Files/Module 1.pdf")).toBe(true);
    expect(isLocalAbsolutePath(String.raw`d:\Videos\Lecture (week 3) & notes.mp4`)).toBe(true);
    expect(isLocalAbsolutePath(String.raw`C:\Important Files\College Files`)).toBe(true);
    expect(isLocalAbsolutePath("C:\\")).toBe(true);
  });

  it("rejects UNC paths, relative paths, and text that only starts like a path", () => {
    expect(isLocalAbsolutePath(String.raw`\\server\share\Module 1.pdf`)).toBe(false);
    expect(isLocalAbsolutePath("files/college/Module 1.pdf")).toBe(false);
    expect(isLocalAbsolutePath(String.raw`Important Files\Module 1.pdf`)).toBe(false);
    expect(isLocalAbsolutePath("C:Module 1.pdf")).toBe(false);
    expect(isLocalAbsolutePath("CD:/x")).toBe(false);
    expect(isLocalAbsolutePath(` ${MODULE}`)).toBe(false);
    expect(isLocalAbsolutePath("https://example.com/a.pdf")).toBe(false);
    expect(isLocalAbsolutePath("")).toBe(false);
  });

  it("rejects a second colon, a line break, and the characters Windows forbids", () => {
    expect(isLocalAbsolutePath(String.raw`C:\Files\a:b.pdf`)).toBe(false);
    expect(isLocalAbsolutePath(String.raw`C:\Files\C:\a.pdf`)).toBe(false);
    expect(isLocalAbsolutePath("C:\\Files\na.pdf")).toBe(false);
    expect(isLocalAbsolutePath("C:\\Files\r\na.pdf")).toBe(false);
    for (const c of ["<", ">", '"', "|", "?", "*"]) {
      expect(isLocalAbsolutePath(`C:\\Files\\a${c}b.pdf`), c).toBe(false);
    }
  });
});

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

describe("isBrowserViewable and isOpenable", () => {
  it("decides by extension, whatever its case", () => {
    expect(isBrowserViewable(MODULE)).toBe(true);
    expect(isBrowserViewable(String.raw`C:\Photos\IMG_0001.JPG`)).toBe(true);
    expect(isBrowserViewable("files/clip.MP4")).toBe(true);
    expect(isOpenable(String.raw`C:\Photos\IMG_0001.JPG`)).toBe(true);
    expect(isOpenable("files/Deck.PPTX")).toBe(true);
  });

  it("opens Office files and other media without viewing them", () => {
    for (const path of ["files/a.docx", "files/a.pptx", "files/a.xlsx", "C:/Videos/a.mkv", "C:/a.zip", "C:/a.flac"]) {
      expect(isOpenable(path), path).toBe(true);
      expect(isBrowserViewable(path), path).toBe(false);
    }
  });

  it("never opens programs or scripts, and treats a path without an extension as a folder", () => {
    for (const path of ["C:/Tools/setup.exe", "C:/a.bat", "C:/a.ps1", "C:/Desktop/App.lnk", "files/a.js"]) {
      expect(isOpenable(path), path).toBe(false);
      expect(isBrowserViewable(path), path).toBe(false);
    }
    const folder = String.raw`C:\Important Files\College Files\College Junior Year\1st Sem`;
    expect(isFolderPath(folder)).toBe(true);
    expect(isOpenable(folder)).toBe(true);
    expect(isBrowserViewable(folder)).toBe(false);
    expect(isFolderPath(MODULE)).toBe(false);
  });
});
