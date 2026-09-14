---
name: brain
description: Use the brain MCP server to file, search, and maintain the owner's second brain. Read the conventions resource first.
---

# Brain

The owner's second brain is served by the `brain` MCP server. It needs `npm start` running in `C:\Projects\notesplusplus`.

1. At the start of any session that touches notes, read resource `brain://conventions` and follow it.
2. To file raw material or process the inbox, use the `file` prompt.
3. To tidy the store, use the `garden` prompt.
4. Find things with `search`, then `get_note` on the few that match, then `backlinks`.
5. Write only through the MCP tools. Never write to the brain folder on disk directly; the tools validate, index, and commit.
6. Do not ask the owner for confirmation on writes, renames, or deletes. Every write is a git commit and can be undone.
