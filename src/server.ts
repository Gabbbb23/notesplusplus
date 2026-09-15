import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApi } from "./api/index.ts";
import { config } from "./config.ts";
import { BrainImpl } from "./core/brain.ts";
import { createIndex } from "./core/index/index.ts";
import { createStore } from "./core/store/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const conventionsDir = path.resolve(here, "..", "conventions");
const webDist = path.resolve(here, "..", "web", "dist");
const webIndex = path.join(webDist, "index.html");

const store = createStore(config.brainPath);
const index = createIndex({
  dbPath: config.indexPath,
  modelCachePath: config.modelCachePath,
});
const brain = new BrainImpl(store, index);
await brain.init();

const app = new Hono();
app.route("/", createApi(brain, { conventionsDir }));

// The web UI is a single-page app built into web/dist (`npm run build:web`).
// Static assets are served as-is; every other non-/api GET gets index.html so
// client-side routes such as /notes/:slug work on a hard reload.
const hasWebBuild = fs.existsSync(webIndex);
if (hasWebBuild) {
  app.use("/*", serveStatic({ root: webDist }));
}

const NO_BUILD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>notes++</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; line-height: 1.6">
<h1>Web UI not built</h1>
<p>The API is running, but <code>web/dist</code> does not exist yet. Run <code>npm run build:web</code> first, then reload.</p>
</body></html>
`;

app.get("/*", async (c) => {
  if (c.req.path.startsWith("/api/") || c.req.path === "/api") {
    return c.json({ error: { code: "not_found", message: `no route for ${c.req.method} ${c.req.path}` } }, 404);
  }
  if (!hasWebBuild) return c.html(NO_BUILD_PAGE, 503);
  const html = await fs.promises.readFile(webIndex, "utf8");
  return c.html(html);
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`notes++ serving ${config.brainPath} at http://localhost:${info.port}`);
  if (!hasWebBuild) console.log("web/dist not found: run `npm run build:web` to enable the web UI");
});
