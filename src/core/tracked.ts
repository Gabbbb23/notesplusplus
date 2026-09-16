/**
 * Tracked folders: the owner's real folders outside the brain (course folders, job folders) holding the material notes
 * get written from. Nothing watches them. This module answers one question on demand: which documents under them has
 * no note taken in yet?
 *
 * A file counts as filed when a note left one of the two traces filing leaves behind:
 *
 *   mention  a note writes the file's full path as inline code, the trace src/core/graph/note-body.ts reads and the
 *            web view turns into Open and Show in folder buttons.
 *   copy     an attachment under files/ carries the same name and the same byte size, the trace left when the file was
 *            copied into the brain and listed in a note's `files:`.
 *
 * A filename in prose is not a trace: "the reflection is in Short Reflection Vinculado.pdf" names a file without
 * saying which one on disk it is. So a scan can call a file unfiled that the owner considers filed. It never misses a
 * file nothing in the brain records, which is what the scan is for.
 *
 * The store is the only source read here. The search index is a cache and can be mid-rebuild; whether a note records a
 * file is a fact about notes.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { checkDrivePath, pathKey } from "./graph/drive-path.ts";
import type { NoteStore } from "./types.ts";

/**
 * The extensions a scan looks at by default: documents notes get written from. Images, video, and archives are left
 * out because the folders hold thousands of screenshots and phone photos; `allExtensions` takes everything.
 */
export const DOCUMENT_EXTS = new Set("pdf doc docx odt rtf txt md csv ppt pptx odp xls xlsx xlsm ods".split(" "));

/**
 * Names that mark a folder as one a program keeps for itself, skipped with everything under it. A browser profile
 * copied into a course folder holds thousands of .txt and .md files (extension licences, cache indexes, blocklists),
 * enough to bury the owner's own documents. `Preferences` is matched as a file, the way Chromium writes it, so a
 * folder the owner named Preferences.docx or a folder full of coursework called Default is still scanned.
 */
const PROGRAM_DATA_FILES = new Set(["preferences", "secure preferences", "local state"]);
const PROGRAM_DATA_DIRS = new Set(["node_modules", "__pycache__"]);

export interface UnfiledFile {
  /** Absolute path, normalized the way a mention is, so it can be pasted into a note as one. */
  path: string;
  /** The part below the tracked root it was found under, with backslashes. */
  relativePath: string;
  /** The tracked root it was found under. */
  root: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface TrackedScan {
  /** The roots scanned, normalized, in the order given. */
  roots: string[];
  /** Roots that are not a folder on this machine. Scanned as empty. */
  missingRoots: string[];
  /** Files looked at, after the extension filter. */
  scanned: number;
  /** Of those, how many a note records. */
  filed: number;
  /** The rest, newest first. */
  unfiled: UnfiledFile[];
}

export interface ScanOptions {
  /** Look at every extension instead of DOCUMENT_EXTS. Default false. */
  allExtensions?: boolean;
}

/** Every trace of filing found in the brain, as the two lookups the scan needs. */
interface FilingTraces {
  /** pathKey of every path a note mentions. */
  mentioned: Set<string>;
  /** Lower-cased attachment name to the byte sizes stored under it, for the copy trace. */
  copySizes: Map<string, Set<number>>;
}

async function readTraces(store: NoteStore): Promise<FilingTraces> {
  const mentioned = new Set<string>();
  for await (const entry of store.readAll()) {
    if ("error" in entry) continue;
    for (const written of entry.mentions) mentioned.add(pathKey(written));
  }
  const copySizes = new Map<string, Set<number>>();
  for (const file of await store.files()) {
    const name = file.path.split("/").pop()?.toLowerCase();
    if (name === undefined || name === "") continue;
    const sizes = copySizes.get(name) ?? new Set<number>();
    sizes.add(file.sizeBytes);
    copySizes.set(name, sizes);
  }
  return { mentioned, copySizes };
}

/**
 * Normalize a tracked root the way a mention is normalized, so a root and a mention of a file under it compare.
 * Throws on anything checkDrivePath refuses, naming the root, because a typo in configuration should not read as an
 * empty folder.
 */
export function checkTrackedRoot(root: string): string {
  const checked = checkDrivePath(root);
  if (!checked.ok) throw new Error(`tracked path "${root}": ${checked.message}`);
  return checked.path;
}

function isFiled(abs: string, name: string, sizeBytes: number, traces: FilingTraces): boolean {
  if (traces.mentioned.has(pathKey(abs))) return true;
  return traces.copySizes.get(name.toLowerCase())?.has(sizeBytes) === true;
}

/**
 * The documents under `roots` that no note records, newest first.
 *
 * Skips folders whose name starts with a dot (`.git` and friends), folders a program keeps for itself
 * (PROGRAM_DATA_FILES, PROGRAM_DATA_DIRS), and the brain itself, so a brain kept inside a tracked folder does not
 * report its own attachments. A file reachable under two roots is reported once, under the first root that reaches it.
 */
export async function scanTracked(store: NoteStore, roots: string[], opts: ScanOptions = {}): Promise<TrackedScan> {
  const normalized = roots.map(checkTrackedRoot);
  const traces = await readTraces(store);
  const brainKey = pathKey(store.root);
  const seen = new Set<string>();
  const scan: TrackedScan = { roots: normalized, missingRoots: [], scanned: 0, filed: 0, unfiled: [] };

  for (const root of normalized) {
    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) {
      scan.missingRoots.push(root);
      continue;
    }
    await visit(root, root);
  }
  scan.unfiled.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  return scan;

  async function visit(root: string, dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.some((e) => e.isFile() && PROGRAM_DATA_FILES.has(e.name.toLowerCase()))) return;
    for (const entry of entries) {
      const abs = path.win32.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || PROGRAM_DATA_DIRS.has(entry.name.toLowerCase()) || pathKey(abs) === brainKey) continue;
        await visit(root, abs);
        continue;
      }
      // A symlink or junction is neither, so it is skipped and a link loop cannot send the walk in circles.
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (!opts.allExtensions && !DOCUMENT_EXTS.has(ext)) continue;
      const key = pathKey(abs);
      if (seen.has(key)) continue;
      seen.add(key);
      const fileStat = await fs.stat(abs).catch(() => null);
      if (!fileStat) continue;
      scan.scanned++;
      if (isFiled(abs, entry.name, fileStat.size, traces)) {
        scan.filed++;
        continue;
      }
      scan.unfiled.push({
        path: abs,
        relativePath: abs.slice(root.length).replace(/^\\+/, ""),
        root,
        mtimeMs: fileStat.mtimeMs,
        sizeBytes: fileStat.size,
      });
    }
  }
}
