import { config } from "../config.ts";
import { createStore } from "../core/store/index.ts";

const store = createStore(config.brainPath);
await store.init();
console.log(`brain ready at ${store.root}`);
