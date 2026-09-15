/**
 * Which files the web UI may view, open, or reveal. The server decides; the UI only asks.
 *
 * This module holds only request-level concerns. A request names a brain attachment (`files/...`) or a drive-letter
 * absolute path. An absolute path is allowed when it lies inside the brain, or when Brain.isMentioned says some note
 * mentions it; what counts as a mention, and how paths compare, live in core (src/core/graph). Nothing inside the
 * brain's .git is ever allowed, however it is spelled.
 */
import fs from "node:fs";
import path from "node:path";
import { checkDrivePath, pathKey } from "../core/graph/drive-path.ts";
import { ForbiddenError, NotFoundError, ValidationError, type Brain } from "../core/types.ts";

export type RequestedPath = { kind: "brain"; rel: string } | { kind: "absolute"; abs: string };

/**
 * Validate a path from a request. An absolute path must pass checkDrivePath, the same rule a mention passes; its
 * refusals (UNC and device paths, forbidden characters, `..`, alternate data streams) apply to `files/...` paths too.
 * Throws ValidationError on anything else.
 */
export function parseRequestedPath(input: string): RequestedPath {
  if (input.trim() === "") throw new ValidationError("path is required");
  const drive = checkDrivePath(input);
  if (drive.ok) return { kind: "absolute", abs: drive.path };
  if (drive.problem !== "not-absolute") throw new ValidationError(drive.message);
  const segments = input.split(/[\\/]/);
  if (!input.includes(":") && segments[0] === "files" && segments.length > 1) {
    return { kind: "brain", rel: segments.filter((s) => s !== "" && s !== ".").join("/") };
  }
  throw new ValidationError("path must be absolute (C:\\...) or start with files/");
}

function isInside(key: string, parentKey: string): boolean {
  return key === parentKey || key.startsWith(parentKey.endsWith("\\") ? parentKey : `${parentKey}\\`);
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

/**
 * Resolve a requested path to an existing file or folder the UI may use.
 * 400 malformed, 403 not allowed, 404 missing or neither a file nor a folder.
 */
export async function resolveAllowedPath(brain: Brain, input: string): Promise<{ abs: string; stat: fs.Stats }> {
  const requested = parseRequestedPath(input);
  const root = brain.root;
  const forbidden = () => new ForbiddenError(`${input} is not a brain file or a path mentioned in a note`);

  let abs: string;
  if (requested.kind === "brain") {
    abs = brain.resolve(requested.rel);
  } else {
    abs = requested.abs;
    if (!isInside(pathKey(abs), pathKey(root)) && !(await brain.isMentioned(abs))) throw forbidden();
  }
  if (isInside(pathKey(abs), pathKey(path.join(root, ".git")))) throw forbidden();

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
