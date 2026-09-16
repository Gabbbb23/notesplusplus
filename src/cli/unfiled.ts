/**
 * List the documents in the owner's tracked folders that no note records, newest first. The answer to "I added a file,
 * which one have you not seen?"
 *
 *   npm run unfiled                      documents under TRACKED_PATHS
 *   npm run unfiled -- --all             every extension, screenshots and video included
 *   npm run unfiled -- --limit 0         no cut-off (default 30)
 *   npm run unfiled -- --root "C:\..."   scan this folder instead of TRACKED_PATHS
 *
 * What counts as recorded, and why a file already filed can still be listed, is src/core/tracked.ts.
 */
import { config } from "../config.ts";
import { createStore } from "../core/store/index.ts";
import { scanTracked, type UnfiledFile } from "../core/tracked.ts";

const args = process.argv.slice(2);

function flagValues(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) fail(`--${name} needs a value`);
      out.push(value!);
      i++;
    }
  }
  return out;
}

function fail(message: string): never {
  console.error(`unfiled: ${message}`);
  console.error(`usage: tsx src/cli/unfiled.ts [--all] [--limit <n>] [--root <path>]`);
  process.exit(2);
}

const limitFlag = flagValues("limit").at(-1);
const limit = limitFlag === undefined ? 30 : Number.parseInt(limitFlag, 10);
if (!Number.isInteger(limit) || limit < 0) fail(`--limit needs a whole number, got "${limitFlag}"`);

const roots = flagValues("root");
const tracked = roots.length > 0 ? roots : config.trackedPaths;
if (tracked.length === 0) {
  fail("no tracked folders. Set TRACKED_PATHS in .env (semicolon-separated) or pass --root");
}

const store = createStore(config.brainPath);
const scan = await scanTracked(store, tracked, { allExtensions: args.includes("--all") });

for (const root of scan.missingRoots) console.error(`not a folder, skipped: ${root}`);

const kind = args.includes("--all") ? "files" : "documents";
const where = scan.roots.length === 1 ? scan.roots[0] : `${scan.roots.length} tracked folders`;
console.log(`${scan.scanned} ${kind} under ${where}: ${scan.filed} recorded in the brain, ${scan.unfiled.length} not.`);

function line(file: UnfiledFile): string {
  const date = new Date(file.mtimeMs).toISOString().slice(0, 10);
  const size = `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`.padStart(8);
  const name = scan.roots.length === 1 ? file.relativePath : file.path;
  return `${date}  ${size}  ${name}`;
}

const shown = limit === 0 ? scan.unfiled : scan.unfiled.slice(0, limit);
if (shown.length > 0) console.log();
for (const file of shown) console.log(line(file));

const hidden = scan.unfiled.length - shown.length;
if (hidden > 0) console.log(`\n${hidden} older, not shown. Pass --limit 0 for all of them.`);
