import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { createIndex } from "../src/core/index/index.ts";
import { EMBEDDING_DIMS } from "../src/core/index/embeddings.ts";

// The real embedder imports @huggingface/transformers lazily; stand in for it so
// these tests cover the server's warm-up path without a model or a network.
const { pipeline } = vi.hoisted(() => ({ pipeline: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({ env: {}, pipeline }));

beforeEach(() => {
  pipeline.mockReset();
});

function realEmbedderIndex(logs: string[]) {
  const dir = path.join(os.tmpdir(), "npp-warm-never-created");
  return createIndex({ dbPath: path.join(dir, "index.sqlite"), modelCachePath: dir, log: (m) => logs.push(m) });
}

test("warming a model that fails to load resolves, logs why, and does not retry", async () => {
  pipeline.mockRejectedValue(new Error("model files missing"));
  const logs: string[] = [];
  const idx = realEmbedderIndex(logs);

  await expect(idx.warm()).resolves.toBeUndefined();
  await expect(idx.warm()).resolves.toBeUndefined();

  expect(pipeline).toHaveBeenCalledTimes(1);
  expect(logs).toContain("embedding model unavailable, semantic search disabled: model files missing");
  expect(logs).toContain("embedding warm-up: model unavailable, search falls back to keywords");
});

test("warming a model that fails on first use resolves and logs why", async () => {
  pipeline.mockResolvedValue(async () => {
    throw new Error("session run failed");
  });
  const logs: string[] = [];
  await expect(realEmbedderIndex(logs).warm()).resolves.toBeUndefined();
  expect(logs).toContain("embedding failed: session run failed");
});

test("warming loads the model once and runs one embedding", async () => {
  const extractor = vi.fn(async (texts: string[]) => ({
    dims: [texts.length, EMBEDDING_DIMS],
    data: new Float32Array(texts.length * EMBEDDING_DIMS).fill(0.05),
  }));
  pipeline.mockResolvedValue(extractor);
  const logs: string[] = [];
  const idx = realEmbedderIndex(logs);

  await idx.warm();
  await idx.warm();

  expect(pipeline).toHaveBeenCalledTimes(1);
  expect(extractor).toHaveBeenCalledTimes(2);
  expect(logs.some((l) => l.includes("ready in"))).toBe(true);
  expect(logs.some((l) => l.includes("warm-up"))).toBe(false);
});
