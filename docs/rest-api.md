# REST API contract

> The source of truth is the contract module, `src/core/contract/`: one zod schema per request and response shape below, with the rules its fields follow (`rules.ts`) and the shapes in route order (`schemas.ts`). The REST server parses requests with those schemas, the MCP tools build their inputs from them, and `src/core/types.ts` infers its types from them. This page explains them in words. Where the two disagree, the schemas win and this page is wrong. `test/api.test.ts` checks that every route has a row in the table below and that every JSON response fits its schema.

Base: `http://localhost:${PORT}`. The server listens on the loopback addresses 127.0.0.1 and ::1 only. JSON in, JSON out unless noted. Type names such as `NoteSummary` are the types `src/core/types.ts` infers from the schemas (`noteSummarySchema`).

Every mutating request may send `X-Brain-Tool: <name>` (default `api`). It becomes the `WriteMeta.tool` in the git commit message.

Errors: status from `BrainError.status` (400 validation, 403 forbidden, 404 not_found, 409 conflict, 415 unsupported_media_type, 416 range_not_satisfiable, 422 invalid_note for a note file on disk that does not parse, and for PDF exports 500 export_failed, 503 pdf_unavailable, 504 export_timeout), 500 otherwise (`io`, `git`, or `internal`). 409 `conflict` comes only from `expectedMtimeMs` (the file changed since it was read, or no longer exists). Name clashes are 400 `validation`: creating a tag that exists, renaming to a taken slug, or taking an inbox item onto a taken slug. Body (`errorEnvelopeSchema`):

```json
{ "error": { "code": "validation", "message": "unknown tags: foo. Create them with createTag first." } }
```

