import { describe, expect, it } from "vitest";
import { canReach, createScrollMemory, SCROLL_MEMORY_STORAGE_KEY } from "../src/lib/scroll-memory";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe("scroll memory", () => {
  it("recalls the last position remembered for a key, rounded and never negative", () => {
    const memory = createScrollMemory(null);
    expect(memory.recall("a")).toBeUndefined();
    memory.remember("a", 120.6);
    memory.remember("a", 640.2);
    memory.remember("b", -3);
    expect(memory.recall("a")).toBe(640);
    expect(memory.recall("b")).toBe(0);
  });

  it("keeps only the newest entries up to the limit", () => {
    const memory = createScrollMemory(null, 2);
    memory.remember("a", 1);
    memory.remember("b", 2);
    memory.remember("a", 3);
    memory.remember("c", 4);
    expect(memory.recall("b")).toBeUndefined();
    expect(memory.recall("a")).toBe(3);
    expect(memory.recall("c")).toBe(4);
  });

  it("comes back from storage and persists to it", () => {
    const storage = fakeStorage({ [SCROLL_MEMORY_STORAGE_KEY]: JSON.stringify([["a", 100], ["bad"], ["b", "x"]]) });
    const memory = createScrollMemory(storage);
    expect(memory.recall("a")).toBe(100);
    expect(memory.recall("b")).toBeUndefined();
    memory.remember("c", 250);
    memory.persist();
    expect(JSON.parse(storage.data.get(SCROLL_MEMORY_STORAGE_KEY)!)).toEqual([
      ["a", 100],
      ["c", 250],
    ]);
  });

  it("ignores storage that holds something other than a list", () => {
    const memory = createScrollMemory(fakeStorage({ [SCROLL_MEMORY_STORAGE_KEY]: "{not json" }));
    expect(memory.recall("a")).toBeUndefined();
  });

  it("knows when a page is tall enough to reach a position", () => {
    expect(canReach(640, 3000, 800)).toBe(true);
    expect(canReach(2200, 3000, 800)).toBe(true);
    expect(canReach(2201, 3000, 800)).toBe(false);
    expect(canReach(0, 100, 800)).toBe(true);
  });
});
