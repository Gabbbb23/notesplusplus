import { spawn, type SpawnOptions } from "node:child_process";
import path from "node:path";

/**
 * Starts programs on the owner's desktop for POST /api/open and /api/reveal.
 * The API takes one through ApiOptions so tests pass a fake and never launch anything.
 * Paths arrive already checked by local-paths.ts.
 */
export interface Launcher {
  /** Open a file with its default app, or a folder in the file manager. */
  open(absPath: string): Promise<void>;
  /** Show a file selected in its folder, or open a folder. */
  reveal(absPath: string, isDirectory: boolean): Promise<void>;
}

export type SpawnLike = (command: string, args: string[], options: SpawnOptions) => ReturnType<typeof spawn>;

/**
 * Explorer's command line splits on commas, so the path is always quoted and passed verbatim.
 * Windows paths cannot contain ", which makes that safe. A drive root (C:\) goes bare: nothing to quote,
 * and a quote right after the backslash could read as escaped.
 */
function explorerArg(absPath: string): string {
  return absPath.endsWith("\\") ? absPath : `"${absPath}"`;
}

export function createLauncher(platform: NodeJS.Platform = process.platform, spawnImpl: SpawnLike = spawn): Launcher {
  // Resolves once the program starts. Exit codes are ignored: explorer.exe exits with 1 even on success.
  const launch = (command: string, args: string[], options: SpawnOptions = {}) =>
    new Promise<void>((resolve, reject) => {
      const child = spawnImpl(command, args, { ...options, detached: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });

  if (platform === "win32") {
    // Always explorer.exe, never `cmd /c start`: cmd would parse & and ^ in file names.
    const open = (absPath: string) => launch("explorer.exe", [explorerArg(absPath)], { windowsVerbatimArguments: true });
    return {
      open,
      reveal: (absPath, isDirectory) =>
        isDirectory ? open(absPath) : launch("explorer.exe", [`/select,${explorerArg(absPath)}`], { windowsVerbatimArguments: true }),
    };
  }
  if (platform === "darwin") {
    return {
      open: (absPath) => launch("open", [absPath]),
      reveal: (absPath, isDirectory) => launch("open", isDirectory ? [absPath] : ["-R", absPath]),
    };
  }
  return {
    open: (absPath) => launch("xdg-open", [absPath]),
    reveal: (absPath, isDirectory) => launch("xdg-open", [isDirectory ? absPath : path.dirname(absPath)]),
  };
}
