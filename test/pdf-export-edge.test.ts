import { once } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { TempBrain } from "./helpers/temp-brain.ts";

// The one test that starts the installed Microsoft Edge. It needs Edge, and a web build (`npm run build:web`) that has
// the /print/notes/:slug page, so it runs only when asked: NOTES_TEST_EDGE=1 npx vitest run test/pdf-export-edge.test.ts

const repo = path.resolve(import.meta.dirname, "..");
const webDist = path.join(repo, "web", "dist");

describe.runIf(process.env.NOTES_TEST_EDGE === "1")("PDF export through installed Microsoft Edge", () => {
  let tb: TempBrain;
  let server: ReturnType<typeof serve>;
  let port = 0;

  beforeAll(async () => {
    expect(fs.existsSync(path.join(webDist, "index.html")), "web/dist is missing: run npm run build:web first").toBe(true);
    tb = await TempBrain.create();
    await tb.brain.write(
      {
        slug: "edge-export",
        frontmatter: { title: "Edge export: does it print?", type: "note", summary: "A note printed by the Edge test.", tags: [] },
        body: "The export prints this note.\n\n| Exam | Week |\n|---|---|\n| Prelims | 7 |\n",
      },
      { tool: "test" },
    );
    const app = createApp(tb.brain, {
      conventionsDir: path.join(repo, "conventions"),
      webDist,
      listenPort: () => port,
      launcher: {
        open: async () => {
          throw new Error("tests never open files");
        },
        reveal: async () => {
          throw new Error("tests never reveal files");
        },
      },
    });
    // Port 0 takes a free port; the app reads the real one when the export starts.
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await tb?.dispose();
  });

  it("prints a note from a throwaway server to a PDF file", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/notes/edge-export/export.pdf`);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.status, bytes.toString("utf8").slice(0, 500)).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="Edge export does it print.pdf"; filename*=UTF-8''Edge%20export%20does%20it%20print.pdf`,
    );
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 90_000);
});
