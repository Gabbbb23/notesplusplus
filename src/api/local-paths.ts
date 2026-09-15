/**
 * Which files the web UI may view, open, or reveal. The server decides; the UI only asks.
 *
 * A request names a brain attachment (`files/...`) or an absolute drive-letter path. An absolute path is
 * allowed when it lies inside the brain, or when a note mentions exactly that path in an inline code span,
 * which is how notes point at files kept outside the brain. Nothing inside the brain's .git is ever allowed.
 */
import fs from "node:fs";
import path from "node:path";
import { ForbiddenError, NotFoundError, ValidationError, type Brain } from "../core/types.ts";

export type RequestedPath = { kind: "brain"; rel: string } | { kind: "absolute"; abs: string };

const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** Normalized Windows form: backslashes, upper-case drive letter, no trailing separator except on a drive root. */
function normalizeAbsolute(p: string): string {
  const norm = path.win32.normalize(p);
  const trimmed = norm.length > 3 ? norm.replace(/\\+$/, "") : norm;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Validate a path from a request. Throws ValidationError on anything that is not a drive-letter absolute path
 * or a `files/...` path, and on shapes that reach past the local disk: UNC paths (which would send the
 * owner's NTLM credentials to a remote host), device paths, alternate data streams, and `..` segments.
 */
export function parseRequestedPath(input: string): RequestedPath {
  if (input.trim() === "") throw new ValidationError("path is required");
  if (/^[\\/]{2}/.test(input)) throw new ValidationError("UNC and device paths are not allowed");
  // Windows file names cannot hold these, and a " would break the quoting in the launcher.
  if (/[\x00-\x1f"<>|?*]/.test(input)) throw new ValidationError("path contains characters Windows does not allow in file names");
  const segments = input.split(/[\\/]/);
  if (segments.includes("..")) throw new ValidationError("path traversal rejected");
  if (DRIVE_PATH.test(input)) {
    if (input.includes(":", 2)) throw new ValidationError("alternate data streams are not allowed");
    return { kind: "absolute", abs: normalizeAbsolute(input) };
  }
  if (!input.includes(":") && segments[0] === "files" && segments.length > 1) {
    return { kind: "brain", rel: segments.filter((s) => s !== "" && s !== ".").join("/") };
  }
  throw new ValidationError("path must be absolute (C:\\...) or start with files/");
}

/** Comparison key: Windows paths are case-insensitive and accept either slash. */
export function pathKey(p: string): string {
  return normalizeAbsolute(p).toLowerCase();
}

function isInside(key: string, parentKey: string): boolean {
  return key === parentKey || key.startsWith(parentKey.endsWith("\\") ? parentKey : `${parentKey}\\`);
}

/** Lines outside fenced code blocks (``` or ~~~, an unterminated fence runs to the end). */
function proseLines(body: string): string[] {
  const out: string[] = [];
  let close: RegExp | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (close) {
      if (close.test(line)) close = null;
      continue;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const run = fence[1]!;
      close = new RegExp(`^ {0,3}${run[0]}{${run.length},}[ \\t]*$`);
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Absolute paths a note body mentions as single-backtick inline code, e.g. `C:\College\Module 1.pdf`,
 * normalized. Fenced blocks and double-backtick spans do not count, nor do spans that fail parseRequestedPath.
 */
export function extractMentionedPaths(body: string): string[] {
  const out: string[] = [];
  for (const line of proseLines(body)) {
    for (const m of line.matchAll(/(?<!`)`([^`]+)`(?!`)/g)) {
      const text = m[1]!.trim();
      if (!DRIVE_PATH.test(text)) continue;
      try {
        const parsed = parseRequestedPath(text);
        if (parsed.kind === "absolute") out.push(parsed.abs);
      } catch {
        // not a usable path; ignore
      }
    }
  }
  return out;
}

const OPENABLE = new Set(
  (
    "pdf doc docx odt rtf txt md csv ppt pptx odp xls xlsx xlsm ods " +
    "png jpg jpeg jfif gif webp bmp svg mp4 m4v mov mkv avi webm wmv mp3 wav m4a ogg oga flac zip"
  ).split(" "),
);

/**
 * Whether POST /api/open may hand this file to its default app. An allowlist, so programs, scripts, and
 * shortcuts are refused. A name ending in a dot or space is refused too: Windows strips those, so
 * `setup.exe.` would run setup.exe.
 */
export function isOpenable(filePath: string): boolean {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  if (/[. ]$/.test(name)) return false;
  const dot = name.lastIndexOf(".");
  return dot > 0 && OPENABLE.has(name.slice(dot + 1).toLowerCase());
}

async function mentionedKeys(brain: Brain): Promise<Set<string>> {
  const summaries = await brain.list();
  const notes = await Promise.all(summaries.map((s) => brain.get(s.slug)));
  const keys = new Set<string>();
  for (const note of notes) {
    for (const p of extractMentionedPaths(note?.body ?? "")) keys.add(pathKey(p));
  }
  return keys;
}

/**
 * Resolve a requested path to an existing file or folder the UI may use.
 * 400 malformed, 403 not allowed, 404 missing or neither a file nor a folder.
 */
export async function resolveAllowedPath(brain: Brain, input: string): Promise<{ abs: string; stat: fs.Stats }> {
  const requested = parseRequestedPath(input);
  const root = brain.store.root;
  const gitKey = pathKey(path.join(root, ".git"));
  const forbidden = () => new ForbiddenError(`${input} is not a brain file or a path mentioned in a note`);

  let abs: string;
  if (requested.kind === "brain") {
    abs = brain.store.resolve(requested.rel);
  } else {
    abs = requested.abs;
    const key = pathKey(abs);
    if (!isInside(key, pathKey(root)) && !(await mentionedKeys(brain)).has(key)) throw forbidden();
  }
  if (isInside(pathKey(abs), gitKey)) throw forbidden();

  let stat: fs.Stats;
  let real: string;
  try {
    stat = await fs.promises.stat(abs);
    real = await fs.promises.realpath(abs);
  } catch {
    throw new NotFoundError(`file ${input}`);
  }
  if (!stat.isFile() && !stat.isDirectory()) throw new NotFoundError(`file ${input}`);
  // A junction, symlink, or 8.3 short name (GIT~1) can reach .git without spelling it.
  const realRoot = await fs.promises.realpath(root).catch(() => root);
  if (isInside(pathKey(real), pathKey(path.join(realRoot, ".git")))) throw forbidden();
  return { abs, stat };
}
