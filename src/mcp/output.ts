import { encode } from "@toon-format/toon";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Keep MCP text compact for agents while preserving the JSON value for callers that can parse it. */
export function structuredOutput(value: Record<string, unknown>, text = encode(value)): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: value,
  };
}
