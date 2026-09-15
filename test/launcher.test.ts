import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createLauncher, type SpawnLike } from "../src/api/launcher.ts";

interface SpawnCall {
  command: string;
  args: string[];
  options: SpawnOptions;
}

/** Records spawn calls and never starts a process. `fail` makes the fake child emit an error instead of spawn. */
function fakeSpawn(calls: SpawnCall[], fail?: Error): SpawnLike {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), { unref: () => {} });
    queueMicrotask(() => (fail ? child.emit("error", fail) : child.emit("spawn")));
    return child as unknown as ChildProcess;
  };
}

const detached = { detached: true, stdio: "ignore" };
const verbatim = { windowsVerbatimArguments: true, ...detached };

describe("createLauncher", () => {
  it("goes through explorer.exe with the path quoted verbatim on Windows", async () => {
    const calls: SpawnCall[] = [];
    const launcher = createLauncher("win32", fakeSpawn(calls));
    await launcher.open("C:\\Important Files\\Smith, J & Co^.pdf");
    await launcher.reveal("C:\\Important Files\\Module 1.pdf", false);
    await launcher.reveal("C:\\Important Files", true);
    await launcher.open("C:\\");
    expect(calls).toEqual([
      { command: "explorer.exe", args: ['"C:\\Important Files\\Smith, J & Co^.pdf"'], options: verbatim },
      { command: "explorer.exe", args: ['/select,"C:\\Important Files\\Module 1.pdf"'], options: verbatim },
      { command: "explorer.exe", args: ['"C:\\Important Files"'], options: verbatim },
      { command: "explorer.exe", args: ["C:\\"], options: verbatim },
    ]);
  });

  it("uses open on macOS and xdg-open on Linux", async () => {
    const mac: SpawnCall[] = [];
    const macLauncher = createLauncher("darwin", fakeSpawn(mac));
    await macLauncher.open("/Users/me/a.pdf");
    await macLauncher.reveal("/Users/me/a.pdf", false);
    await macLauncher.reveal("/Users/me", true);
    expect(mac.map((c) => [c.command, ...c.args])).toEqual([
      ["open", "/Users/me/a.pdf"],
      ["open", "-R", "/Users/me/a.pdf"],
      ["open", "/Users/me"],
    ]);

    const linux: SpawnCall[] = [];
    const linuxLauncher = createLauncher("linux", fakeSpawn(linux));
    await linuxLauncher.open("/home/me/a.pdf");
    await linuxLauncher.reveal("/home/me/a.pdf", false);
    await linuxLauncher.reveal("/home/me", true);
    expect(linux.map((c) => [c.command, ...c.args])).toEqual([
      ["xdg-open", "/home/me/a.pdf"],
      ["xdg-open", "/home/me"],
      ["xdg-open", "/home/me"],
    ]);
    expect(linux[0]!.options).toEqual(detached);
  });

  it("rejects when the program cannot start", async () => {
    const launcher = createLauncher("win32", fakeSpawn([], new Error("spawn explorer.exe ENOENT")));
    await expect(launcher.open("C:\\a.pdf")).rejects.toThrow("ENOENT");
  });
});
