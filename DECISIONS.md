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

## 2026-09-14 — Web UI moves to React, Vite, Tailwind, and shadcn
Decision: The web UI is a React single-page app built with Vite, styled with Tailwind and shadcn components, served as static files by the same Node process. A build step is accepted. Light theme only, using Google's white and grey surfaces.
Because: The owner wants real shadcn components and a comfortable light theme, and accepts a build step for it.
Supersedes: 2026-09-13 — Web UI is read-only in v1 (the "server-rendered, no build step" part; read-only plus inbox drop box still holds).

## 2026-09-14 — Fields is the first project in the brain
Decision: The Fields Group project gets its own `fields` tag and `fields` hub. The 44 documents under C:\Projects\fields\Documents are copied into the brain's files folder and get one note each with key facts, plus notes on the fields-api and fields-fe repo architecture taken from their AGENTS.md and README. Source code is not described.
Because: Fields is the owner's main work; the goal is finding specific facts inside the documents. Repo docs give architecture context without the bulk of source.

## 2026-09-14 — Index extracts PowerPoint and Excel text
Decision: The indexer extracts text from .pptx, .xlsx, and .xlsm in addition to PDF, Word, and plain text.
Because: The Fields documents include decks and workbooks that must be searchable by content.

## 2026-09-14 — Tables never scroll sideways
Decision: No table in the web UI scrolls horizontally at any width, on list pages or inside note bodies. Long values wrap at natural break points. When a table's columns cannot fit, it switches to a stacked layout where each row becomes a block of label and value pairs.
Because: The owner does not want to scroll sideways to read a table.

## 2026-09-14 — One shared component per UI pattern
Decision: Tables, badges, cards, page headers, and long-text wrapping each live in one shared component under web/src/components. Pages compose them and never restyle these patterns locally. An architecture test fails when a page reaches past the shared component to the underlying shadcn primitive or hard-codes colours.
Because: A design change should reach every page that uses the pattern from a single edit.

## 2026-09-15 — College is the second domain, past years are not copied
Decision: A `college` tag and hub for the owner's BSIT degree. The current semester's documents (4th year, 1st semester) are copied into `files/college/4th-year` and get notes. Past years get one note per subject that points at the original paths under `C:\Important Files\College Files`; their files stay where they are. JOB, SHS, unorganized files, and the Vivaldi browser profile inside College Junior Year are left out.
Because: The owner asked for a college tag and asked how storage-efficient the brain is. The past years hold about 1 GB of documents, which would take about 2 GB inside the brain (working copy plus git history) for material that is rarely reopened. Any past subject can be copied in later when it needs full-text search.

## 2026-09-15 — Notes in English, assignment outputs in the language asked
Decision: Notes are written in English even when the source is Tagalog or Taglish, keeping Filipino terms with a short gloss. Work produced for an assignment, such as the GE09 reflection, is written in the language the assignment requires and filed as its own note.
Because: The embedding model, bge-small-en-v1.5, is English-only, so notes in Tagalog would only be reachable through keyword search.

## 2026-09-15 — Web UI opens files in the browser, the default app, or File Explorer
Decision: Every file a note mentions gets View (in a browser tab, for PDFs, images, audio, video, and text), Open (in its default Windows app), and Show in folder (File Explorer with the file selected). Files outside the brain qualify only when a note mentions their absolute path in an inline code span. Open refuses programs and scripts (exe, bat, ps1, lnk, and anything not on a list of document, media, and archive types); Show in folder works on any allowed path. Every API request must come from localhost: a foreign Host or Origin, or a cross-site fetch, is refused, and the server listens on 127.0.0.1 only.
Because: The owner wants to open college and Fields documents straight from their notes. An endpoint that launches files is reachable by any web page the browser visits and, before this change, by anyone on the same Wi-Fi, so it opens only what the brain already points at and never runs a program.
Supersedes: nothing; the web UI stays read-only for notes.

