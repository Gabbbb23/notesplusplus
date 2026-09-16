import "dotenv/config";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { checkTrackedRoot } from "./core/tracked.ts";

export interface Config {
  /** Absolute path to the notes repo (the brain). */
  brainPath: string;
  /** Port for the REST API and web UI. */
  port: number;
  /** Where the SQLite index and the embedding model cache live. Inside the app repo, gitignored. */
  cachePath: string;
  /** SQLite index for this brain. Keyed by brain path so two brains never share an index. */
  indexPath: string;
  /** Embedding model cache, shared across brains. */
  modelCachePath: string;
  /** Folders outside the brain holding the owner's raw material, scanned by `npm run unfiled`. Empty by default. */
  trackedPaths: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const brainPath = path.resolve(env.BRAIN_PATH ?? path.join(os.homedir(), "brain"));
  const port = Number.parseInt(env.PORT ?? "3777", 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer, got "${env.PORT}"`);
  }
  const cachePath = path.resolve(env.CACHE_PATH ?? path.join(process.cwd(), ".cache"));
  const brainKey = createHash("sha1").update(brainPath.toLowerCase()).digest("hex").slice(0, 12);
  // Semicolon-separated, the separator Windows itself uses for lists of paths, because a folder name may hold a comma.
  const trackedPaths = (env.TRACKED_PATHS ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map(checkTrackedRoot);
  return {
    brainPath,
    port,
    cachePath,
    indexPath: path.join(cachePath, "index", brainKey, "index.sqlite"),
    modelCachePath: path.join(cachePath, "models"),
    trackedPaths,
  };
}

export const config: Config = loadConfig();
