# notesplusplus

A personal second brain that an AI agent reads and writes. See `INTENT.md` for purpose and scope, `DECISIONS.md` for every settled choice.

## Run

```
cp .env.example .env      # set BRAIN_PATH and PORT
npm install
npm run init-brain        # creates the brain repo layout if missing
npm run build:web         # builds the web UI into web/dist (installs web/ deps first: npm --prefix web install)
npm start                 # REST API + web UI on http://localhost:3777 (listens on 127.0.0.1 only)
```

The MCP server for Claude Code and Codex runs as a separate stdio process (`npm run mcp`) and talks to the REST API over HTTP, so `npm start` must be running.

## Architecture

One Node process serves everything. TypeScript, run with `tsx`. The web UI in `web/` is a React single-page app built with Vite (`npm run build:web`) and served as static files from `web/dist`.

```
src/
  config.ts          BRAIN_PATH, PORT, CACHE_PATH, TRACKED_PATHS
  core/
    types.ts         shared contracts: NoteStore, SearchIndex, Brain, errors. Every module builds against this.
    store/           NoteStore: files on disk, frontmatter, slugs, wikilinks, tags.yml, inbox, git auto-commit
    index/           SearchIndex: SQLite (node:sqlite) with FTS5, local embeddings, links table, file text extraction
    brain.ts         Brain facade composing store + index
    tracked.ts       which documents in the owner's folders outside the brain no note records yet
  api/               Hono REST routes over Brain. JSON in, JSON out. Also serves files for viewing and opens
                     them in their default app or File Explorer (local-paths.ts holds the rules, launcher.ts the launch),
                     and exports notes as markdown or PDF (pdf-export.ts prints the web print page with headless Edge).
  mcp/               MCP stdio server. Thin HTTP client of the REST API. Serves conventions + prompts.
  cli/               init-brain, reindex, extract (a document's text), unfiled (tracked folders vs the brain)
  app.ts             the HTTP app: api + static web UI from web/dist (SPA fallback for non-/api routes)
  server.ts          entry: opens the brain and serves app.ts on 127.0.0.1 and ::1
  mcp.ts             entry: mcp stdio
conventions/
  conventions.md     how the store is organized. Served by MCP as a resource and by REST at /api/conventions.
  file.md            the "file this material" skill, served as an MCP prompt.
  garden.md          the "tidy the store" skill, served as an MCP prompt.
test/                vitest
web/                 React + Vite + Tailwind + shadcn UI. Own package.json; read-only pages plus the inbox drop box.
  src/lib/api.ts     typed client over docs/rest-api.md
  src/components/    shared table, badge, card, page header, and long-text components every page reuses (see its README.md)
  src/pages/         home, note, search, tags, inbox, files, check
  test/              vitest + testing-library
```

## Brain repo layout

```
<BRAIN_PATH>/
  notes/<slug>.md      type: note | hub.  notes/index.md is the root hub.
  sources/<slug>.md    type: source. Raw material kept verbatim under a frontmatter header.
  files/**             attachments
  inbox/**             new material dropped by the owner
  tags.yml             [{ name, description }]
  pins.yml             { home: [slug], sidebar: [slug] }, the owner's pins in order
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

## Tracked folders

`TRACKED_PATHS` names the owner's folders outside the brain that hold raw material (course folders, job folders), separated by `;`. Nothing watches them. `npm run unfiled` walks them on demand and lists the documents no note records, newest first:

```
npm run unfiled                      # documents under TRACKED_PATHS, newest 30
npm run unfiled -- --all             # every extension, screenshots and video included
npm run unfiled -- --limit 0         # no cut-off
npm run unfiled -- --root "C:\..."   # this folder instead of TRACKED_PATHS
```

A file counts as recorded when a note mentions its full path, or an attachment under `files/` has the same name and byte size. A filename written in prose is not enough, so the list can name a file the owner considers filed; it never leaves out a file nothing in the brain records. `src/core/tracked.ts` holds both rules and what the walk skips.

## Conventions the code enforces

- Strict on write: missing required fields, unknown tags, bad slugs, and stale mtimes are rejected.
- Loose on read: anything on disk is indexed, invalid files are reported by `check_links`, never crashed on.
- Every write is one git commit, message `<tool>: <action> <slug>`.
- The index is a cache, rebuilt from disk. While the server runs, rebuild it with `POST /api/reindex`: the new index builds in a side file and swaps in, so search keeps working. With the server stopped, `npm run reindex` does the same; it refuses while another process has the index open.
