# Connecting an agent to the brain

The MCP server (`src/mcp.ts`) is a stdio process that talks to the REST API over HTTP. `npm start` must be running in `C:\Projects\notesplusplus`, or every tool call fails with "Brain server not reachable".

## Claude Code

Add to the project's `.mcp.json` (project scope, shared with the repo) or run the `claude mcp add` command below (user scope, every project):

```json
{
  "mcpServers": {
    "brain": {
      "command": "npx",
      "args": ["tsx", "C:/Projects/notesplusplus/src/mcp.ts"],
      "env": { "PORT": "3777" }
    }
  }
}
```

```
claude mcp add brain -s user -e PORT=3777 -- npx tsx C:/Projects/notesplusplus/src/mcp.ts
```

`PORT` must match the `PORT` in `C:\Projects\notesplusplus\.env`.

Then install the skill so Claude Code reads the conventions before touching notes. Copy the `claude-skill` folder to `~/.claude/skills/brain/`:

```
mkdir -p ~/.claude/skills/brain
cp C:/Projects/notesplusplus/install/claude-skill/SKILL.md ~/.claude/skills/brain/SKILL.md
```

Restart Claude Code. `/mcp` should list `brain` with 13 tools, 3 resources, and 2 prompts.

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.brain]
command = "npx"
args = ["tsx", "C:/Projects/notesplusplus/src/mcp.ts"]

[mcp_servers.brain.env]
PORT = "3777"
```

Codex has no skills folder. Paste the body of `claude-skill/SKILL.md` into your `AGENTS.md`, or tell it once per session to read the `brain://conventions` resource.

## Check it works

1. `npm start` in `C:\Projects\notesplusplus`.
2. In the agent, call the `stats` tool. It returns note, file, and invalid counts.
3. Call `search` with any word. "Brain server not reachable" means the server is not running or `PORT` does not match `.env`.

## What the server exposes

Tools: search, get_note, list_notes, backlinks, write_note, rename_note, delete_note, list_tags, create_tag, inbox_list, inbox_take, check_links, stats.
Resources: `brain://conventions`, `brain://skills/file`, `brain://skills/garden`.
Prompts: `file` (optional `instructions`), `garden`.
