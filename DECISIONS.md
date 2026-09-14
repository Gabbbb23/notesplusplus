# Decisions

## 2026-09-13 — Single user, local only
Decision: Personal tool for the owner alone. Runs on localhost on this laptop. No accounts, no hosting.
Because: No plans for other users. Hosting adds auth, backups, and deploy work that has no payoff yet.

## 2026-09-13 — Markdown files are the source of truth
Decision: Notes are markdown files on disk with YAML frontmatter. SQLite holds a rebuildable index only.
Because: Agents read markdown natively, Claude Code and Codex can already read a folder, and git gives history for free. A database would hide everything behind the API.

## 2026-09-13 — REST core with stdio MCP wrapper
Decision: REST API holds the logic. A thin MCP server over stdio exposes it to agents. The web UI uses REST.
Because: Claude Code and Codex both support stdio MCP. REST keeps it reachable from anything that does not.

## 2026-09-13 — Agent is the author, owner is the source
Decision: The owner supplies raw material and seeds baseline context. The agent interprets and writes to the store. The agent has full control and never asks for confirmation on writes, renames, merges, or deletes.
Because: The store is agent-catered. Git auto-commit on every write makes any mistake reversible.

## 2026-09-13 — Web UI is read-only in v1
Decision: Server-rendered pages with no build step. Rendered notes, backlinks, search, tags, and an inbox drop box. No editing.
Because: The agent is the sole writer. Owner input flows through the inbox to keep one write path.

## 2026-09-13 — Hybrid search with local embeddings
Decision: FTS5 for keywords plus a small embedding model run in-process in Node, vectors in sqlite-vec.
Because: Laptop has a Ryzen 7 7735HS, 16 GB RAM, and an RTX 4050, which runs a small model without effort. No external API and no separate service to keep alive.

## 2026-09-13 — Strict on write, loose on read
Decision: The API rejects notes missing required frontmatter or using unknown tags. The indexer accepts anything on disk and flags invalid files.
Because: Agents follow rules well when the tool refuses bad input. Loose read means a stray file never breaks the index.

## 2026-09-13 — Separate notes repo, auto-commit
Decision: Notes live in their own git repo outside the app repo, default `C:\Users\Joeven Jagocoy\brain`. The app commits after every write with a message naming the tool and note.
Because: Data stays independent of the app. Full history of what the agent did.

## 2026-09-13 — TypeScript on Node
Decision: One language for server, MCP, index, and UI.
Because: The MCP SDK is most mature in TypeScript. No known need for Python ML libraries.

## 2026-09-13 — Input paths are conversation and inbox
Decision: Material enters by talking to the agent or dropping text and files into `inbox/`. No URL clipping, email, or voice in v1.
Because: Each is its own pipeline. Two paths cover the stated need.

## 2026-09-13 — Raw material kept verbatim
Decision: Processed inbox items move to `sources/` unchanged, linked from every derived note.
Because: Summaries drop details. The agent must be able to re-read the original.

## 2026-09-13 — Flat notes folder with hub notes
Decision: All notes in one `notes/` folder. Organization through tags, wikilinks, a root `index.md`, and one agent-maintained hub note per domain.
Because: Folders force a note into one bucket. Hubs give an agent an overview without reading everything.

## 2026-09-13 — Conventions served by the MCP server
Decision: The MCP server exposes the conventions as a resource and the `file` and `garden` skills as prompts. The installed harness skill stays minimal and points at them.
Because: Rules will change. Serving them from the process that enforces them prevents drift.

## 2026-09-13 — Transcripts are pasted, not fetched
Decision: The owner pastes or drops transcripts. No YouTube fetching in v1.
Because: Fetching is a dependency that breaks when platforms change.

## 2026-09-13 — Gardening is manual in v1
Decision: A `garden` prompt the owner invokes. No scheduler.
Because: Trust the pass before automating it. Scheduling is trivial to add later.

## 2026-09-13 — Slug filenames
Decision: Filenames are slugs from the title. The rename tool rewrites wikilinks. The index reports broken links.
Because: Readability for both owner and agent. The agent does the renaming and can fix what it breaks.

## 2026-09-13 — Frontmatter field set
Decision: Required: title, type (note | hub | source), summary, tags, created, updated. Optional: sources, files. Nothing else.
Because: Every extra required field is one more thing the agent gets wrong.

## 2026-09-13 — MCP tool surface
Decision: search, get_note, list_notes, backlinks, write_note (whole file), rename_note, delete_note, list_tags, create_tag, inbox_list, inbox_take, check_links. Resource: conventions. Prompts: file, garden.
Because: Whole-file writes suit how agents reason about small notes. The list covers filing, finding, and maintaining.

## 2026-09-13 — Attachments in files/ with text extraction
Decision: `files/` folder in the notes repo. Indexer extracts text from PDF, txt, md, docx. Other types indexed by filename. Warn above 20 MB, do not block.
Because: Searchable file contents serve the "find the specific thing" goal. Git LFS can be added later if the repo gets heavy.

## 2026-09-13 — Edit conflicts
Decision: Last-write-wins with a modified-time check. A write fails if the file changed since it was read.
Because: One user on one laptop does not justify more.

## 2026-09-13 — Google integrations deferred to phase two
Decision: No Google work in v1. Phase two starts with the agent creating Calendar reminders derived from notes.
Because: OAuth and API work do not touch the store design and are better scoped once the store is in daily use.
