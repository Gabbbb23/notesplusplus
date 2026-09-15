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

await brain.store.init();
await brain.index.open();
const stats = await brain.reindex();
await brain.index.close();

console.log(`reindexed ${config.brainPath}`);
console.log(`  notes:    ${stats.notes}`);
console.log(`  files:    ${stats.files}`);
console.log(`  invalid:  ${stats.invalid}`);
console.log(`  duration: ${stats.durationMs} ms`);
