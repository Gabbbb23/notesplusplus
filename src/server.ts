import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApi } from "./api/index.ts";
import { config } from "./config.ts";
import { BrainImpl } from "./core/brain.ts";
import { createIndex } from "./core/index/index.ts";
import { createStore } from "./core/store/index.ts";
import { createWeb, notFoundPage } from "./web/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const conventionsDir = path.resolve(here, "..", "conventions");

const store = createStore(config.brainPath);
const index = createIndex({
  dbPath: path.join(config.cachePath, "index.sqlite"),
  modelCachePath: path.join(config.cachePath, "models"),
});
const brain = new BrainImpl(store, index);
await brain.init();

const app = new Hono();
app.route("/", createApi(brain, { conventionsDir }));
app.route("/", createWeb(brain));
app.notFound((c) => c.html(notFoundPage(), 404));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`notes++ serving ${config.brainPath} at http://localhost:${info.port}`);
});
