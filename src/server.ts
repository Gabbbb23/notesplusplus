import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdaptorServer, serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { BrainImpl } from "./core/brain.ts";
import { createIndex } from "./core/index/index.ts";
import { createStore } from "./core/store/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const conventionsDir = path.resolve(here, "..", "conventions");
const webDist = path.resolve(here, "..", "web", "dist");

const store = createStore(config.brainPath);
const index = createIndex({
  dbPath: config.indexPath,
  modelCachePath: config.modelCachePath,
  log: (msg) => console.log(msg),
});
const brain = new BrainImpl(store, index);
await brain.init();

// PDF exports open this server's own print pages, so they need the port it actually listens on.
let listenPort = config.port;
const app = createApp(brain, { conventionsDir, webDist, listenPort: () => listenPort });

// Loopback only, on both loopback addresses. Listening on every interface would let anyone on the
// same Wi-Fi reach the API. `localhost` resolves to ::1 first, and a client that finds ::1 closed
// can wait around 200 ms per connection before it tries 127.0.0.1.
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  listenPort = info.port;
  console.log(`notes++ serving ${config.brainPath} at http://localhost:${info.port}`);
  if (!fs.existsSync(path.join(webDist, "index.html"))) console.log("web/dist not found: run `npm run build:web` to enable the web UI");

  // IPv6 may be disabled or the port taken on ::1. Then 127.0.0.1 alone still serves everything.
  const ipv6 = createAdaptorServer({ fetch: app.fetch, hostname: "[::1]" });
  ipv6.on("error", (err) => console.log(`not listening on [::1]:${info.port}, 127.0.0.1 only: ${err.message}`));
  ipv6.listen(info.port, "::1");

  // Load the embedding model now so the first semantic query does not wait for it. Never rejects.
  void index.warm();
});
