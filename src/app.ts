import fs from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApi, type ApiOptions } from "./api/index.ts";
import type { Brain } from "./core/types.ts";

export interface AppOptions extends ApiOptions {
  /** The web UI's build output, web/dist (`npm run build:web`). */
  webDist: string;
}

const NO_BUILD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>notes++</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; line-height: 1.6">
<h1>Web UI not built</h1>
<p>The API is running, but <code>web/dist</code> does not exist yet. Run <code>npm run build:web</code> first, then reload.</p>
</body></html>
`;

/**
 * Everything one server answers: the REST API under /api and the web UI everywhere else. src/server.ts listens with it,
 * and the Edge export test runs the same app on a spare port.
 */
export function createApp(brain: Brain, { webDist, ...apiOptions }: AppOptions): Hono {
  const app = new Hono();
  app.route("/", createApi(brain, apiOptions));

  // The web UI is a single-page app. Static assets are served as-is; every other non-/api GET gets index.html so
  // client-side routes such as /notes/:slug and /print/notes/:slug work on a hard reload.
  const webIndex = path.join(webDist, "index.html");
  const hasWebBuild = fs.existsSync(webIndex);
  if (hasWebBuild) {
    app.use("/*", serveStatic({ root: webDist }));
  }

  app.get("/*", async (c) => {
    if (c.req.path.startsWith("/api/") || c.req.path === "/api") {
      return c.json({ error: { code: "not_found", message: `no route for ${c.req.method} ${c.req.path}` } }, 404);
    }
    if (!hasWebBuild) return c.html(NO_BUILD_PAGE, 503);
    const html = await fs.promises.readFile(webIndex, "utf8");
    return c.html(html);
  });

  return app;
}
