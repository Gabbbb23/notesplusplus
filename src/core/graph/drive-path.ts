/**
 * Drive-letter absolute paths such as `C:\College Files\Module 1.pdf`: the only kind of path outside the brain that a
 * note may mention and a request may name. The mention parser (note-body.ts) and the REST path check
 * (src/api/local-paths.ts) both call checkDrivePath, so a path the web view offers buttons for is a path the server
 * accepts, and both compare paths through pathKey.
 */
import path from "node:path";

export type DrivePathProblem = "unc" | "characters" | "traversal" | "not-absolute" | "stream";

export type DrivePathCheck =
  | { ok: true; /** Normalized: backslashes, upper-case drive letter, no trailing separator except on a drive root. */ path: string }
  | { ok: false; problem: DrivePathProblem; message: string };

const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/**
 * Whether `text`, exactly as given, is a usable drive-letter absolute path. Refused, in this order: UNC and device
 * paths (a UNC path would send the owner's NTLM credentials to a remote host), control characters and `" < > | ? *`
 * (Windows forbids them in file names, and a `"` would break the launcher's quoting), any `..` segment, anything that
 * is not `X:\` or `X:/` followed by more, and a colon after the drive letter (alternate data streams).
 */
export function checkDrivePath(text: string): DrivePathCheck {
  if (/^[\\/]{2}/.test(text)) return refuse("unc", "UNC and device paths are not allowed");
  if (/[\x00-\x1f"<>|?*]/.test(text)) return refuse("characters", "path contains characters Windows does not allow in file names");
  if (text.split(/[\\/]/).includes("..")) return refuse("traversal", "path traversal rejected");
  if (!DRIVE_PATH.test(text)) return refuse("not-absolute", "path must be absolute (C:\\...)");
  if (text.includes(":", 2)) return refuse("stream", "alternate data streams are not allowed");
  return { ok: true, path: normalizeDrivePath(text) };
}

function refuse(problem: DrivePathProblem, message: string): DrivePathCheck {
  return { ok: false, problem, message };
}

function normalizeDrivePath(p: string): string {
  const norm = path.win32.normalize(p);
  const trimmed = norm.length > 3 ? norm.replace(/\\+$/, "") : norm;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * The comparison key for a drive-letter path: Windows paths ignore case and accept either slash, and a trailing
 * separator does not change the path. `C:\College\` and `c:/college` share a key; `C:\College 2` does not.
 * The index stores each mention under this key, and a request's path is looked up by it.
 */
export function pathKey(p: string): string {
  return normalizeDrivePath(p).toLowerCase();
}
