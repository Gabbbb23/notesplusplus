# REST API contract

Base: `http://localhost:${PORT}`. JSON in, JSON out unless noted. Types refer to `src/core/types.ts`.

Every mutating request may send `X-Brain-Tool: <name>` (default `api`). It becomes the `WriteMeta.tool` in the git commit message.

Errors: status from `BrainError.status` (400 validation, 404 not found, 409 conflict), 500 otherwise. Body:

```json
{ "error": { "code": "validation", "message": "unknown tags: foo" } }
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/notes?tag=&type=` | | `NoteSummary[]` |
| POST | `/api/notes` | `WriteNoteInput` | `Note` (201). Slug derived from title if absent. |
| GET | `/api/notes/:slug` | | `Note` |
| PUT | `/api/notes/:slug` | `{ frontmatter, body, expectedMtimeMs? }` | `Note`. Create or replace at this slug. |
| DELETE | `/api/notes/:slug` | | 204 |
| POST | `/api/notes/:slug/rename` | `{ newSlug }` | `RenameResult` |
| GET | `/api/notes/:slug/backlinks` | | `NoteSummary[]` |
| GET | `/api/search?q=&limit=&tag=&type=&mode=&files=` | | `SearchResult[]`. `mode` hybrid/keyword/semantic, `files` true/false. |
| GET | `/api/tags` | | `Tag[]` |
| POST | `/api/tags` | `Tag` | `Tag` (201) |
| GET | `/api/inbox` | | `InboxItem[]` |
| POST | `/api/inbox` | `{ name, content }` | `InboxItem` (201). Used by the web drop box too. |
| POST | `/api/inbox/take` | `{ name, title?, slug?, summary? }` | `InboxTakeResult` |
| GET | `/api/files` | | `FileEntry[]` |
| GET | `/api/files/*` | | Raw file bytes with a content type. Read-only. Path traversal rejected. |
| GET | `/api/check-links` | | `LinkReport` |
| GET | `/api/stats` | | `{ notes, files, invalid }` |
| POST | `/api/reindex` | | `IndexStats` |
| GET | `/api/conventions` | | `text/markdown`, contents of `conventions/conventions.md` |
| GET | `/api/conventions/:name` | | `text/markdown`. `name` is `conventions`, `file`, or `garden`. 404 otherwise. |
| GET | `/api/health` | | `{ ok: true, brainPath }` |

The web UI lives on the same server under `/` (not `/api`).