## 2026-09-15 — Breadcrumbs follow the hub chain
Decision: Every page except Home shows breadcrumbs above its title. On a note they list the hubs from the root down to the hub that lists the note (Home › College › GE09 Life and Works of Rizal), found by the shortest chain of hub links from `index`; the current page is not repeated because its title sits right below. A note no hub reaches falls back to Home › Tags › its first tag. Other pages show Home, and the Tag page Home › Tags.
Because: The owner asked for breadcrumbs for easier navigation. Notes sit in one flat folder, so hubs are the only hierarchy there is, and conventions already put every note in exactly one hub.

## 2026-09-15 — Alt+K focuses search
Decision: Alt+K moves focus to the search field from anywhere in the web UI, including while typing in another field. On the Search page it focuses that page's search box; elsewhere, the top bar's. The field shows the shortcut as two small keys, Alt and K, while it is empty and unfocused, and only on devices with a mouse or keyboard.
Because: The owner asked for an Alt shortcut shown inside the search bar. Ctrl+K is taken by the browser's address bar search, and Alt+D, Alt+E, Alt+F (Chrome and Edge) and Alt+S (Firefox) are taken by browser menus and the address bar.

## 2026-09-15 — Summaries are at most 240 characters
Decision: A note's summary is one sentence of at most 240 characters that names the one or two facts the note is about. The server rejects a longer summary on write; existing longer ones still read. Lists of values move to the body.
Because: The owner found notes hard to read: the web view shows the summary first, and summaries had grown into crammed run-on sentences (median 345 characters, 115 of 143 over 280). Shorter summaries also cost agents less context in search results and note lists.
Supersedes: 2026-09-13 — Frontmatter field set (adds a length limit to `summary`; the field set is unchanged).

## 2026-09-15 — Notes use tables, mermaid diagrams, and callouts
Decision: Notes may hold GFM tables (at most 5 columns, the first naming the row), fenced `mermaid` diagrams (timeline, flowchart, sequenceDiagram, gantt, pie), and GitHub alert callouts (`> [!NOTE]` and its siblings). The web view renders diagrams as figures and callouts as notices; the markdown stays plain text. A diagram never holds a fact the rest of the note does not.
Because: The owner wants the agent to store notes as tables and figures while keeping them human readable. INTENT.md requires notes to stay readable as plain markdown in any editor and never need the app to make sense, so a figure is an extra view of facts that are also written out.

## 2026-09-15 — Pagination defaults
Decision: `GET /api/notes` returns `{items, total, limit, offset}` with 100 per page (at most 500). `GET /api/tags` carries a count per tag. Search returns `hasMore`. MCP `list_notes` shows 50 per page with a footer naming the next offset; MCP `search` defaults to 10 results (at most 100). The web Search page shows 20 and re-queries with 20 more per "Show more" up to 100; the Tag page appends 50 at a time.
Because: The owner asked for pagination where needed. Measured on 143 notes: the full note list is 81 KB and 59,000 characters (about 15k tokens) in an agent's context, MCP search at 20 results puts 28k characters in context while top-5 recall is already 0.90 to 0.97, and the web asked for 50 results that always came back full. Search re-queries with a larger limit instead of an offset so ranking stays consistent between pages.

## 2026-09-15 — Keyword search drops stop words; semantic search has a floor
Decision: Keyword search removes English and common Tagalog function words before both its AND and OR steps (falling back to the original words when nothing is left). Semantic candidates below cosine similarity 0.55 are dropped, in semantic mode and before hybrid fusion. Hybrid fusion weights stay as they are until a fix is checked against queries it was not tuned on.
Because: On 29 labelled queries, hybrid ranked the right note first 55% of the time and semantic alone 69%; "when is the prelim exam this semester" matched the wrong note on "is" and "the". Dropping stop words raised hybrid MRR from 0.70 to 0.77, and the floor turned 50 results for unanswerable queries into 0 while keeping 97% of correct answers.

