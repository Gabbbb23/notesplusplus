/**
 * The REST contract: one zod schema per request and response shape, with the rules its fields follow.
 *
 * This is the source of truth docs/rest-api.md describes. src/core/types.ts infers its data types from these schemas,
 * the REST adapter (src/api/index.ts) parses requests with them, and the MCP adapter (src/mcp/server.ts) builds its
 * tool inputs from them, so REST and MCP accept the same values. Depends on zod only.
 */
export * from "./rules.ts";
export * from "./schemas.ts";
