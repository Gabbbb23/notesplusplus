# notesplusplus

## Purpose

A personal second brain that an AI agent reads and writes. The owner hands over raw material (own notes, video transcripts, files). The agent interprets it, files it as structured markdown, links it, and keeps it organized. Later, the owner asks the agent a question and it finds the answer in the store.

The store is built for agents first and humans second. Every structural choice favors "an agent can understand what is here without reading all of it."

## Who it is for

One person, the owner, on one Windows laptop. No accounts, no sharing, no hosting.

## Current focus

Phase one: the note store, the index, the agent interface, and a read-only web view.

- Markdown files as the only source of truth, in a separate git repo (default `C:\Users\Joeven Jagocoy\brain`).
- Flat `notes/` folder. Organization through tags, wikilinks, and agent-maintained hub notes (`index.md` plus one hub per domain).
- `sources/` keeps raw material verbatim. `files/` keeps attachments. `inbox/` is where the owner drops new material for the agent.
- Every note carries required frontmatter: title, type (note | hub | source), summary, tags, created, updated. Optional: sources, files.
- SQLite index rebuilt from disk: FTS5 for keywords, local embeddings (small model, in-process, sqlite-vec) for semantic search. No external API.
- REST API is the core. A stdio MCP server wraps it for Claude Code and Codex. The MCP server also serves the conventions as a resource and the `file` and `garden` skills as prompts, so rules cannot drift from the code that enforces them.
- The agent has full write control and does not ask for confirmation. Every write is auto-committed so anything can be undone.
- Web UI: server-rendered, read-only, no build step. Home, note view with backlinks, search, tags, inbox drop box.

Done when: the owner can drop a transcript in the inbox, tell Claude Code to file it, and later find a specific fact from it through search in both the agent and the web UI.

## Constraints

- Notes must stay readable as plain markdown in any editor. Never require the app to make sense of a note.
- Write validation is strict (required frontmatter, tags must exist). Read is loose (index whatever is on disk, flag invalid files).
- TypeScript on Node. One process serves REST, MCP, index, and UI.
- No feature may require the laptop to be online.
- Two settings only: notes repo path and port.

## Later phases

- Google Calendar: agent creates reminders derived from notes. Other Google integrations as needs appear.
- Fetching transcripts from a URL.
- Scheduled gardening pass (dedupe, relink, refresh hubs).
- Human editing in the web UI.
- Hosting for access from other devices.

## Not doing

- Multi-user, auth, sharing.
- A rich text editor.
- A database as source of truth.
- Graph visualization.
