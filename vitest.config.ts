import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Tests create temp brain repos and a SQLite index; run files serially to avoid git/sqlite contention.
    fileParallelism: false,
  },
});
