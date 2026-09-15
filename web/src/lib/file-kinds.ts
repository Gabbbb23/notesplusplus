/*
 * What the web UI may offer for a file a note mentions. The server enforces the same sets on
 * GET /api/files, GET /api/local-file, and POST /api/open; the UI uses them only to decide
 * which controls FileActions shows (DECISIONS.md, 2026-09-15).
 *
 * Paths come in two shapes: brain-relative ("files/college/Module 1.pdf", always forward
 * slashes) and absolute Windows paths outside the brain ("C:\College Files\Module 1.pdf").
 */

/** Types a browser tab can show inline: View. */
export const BROWSER_VIEWABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "webp",
  "bmp",
  "svg",
  "mp4",
  "m4v",
  "webm",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "oga",
  "txt",
  "md",
  "csv",
  "json",
]);

/** Types the server will hand to their default Windows app: Open. Folders qualify too. */
export const OPENABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "txt",
  "md",
  "csv",
  "ppt",
  "pptx",
  "odp",
  "xls",
  "xlsx",
  "xlsm",
  "ods",
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "webp",
  "bmp",
  "svg",
  "mp4",
  "m4v",
  "mov",
  "mkv",
  "avi",
  "webm",
  "wmv",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "oga",
  "flac",
  "zip",
]);

/**
 * A drive letter, a colon, a slash or backslash, then no further colon, no line break, and none
 * of < > " | ? *. UNC paths (\\server\share) do not match.
 */
const LOCAL_ABSOLUTE_PATH = /^[A-Za-z]:[\\/][^:\r\n<>"|?*]*$/;

/** True for an absolute Windows path such as "C:\Important Files\Module 1.pdf" or "D:/notes". */
export function isLocalAbsolutePath(text: string): boolean {
  return LOCAL_ABSOLUTE_PATH.test(text);
}

/** The last segment of a path with either slash style: "C:\a\Module 1.pdf" -> "Module 1.pdf". A drive root comes back whole. */
export function fileNameOf(path: string): string {
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return name === "" || /^[A-Za-z]:$/.test(name) ? path : name;
}

/**
 * The lowercased extension without the dot, or "" when there is none. Like Node's path.extname,
 * a leading dot (".gitignore") and a trailing slash do not make an extension.
 */
export function extensionOf(path: string): string {
  if (/[\\/]$/.test(path)) return "";
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** A path with no extension is treated as a folder: Open opens it in File Explorer. */
export function isFolderPath(path: string): boolean {
  return extensionOf(path) === "";
}

/** Shows View: the browser can display it in a tab. */
export function isBrowserViewable(path: string): boolean {
  return BROWSER_VIEWABLE_EXTENSIONS.has(extensionOf(path));
}

/** Shows Open: a document, media, or archive type, or a folder. Never a program or script. */
export function isOpenable(path: string): boolean {
  return isFolderPath(path) || OPENABLE_EXTENSIONS.has(extensionOf(path));
}
