# Brain conventions

The brain is the owner's second brain: a folder of markdown notes that you, the agent, write and maintain. The owner hands you raw material; you file it as small linked notes so that later, when the owner asks a question, you can find the specific fact without reading everything.

## Layout

```
notes/<slug>.md      type: note | hub. notes/index.md is the root hub.
sources/<slug>.md    type: source. Raw material kept verbatim under a frontmatter header.
files/**             attachments (pdf, docx, pptx, xlsx, images). Referenced from notes via `files:`.
inbox/**             material the owner dropped for you. Empty it with the `file` prompt.
tags.yml             the tag registry. Every tag a note uses must be listed here.
```

Slugs are unique across `notes/` and `sources/`. One slug, one file.

## Frontmatter

Every note starts with this block. All fields are required except `sources` and `files`. The server rejects a write that misses a field or uses a tag not in `tags.yml`.

```yaml
---
title: Ryzen 7 7735HS laptop specs
type: note
summary: The owner's laptop has a Ryzen 7 7735HS, 16 GB RAM, and an RTX 4050, bought March 2026.
tags: [hardware]
created: 2026-09-13
updated: 2026-09-13
sources: [laptop-purchase-transcript]   # optional: slugs of source notes this was derived from
files: [files/laptop-invoice.pdf]       # optional: brain-relative paths
---
```

`write_note` sets `created` and `updated` for you. Do not add fields beyond these eight.

## Slugs

Lowercase `a-z0-9`, words separated by single hyphens: `ryzen-laptop-specs`, not `Ryzen_Laptop`. `write_note` derives the slug from the title when you omit it. Rename with `rename_note`; it rewrites every wikilink and `sources` entry that pointed at the old slug.

## Wikilinks

`[[slug]]` or `[[slug|label]]`. The target must be an existing slug in `notes/` or `sources/`. A link to a slug that does not exist shows up in `check_links` as broken. Search before linking if you are unsure a note exists.

## The three note types

**note**: one topic, atomic. The title is a claim or a noun phrase: "Vitest runs test files serially by default" or "Ryzen 7 7735HS laptop specs". If you are writing "and" into a title, it is two notes.

**hub**: a map of one domain. It lists the domain's notes as wikilinks with one line each and nothing else of substance. The root hub `index` lists the hubs. A reader opens `index`, picks a hub, picks a note. Hubs are the table of contents; keep them current.

**source**: raw material, verbatim. Created by `inbox_take`. Never edit a source body. The only part of a source you may touch is its frontmatter `summary`.

Every note derived from a source lists the source slug in `sources` and links to it in the body, so a future reader can re-read the original when your summary is not enough.

## Summaries

One sentence, written for a future agent deciding whether to open the note. Put the answer in it, not a description of the answer.

Vague: "Notes about the laptop."
Good: "The owner's laptop is a Ryzen 7 7735HS with 16 GB RAM and an RTX 4050, bought March 2026."

## Tags

Tags are few and broad: `hardware`, `health`, `work`, `recipes`. They group whole domains, not topics; topics are handled by hubs and links. Run `list_tags` before tagging and reuse what exists. Create a tag with `create_tag` only when a new broad category appears, and give it a description that says what belongs in it. A note usually carries one tag, sometimes two.

## Writing a note that search will find

- Lead with the fact. First sentence of the body answers the title.
- Keep it self-contained. A reader who lands on it from search must not need another note to understand it.
- Name specific things: dates, numbers, names, versions, prices, file names. "Upgraded to Node 24 on 2026-09-01" beats "recently upgraded Node".
- Several small notes beat one long one. Search returns notes; a long note buries the fact in the snippet.
- In tables, give every column a unique header that names its unit: "Pilot US$/month", not a second "Pilot". On narrow screens the web view shows each row as label and value pairs, and repeated headers make the labels ambiguous.
- End with a `## Related` section holding wikilinks to neighbouring notes and to the source.

Example body:

```markdown
The owner's laptop is a Ryzen 7 7735HS with 16 GB RAM and an RTX 4050. Bought March 2026 for 62,000 PHP.

It runs the brain's embedding model in-process without trouble; see [[local-embeddings-choice]].

## Related
- [[hardware]] hub
- [[laptop-purchase-transcript]] source
```

## Hub maintenance

When you add a note, add a line for it to its domain hub. When you rename one, `rename_note` fixes the link but check the hub's one-liner still reads right. When a note belongs to a domain that has no hub, create the hub (type `hub`, tagged with the domain tag) and add it to `index`. Every note should appear in exactly one hub.

## Control

You have full write control. Do not ask the owner for confirmation before writing, renaming, merging, or deleting. Every write is one git commit in the brain repo, so any mistake is reversible with git.

## Finding things

1. `search` with a specific query. Read the summaries in the result list.
2. Open only the few notes whose summaries match, with `get_note`.
3. Follow wikilinks in the `Related` section for neighbours.
4. Run `backlinks` on the note to see what refers to it; that is often where the surrounding context lives.

If search returns nothing useful, open the domain hub from `index` and scan its one-liners.

## Don'ts

- Do not write to the brain folder directly when the MCP tools are available. The tools validate, index, and commit; a direct write does none of that.
- Do not leave broken links. Run `check_links` after a filing or tidying session.
- Do not duplicate. Search before creating a note; update the existing one instead.
- Do not put several topics in one note. Split it.
- Do not rewrite a source body. Fix its summary if needed; leave the material as it arrived.
