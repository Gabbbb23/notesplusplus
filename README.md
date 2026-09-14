# notesplusplus

A personal second brain that an AI agent reads and writes. See `INTENT.md` for purpose and scope, `DECISIONS.md` for every settled choice.

## Run

```
cp .env.example .env      # set BRAIN_PATH and PORT
npm install
npm run init-brain        # creates the brain repo layout if missing
npm start                 # REST API + web UI on http://localhost:3777
```

The MCP server for Claude Code and Codex runs as a separate stdio process (`npm run mcp`) and talks to the REST API over HTTP, so `npm start` must be running.

## Architecture

One Node process serves everything. TypeScript, run with `tsx`, no build step.

```
src/
  config.ts          BRAIN_PATH, PORT, CACHE_PATH
  core/
    types.ts         shared contracts: NoteStore, SearchIndex, Brain, errors. Every module builds against this.
    store/           NoteStore: files on disk, frontmatter, slugs, wikilinks, tags.yml, inbox, git auto-commit
    index/           SearchIndex: SQLite (node:sqlite) with FTS5, local embeddings, links table, file text extraction
    brain.ts         Brain facade composing store + index
  api/               Hono REST routes over Brain. JSON in, JSON out.
  web/               Server-rendered HTML pages over Brain. Read-only plus inbox drop box.
  mcp/               MCP stdio server. Thin HTTP client of the REST API. Serves conventions + prompts.
  cli/               init-brain, reindex
  server.ts          entry: api + web
  mcp.ts             entry: mcp stdio
conventions/
  conventions.md     how the store is organized. Served by MCP as a resource and by REST at /api/conventions.
  file.md            the "file this material" skill, served as an MCP prompt.
  garden.md          the "tidy the store" skill, served as an MCP prompt.
test/                vitest
```

## Brain repo layout

```
<BRAIN_PATH>/
  notes/<slug>.md      type: note | hub.  notes/index.md is the root hub.
  sources/<slug>.md    type: source. Raw material kept verbatim under a frontmatter header.
  files/**             attachments
  inbox/**             new material dropped by the owner
  tags.yml             [{ name, description }]
  .git
```

Frontmatter, all required unless marked:

```yaml
title: Ryzen laptop specs
type: note
summary: One sentence an agent reads before opening the note.
tags: [hardware, laptop]
created: 2026-09-13
updated: 2026-09-13
sources: [laptop-transcript]        # optional, slugs of source notes
files: [files/laptop-invoice.pdf]   # optional, brain-relative paths
```

Wikilinks are `[[slug]]` or `[[slug|label]]`. Slugs are lowercase, `a-z0-9`, hyphen-separated, unique across notes/ and sources/.

## Conventions the code enforces

- Strict on write: missing required fields, unknown tags, bad slugs, and stale mtimes are rejected.
- Loose on read: anything on disk is indexed, invalid files are reported by `check_links`, never crashed on.
- Every write is one git commit, message `<tool>: <action> <slug>`.
- The index is a cache. `npm run reindex` rebuilds it from disk at any time.