## 2026-09-15 — Server listens on both loopback addresses
Decision: The server listens on 127.0.0.1 and ::1, never on a public interface.
Because: Listening on 127.0.0.1 alone made every `localhost` request try ::1 first and lose about 205 ms on Windows (measured: 0.205 s connect before, 0.0004 s after). Both addresses are loopback, so the "only this laptop" rule from the file-opening decision still holds.
Supersedes: 2026-09-15 — Web UI opens files in the browser, the default app, or File Explorer (its "listens on 127.0.0.1 only" clause; loopback-only still holds).

## 2026-09-15 — Web UI meets WCAG AA contrast and bundles Roboto
Decision: Link text uses a darker blue token that reaches 4.5:1 on the grey page and white cards; filled buttons keep #1A73E8. Form control borders use a token that reaches 3:1; hairlines on cards and tables stay #DADCE0. Every interactive control shows one keyboard focus style: a 2px ring with a 2px offset. Roboto (400, 500, 700, 400 italic) ships inside the build from @fontsource, with Segoe UI as fallback. Every page sets its own browser tab title, failed loads offer Try again, and reduced-motion settings turn off animation.
Because: The owner asked to work through the open items; earlier QA measured link text at 4.27:1 and input borders at 1.37:1, found focus rings faint, and left the font undecided. Bundling Roboto keeps Google's look on any machine without a network request, which INTENT.md requires.

## 2026-09-15 — Work on the Strong architecture candidates
Decision: Implement the review's three Strong candidates in order: narrow the Brain interface and test through the real BrainImpl over a temp-dir store (candidate 2), move the note link graph (links, hub trail, mentioned file paths) behind Brain in core (candidate 1), and derive REST parsing, core types, and MCP tool inputs from one contract schema module (candidate 3, server side). The web's copy of the contract types and the two "Worth exploring" candidates wait.
Because: The owner chose the Strong recommendations. Order follows dependency: real-Brain tests make the other two refactors verifiable, and the link graph change reshapes the note contract that the schema module then captures.

## 2026-09-15 — The note graph lives in the index, parsed one way
Decision: Links, mentions, and hub listings are read from each note body by one parser whose idea of code matches the web view (a `[[slug]]` or path inside any code span or fenced block is neither a link nor a mention), and stored in the index on every write and reindex. Backlinks, trails, hub-membership checks, and the open-file allowlist all read from there. A note edited by hand outside the tools changes its links, trail, and which files it may open only after a reindex.
Because: The review found four parsers disagreeing (buttons the server then refused, `[[x]]` inside `~~~` counted as a link) and every note view and file open rereading all notes (89 ms and 127 ms at 143 notes). The index already held backlinks. The alternative, reading notes from disk on each request, keeps hand edits instant but grows with the brain; the agent writes through the tools, so hand edits are rare, and a stale allowlist can only lag, never let a program run.

## 2026-09-15 — What counts as a link, a mention, and a hub listing
Decision: A link is `[[slug]]` or `[[slug|label]]` inside one run of plain text in the markdown tree, so not in code, not inside a markdown link's text, and not split by other markup; in a table cell the label pipe is written `\|`. A mention is an inline code span, with any number of backticks and outside a markdown link, whose whole text is a drive-letter path that a request for that path would pass (no UNC or device path, no colon after the drive letter, no `..`, none of `" < > | ? *`). check_links reports hub membership for notes of type `note` only: hubs, the root hub included, and sources are never reported, and a link from any hub, `index` included, counts as a listing.
Because: The web view renders from the same syntax tree, so what the server counts is what the owner sees as a link or a button. Checking only type `note` follows garden.md ("every note of type `note` appears in exactly one domain hub"); counting hubs would flag sub-hubs such as GE09, which link back to their parent hub. On the owner's brain (143 notes) the new rule changed no note's links, mentions, buttons, or trail.
