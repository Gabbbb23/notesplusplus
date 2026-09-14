/**
 * MCP stdio entry. Run with `npm run mcp` (or via the .mcp.json in install/README.md).
 * Talks to the REST API over HTTP, so `npm start` must be running.
 *
 * stdout is the MCP transport. Log only through console.error.
 */
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.ts";
import { BrainClient } from "./mcp/client.ts";
import { createMcpServer } from "./mcp/server.ts";

const conventionsDir = path.resolve(import.meta.dirname, "..", "conventions");
const client = new BrainClient({ baseUrl: `http://localhost:${config.port}` });
const server = createMcpServer(client, { conventionsDir });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`brain mcp: connected over stdio, REST at ${client.baseUrl}, conventions in ${conventionsDir}`);
