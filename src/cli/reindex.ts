import { config } from "../config.ts";
import { BrainImpl } from "../core/brain.ts";
import { createIndex } from "../core/index/index.ts";
import { createStore } from "../core/store/index.ts";

const store = createStore(config.brainPath);
const index = createIndex({
  dbPath: config.indexPath,
  modelCachePath: config.modelCachePath,
});
const brain = new BrainImpl(store, index);

// init() already builds an empty index from disk; rebuild only when it did not, so one run never builds twice.
const stats = (await brain.init()) ?? (await brain.reindex());
await brain.close();

console.log(`reindexed ${config.brainPath}`);
console.log(`  notes:    ${stats.notes}`);
console.log(`  files:    ${stats.files}`);
console.log(`  invalid:  ${stats.invalid}`);
console.log(`  duration: ${stats.durationMs} ms`);