A request that does not fit its schema gets one 400 `validation` message listing every problem, separated by `; `. A message from a contract rule names its field and stands alone (`limit must be an integer from 1 to 500`); any other message gets the field's path in front (`frontmatter.type: Invalid option: expected one of "note"|"hub"|"source"`). Problems the store finds against the brain, such as unknown tags, are reported only once the request fits its schema.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/notes?tag=&type=&sort=&limit=&offset=` | | `NotePage`: `{ items: NoteSummary[], total, limit, offset }`, see [Note lists](#note-lists). |
| POST | `/api/notes` | `WriteNoteInput` | `Note` (201). Slug derived from title if absent. See [Frontmatter validation](#frontmatter-validation). |
| GET | `/api/notes/:slug` | | `Note`, with `links` and `mentions`, see [Links and mentions](#links-and-mentions). |
| PUT | `/api/notes/:slug` | `{ frontmatter, body, expectedMtimeMs? }` | `Note`. Create or replace at this slug, which must match the slug pattern. A `slug` in the body is ignored. |
| DELETE | `/api/notes/:slug` | | 204 |
| POST | `/api/notes/:slug/rename` | `{ newSlug }` | `RenameResult`. `newSlug` must match the slug pattern. |
| GET | `/api/notes/:slug/backlinks` | | `NoteSummary[]` |
| GET | `/api/notes/:slug/trail` | | `NoteTrail`, the hubs above a note or source, see [Trail](#trail). 404 for an unknown slug. |
| GET | `/api/notes/:slug/export.md` | | The note file exactly as stored, `text/markdown`, as an attachment. See [Exports](#exports). |
| GET | `/api/notes/:slug/export.pdf` | | The note printed to an A4 PDF, as an attachment. See [Exports](#exports). |
| GET | `/api/search?q=&limit=&tag=&type=&mode=&files=` | | `SearchPage`: `{ results: SearchResult[], hasMore }`, see [Search results](#search-results). `mode` hybrid/keyword/semantic. `files=false` leaves files out; `true`, absent, or any other value keeps them. |
| GET | `/api/tags` | | `TagWithCount[]`: each `Tag` plus `count`, see [Tag counts](#tag-counts). |
| POST | `/api/tags` | `Tag` | `Tag` (201). `name` must match the slug pattern. |
| GET | `/api/pins` | | `PinnedNotes`: `{ home: NoteSummary[], sidebar: NoteSummary[] }` in pin order, see [Pins](#pins). |
| PUT | `/api/pins/:target` | `{ slug, pinned }` | `PinnedNotes`. `target` is `home` or `sidebar`. Pins to the end or unpins, see [Pins](#pins). |
| PUT | `/api/pins/:target/order` | `{ slugs }` | `PinnedNotes`. `slugs` is every pinned slug in the new order, see [Pins](#pins). |
| GET | `/api/inbox` | | `InboxItem[]` |
| POST | `/api/inbox` | `{ name, content }` | `InboxItem` (201). Used by the web drop box too. |
| POST | `/api/inbox/take` | `{ name, title?, slug?, summary? }` | `InboxTakeResult`. `slug` must match the slug pattern and `summary` fits the [summary limit](#frontmatter-validation). |
| GET | `/api/files` | | `FileEntry[]` |
| GET | `/api/files/*` | | Raw file bytes, see [File responses](#file-responses). Read-only. Path traversal rejected. |
| POST | `/api/open` | `{ path }` | `{ opened: "<absolute path>" }`. Opens a file in its default app or a folder in File Explorer. 403 when the file type is not on the open allowlist. |
| POST | `/api/reveal` | `{ path }` | `{ revealed: "<absolute path>" }`. Opens File Explorer with the file selected, or opens the folder. Any file type. |
| GET | `/api/check-links` | | `LinkReport`, see [Check links](#check-links). |
| GET | `/api/stats` | | `BrainStats`: `{ notes, files, invalid }` |
| POST | `/api/reindex` | | `IndexStats` |
| GET | `/api/conventions` | | `text/markdown`, contents of `conventions/conventions.md` |
| GET | `/api/conventions/:name` | | `text/markdown`. `name` is `conventions`, `file`, or `garden`. 404 otherwise. |
| GET | `/api/health` | | `{ ok: true, brainPath }` |

The web UI lives on the same server under `/` (not `/api`).

## Note lists

`GET /api/notes` returns one page:

```json
{
  "items": [
    {
      "slug": "index",
      "path": "notes/index.md",
      "title": "Index",
      "type": "hub",
      "summary": "Root hub. Lists every domain hub.",
      "tags": [],
      "created": "2026-09-13",
      "updated": "2026-09-15"
    }
  ],
  "total": 143,
  "limit": 1,
  "offset": 0
}
```

- `limit` is an integer from 1 to 500, default 100 (`NOTE_LIST_LIMIT`). `offset` is an integer of 0 or more, default 0 (`OFFSET`). An empty value takes the default. Anything else, such as `limit=0`, `limit=501`, `offset=-1`, or `limit=abc`, gets 400 `validation`, one message naming each bad parameter. `type` must be note, hub, or source; an empty `tag` or `type` is ignored.
- `items` are sorted by title, then by slug when titles are equal, so walking `offset` forward by `limit` visits every note once.
- `sort` changes that order: `title` (the default), or `created` or `updated` for newest first. A date is a day, so notes sharing one fall back to title then slug, and paging stays stable. Anything else gets 400 `validation` (`sort must be one of title, created, updated`). Sorting happens before paging. Home's Recent section asks for `sort=created`.
- `total` counts every note matching `tag` and `type`, not only the ones on this page. `limit` and `offset` echo what was used.
- An `offset` at or past the end gets `"items": []` with the real `total`.
- Invalid files are left out of `items` and `total`; `/api/check-links` reports them.
- The server still reads every note on each request, so paging shrinks the response, not the work. The response shape does not depend on that and stays the same if lists move to the index.

The MCP `list_notes` tool asks for 50 notes at a time and ends its output with the next `offset` while more remain.

## Search results

`GET /api/search` returns:

```json
{
  "results": [
    {
      "kind": "note",
      "id": "ryzen-laptop-specs",
      "path": "notes/ryzen-laptop-specs.md",
      "title": "Ryzen laptop specs",
      "summary": "The laptop has a Ryzen 7 7735HS and an RTX 4050.",
      "snippet": "The CPU is a «Ryzen» 7 7735HS.",
      "score": 0.03,
      "tags": ["hardware"],
      "type": "note"
    }
  ],
  "hasMore": true
}
```

- `q` is required and must hold more than whitespace. `limit` is an integer from 1 to 100, default 20 (`SEARCH_LIMIT`). 400 `validation` otherwise.
- `results` holds at most `limit` results. `hasMore` is true when at least one more result exists past them; the server asks the index for `limit + 1` and drops the extra one.
- `files` is the REST name of the search option `includeFiles`. Every other option keeps its name.

The MCP `search` tool sends `limit` 10 unless the agent gives one. Its inputs are the same schemas, so it refuses what REST refuses (a `limit` over 100, a blank `query`, an unknown `type` or `mode`) before calling the server. It takes `includeFiles` (default true) and sends it as `files`.

## Tag counts

`GET /api/tags` returns every tag in the registry, sorted by name, each with `count`:

```json
[{ "name": "hardware", "description": "Laptops, parts, peripherals.", "count": 3 }]
```

- `count` is the number of valid notes of every type (note, hub, and source) that carry the tag. A tag no note uses has `count: 0`.
- Counts come from one pass over the note list, so the web Tags page needs no `GET /api/notes?tag=` call per tag.

## Pins

A pin is a shortcut the owner keeps to a note, hub, or source on Home or in the sidebar. Pins live in `pins.yml` at the brain root, one ordered list of slugs per target:

```yaml
# The owner's pins on Home and in the sidebar, in order. Set them with set_pin or the web UI; do not edit by hand.
home:
  - fields
  - ryzen-laptop-specs
sidebar:
  - college
```

- A missing file means no pins. The server reads the file loosely: unknown keys are ignored, and a slug listed twice keeps its first place. A file that is not valid YAML, is not a mapping, or has a `home` or `sidebar` that is not a list of slugs reads as no pins, and `/api/check-links` reports it in `invalidNotes` with `path: "pins.yml"`. The next pin that changes a list replaces the file.
- The server writes the file strictly: only `home` and `sidebar`, a slug at most once per list, and at most 50 slugs per list (`PINS_MAX` in `src/core/contract/rules.ts`). Every change is one git commit through the store's write queue, named from `X-Brain-Tool` like every write: `web: pin fields to home`, `web: unpin fields from sidebar`, `web: reorder home pins`. A request that changes nothing makes no commit.
- Renaming a note rewrites its slug in `pins.yml`, and deleting a note removes it from both lists, in the same commit as the rename or delete.
- Pins are read from `pins.yml` and the note files, never the index, so a note deleted by hand drops out of `GET /api/pins` at once.

`GET /api/pins` returns the pinned notes in pin order:

```json
{
  "home": [
    {
      "slug": "fields",
      "path": "notes/fields.md",
      "title": "Fields",
      "type": "hub",
      "summary": "Maps the Fields Group project.",
      "tags": ["fields"],
      "created": "2026-09-14",
      "updated": "2026-09-15"
    }
  ],
  "sidebar": []
}
```

A pinned slug with no note, or whose file does not parse, is left out of the response and stays in `pins.yml`. `/api/check-links` lists it in `missingPins`.

`PUT /api/pins/:target` with `{ "slug": "fields", "pinned": true }`:

- `target` is `home` or `sidebar`; anything else is 400 `validation` (`target must be one of home, sidebar`). A `target` in the body is ignored. `slug` must match the slug pattern and `pinned` must be a boolean, or 400.
- `pinned: true` appends the slug to the end of the list. A slug already pinned keeps its place. 404 `not_found` when no note has the slug. 400 `validation` when the list already holds 50: `home already holds 50 pins, the most it can hold. Unpin one first.`
- `pinned: false` removes the slug. Unpinning a slug that is not pinned is a 200 no-op. A pin whose note is gone is cleared this way.
- Returns 200 with the whole `PinnedNotes` after the change.

`PUT /api/pins/:target/order` with `{ "slugs": ["ryzen-laptop-specs", "fields"] }`:

- `slugs` must hold every slug pinned to that target, each once, in the new order. A pinned slug whose note is gone may be left out, since `GET /api/pins` never showed it; it moves to the end of the list. Anything else is 400 `validation` naming each missing, unpinned, and repeated slug: `slugs must hold every slug pinned to home, each once (missing: fields)`.
- Returns 200 with the whole `PinnedNotes` after the change.

Both PUT routes need `Content-Type: application/json` (415 otherwise) and pass the [request guard](#request-guard). The MCP tools `list_pins` and `set_pin` use `GET /api/pins` and `PUT /api/pins/:target`; only the web UI reorders.

## Frontmatter validation

Writes are strict and reads are loose. `POST /api/notes` and `PUT /api/notes/:slug` answer 400 `validation` when `title` or `summary` is empty, `type` is not note, hub, or source, the slug does not match the slug pattern, `summary` is over the limit below, a tag is not in the registry, `created` or `updated` is not YYYY-MM-DD, a `sources` entry is not a slug, or a `files` entry does not start with `files/`. `frontmatter` accepts no other fields.

The checks run in two passes, and each pass puts every problem it finds in one message. First the request is parsed with `writeNoteInputSchema`: field types, `type`, the slug pattern, and the summary limit. Then the store checks the rest against the brain, and checks the slug and summary again for callers that do not come through REST. A request that fails the first pass never reaches the second, so a too-long summary and an unknown tag in the same request are reported one after the other.

The slug pattern is `^[a-z0-9]+(-[a-z0-9]+)*$` (`SLUG_RE` in `src/core/contract/rules.ts`): lowercase letters and digits joined by single hyphens. Tag names follow it too.

`summary` may be at most 240 characters (`SUMMARY_MAX_CHARS` in `src/core/contract/rules.ts`), counted as code points after trimming, so an emoji is one character. The same limit applies to `summary` in `POST /api/inbox/take`. The message gives the actual length:

```json
{ "error": { "code": "validation", "message": "summary must be at most 240 characters (got 312). Name the one or two facts the note is about and leave lists of values to the body." } }
```

A file already on disk with a longer summary still reads, lists, indexes, and searches, and `/api/check-links` does not report it.

## Links and mentions

`GET /api/notes/:slug` reads the note file from disk and parses its body once (`parseNoteBody` in `src/core/graph/note-body.ts`). The parser builds the same markdown syntax tree with GFM that the web view renders, so code means what the owner sees as code: inline code with any number of backticks, fenced blocks with ```` ``` ```` or `~~~`, and indented blocks.

- `links`: targets of `[[slug]]` and `[[slug|label]]` written in plain text, trimmed, deduplicated, in order of first appearance. Nothing inside code or inside a markdown link's text counts, nor a link that other markup splits (`[[slug|*label*]]`). In a table cell, write the label pipe as `\|`, or GFM splits the cell there.
- `mentions`: inline code spans, outside a markdown link, whose whole text is a drive-letter absolute path that [Paths](#paths) would accept as a request (no UNC or device path, no colon after the drive letter, no `..` segment, none of `" < > | ? *`). Exactly as written, deduplicated, in body order. The web view gives exactly these spans Open and Show in folder.

```json
{ "slug": "ethics", "links": ["ge09-life-and-works-of-rizal"], "mentions": ["C:\\Important Files\\College Files\\Module 1.pdf"] }
```

Every write, rename, delete, inbox take, and reindex stores the links and mentions in the index. Backlinks, trails, [Check links](#check-links) hub membership, and the [Paths](#paths) allowlist read them from there, never from the note files. A note edited by hand outside the tools changes them only after `POST /api/reindex`. Renaming a note rewrites only what `links` would list, so `[[old-slug]]` inside code stays as written.

## Trail

`GET /api/notes/:slug/trail` answers where a note sits in the hub tree, for breadcrumbs:

```json
{
  "trail": [
    { "slug": "index", "title": "Index" },
    { "slug": "college", "title": "College" },
    { "slug": "ge09-life-and-works-of-rizal", "title": "GE09 Life and Works of Rizal" }
  ],
  "inHub": true
}
```

- `trail` runs from the root hub `index` down to the hub that links directly to the note, root first. It never includes the note itself.
- The answer is a breadth-first search from `index` that follows links in hub bodies only. Links in other notes are never followed, and links to slugs that do not exist are ignored.
- When several hubs list the note, the shortest chain wins. On a tie, the hub whose link comes first wins: hubs are visited in the order their links appear, level by level. Hubs that link each other do not loop.
- The server reads no note files for it. It walks up from the note through the links in the index, one lookup per level of hubs above the note, so the cost does not grow with the number of notes. A hand edit shows up after `POST /api/reindex`.
- `index` itself gets `{ "trail": [], "inHub": true }`.
- A note no chain of hubs reaches, or any note when `index` does not exist, gets `{ "trail": [], "inHub": false }`.
- Works the same for sources. 404 `not_found` when the index holds no note with that slug.

## Exports

`GET /api/notes/:slug/export.md` sends the note file's bytes exactly as stored, frontmatter included, for notes, hubs, and sources:

- `Content-Type: text/markdown; charset=utf-8`
- `Content-Disposition: attachment; filename="<slug>.md"`
- 404 `not_found` for an unknown slug, 422 `invalid_note` for a file that does not parse.

`GET /api/notes/:slug/export.pdf` sends the note as an A4 PDF:

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded name>`, the same RFC 5987 form as [File responses](#file-responses).
- The name is the note's title with whitespace collapsed to single spaces, without the characters Windows forbids in file names (`\ / : * ? " < > |` and control characters), cut to 120 characters (`EXPORT_NAME_MAX_CHARS`), then `.pdf` (`pdfExportFileName` in `src/core/contract/rules.ts`). A title with nothing left uses the slug. The ASCII fallback replaces every character outside printable ASCII with `_`. A note titled `Prelims: when? Week 7` downloads as `Prelims when Week 7.pdf`.

The server makes the PDF from the web UI's print page (`src/api/pdf-export.ts`):

1. It starts the installed Microsoft Edge, headless, through `playwright-core`, with a page 1024 px wide.
2. It opens `http://127.0.0.1:<port>/print/notes/<slug>` on the port this server listens on.
3. It waits until the page sets `data-print-ready` on its root element: `"true"` once the note and all its diagrams have rendered, `"error"` if they failed.
4. It prints A4 with backgrounds, margins 18 mm top, 20 mm bottom, and 16 mm left and right, and a small grey footer with the note title on the left and "page X of Y" on the right.
5. It closes the browser, whatever happened.

One export runs at a time; a second request waits until the first has closed its browser. The print page's own API calls come from `127.0.0.1` on the same port, so they pass the [request guard](#request-guard).

| Status | `error.code` | When |
|---|---|---|
| 404 | `not_found` | No note has the slug. |
| 422 | `invalid_note` | The note file does not parse. |
| 500 | `export_failed` | The print page set `data-print-ready="error"`. The message carries its `data-print-error`. |
| 503 | `pdf_unavailable` | Edge could not be started: not installed, or the launch failed. The message says to use the browser's print dialog instead, which the web UI falls back to. |
| 504 | `export_timeout` | The export took more than 30 s, counted from when its turn came. The browser is closed and the next export can start. |

## Check links

`GET /api/check-links` returns a `LinkReport`:

```json
{
  "brokenLinks": [{ "from": "dangling", "to": "nowhere" }],
  "missingFiles": [{ "from": "dangling", "file": "files/missing.pdf" }],
  "missingSources": [{ "from": "dangling", "source": "gone" }],
  "invalidNotes": [{ "path": "notes/junk.md", "error": "frontmatter block is missing" }],
  "missingPins": ["old-schedule"],
  "notesWithoutHub": [{ "slug": "dangling" }],
  "notesInSeveralHubs": [{ "slug": "rizal-day", "hubs": ["college", "ge09-life-and-works-of-rizal"] }]
}
```

- `brokenLinks`, `missingFiles`, `missingSources`, and `invalidNotes` come from reading every note file.
- `missingPins` lists the slugs `pins.yml` pins, to either target, that have no valid note, each once, sorted by slug. They come from a hand edit, such as a note file deleted outside the tools. A malformed `pins.yml` appears in `invalidNotes` instead, see [Pins](#pins).
- `notesWithoutHub` and `notesInSeveralHubs` come from the index. A hub lists a note when the hub's body links to it (`links` above); the root hub `index` counts as a hub.
- Only notes of type `note` are checked, because conventions put every note in exactly one domain hub and have `index` list the hubs. Hubs, including `index` and sub-hubs that link back to their parent, and sources are never reported.
- Both lists are sorted by slug, and each entry's `hubs` too.

## Request guard

Every `/api/*` request passes one check before its route runs, because any web page can make the browser send requests to localhost, and DNS rebinding can point another hostname at 127.0.0.1.

- 403 `forbidden` when the `Host` header's hostname is not `localhost`, `127.0.0.1`, or `[::1]` (port ignored). With no `Host` header the request URL's hostname is used.
- 403 `forbidden` when `Sec-Fetch-Site` is `cross-site`.
- 403 `forbidden` when an `Origin` header is present and its hostname is not one of those three. `Origin: null` is refused.
- 415 `unsupported_media_type` on `POST /api/open`, `POST /api/reveal`, `PUT /api/pins/:target`, and `PUT /api/pins/:target/order` unless the media type of `Content-Type` is `application/json` (parameters such as `charset` are fine).

The MCP client (Node fetch, no `Origin`), the Vite dev proxy (`Host: localhost:5173`, `Origin: http://localhost:5173`), and headless Edge printing a note (`Host: 127.0.0.1:<port>`, same-origin requests from the print page) pass.

## File responses

`GET /api/files/*` sends:

- `Content-Type` by extension. pdf, png, jpg/jpeg/jfif, gif, webp, bmp, docx, pptx, xlsx, xlsm, mp4/m4v, webm, mov, mkv, mp3, wav, m4a, ogg/oga, flac get their usual types. txt, md, csv, json, log, html, htm, xhtml, and xml are all `text/plain; charset=utf-8`, so nothing in a file runs on this origin. svg is `image/svg+xml` with `Content-Security-Policy: sandbox`. Anything else is `application/octet-stream`.
- `Content-Disposition: inline; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded name>`.
- `X-Content-Type-Options: nosniff`, `Accept-Ranges: bytes`, `Cache-Control: no-cache`.

A single `Range: bytes=a-b`, `bytes=a-`, or `bytes=-n` gets 206 with `Content-Range: bytes start-end/size`. A range starting at or past the end, or `bytes=-0`, gets 416 with `Content-Range: bytes */size`. Several ranges, `b < a`, or any other shape is ignored and the whole file is sent with 200.

## Paths

`path` in `/api/open` and `/api/reveal` is either brain-relative (`files/...`, either slash) or absolute. The server decides what is allowed; the UI only asks.

400 `validation` (malformed):

- Empty, or relative without a leading `files/`.
- Not a drive-letter path: absolute paths must be `C:\...` or `C:/...`. `C:file` and `\dir\file` are refused.
- UNC paths (`\\server\share`, `//server/share`), which would send the owner's NTLM credentials to a remote host, and device paths (`\\?\`, `\\.\`).
- Any `:` after the drive letter (alternate data streams).
- Any `..` segment.
- Characters Windows does not allow in file names: `" < > | ? *` and control characters.

403 `forbidden` unless the path is one of:

- A brain-relative `files/...` path.
- An absolute path inside the brain root.
- An absolute path that equals, ignoring case, slash style, and a trailing separator, a path some note mentions, e.g. `` `C:\Important Files\College Files\Module 1.pdf` `` (see [Links and mentions](#links-and-mentions) for what counts). Any number of backticks counts; code blocks, a path inside a markdown link, and plain text do not. A mentioned folder does not allow the files inside it. The check is one lookup in the index and never rereads the notes.

Nothing whose real location is inside the brain's `.git` is allowed, however it is spelled (junction, symlink, or 8.3 short name).

404 `not_found` when the path does not exist or is neither a file nor a folder.

`POST /api/open` only opens files with these extensions (case-insensitive): pdf doc docx odt rtf txt md csv ppt pptx odp xls xlsx xlsm ods png jpg jpeg jfif gif webp bmp svg mp4 m4v mov mkv avi webm wmv mp3 wav m4a ogg oga flac zip. Folders are always allowed. Every other file, including exe, bat, cmd, ps1, lnk, url, msi, a file with no extension, or a name ending in a dot or space, gets 403. `POST /api/reveal` has no type restriction.
