# notes++

A second brain that an AI agent writes and the owner reads: small linked notes about the owner's domains, kept as plain markdown so both people and agents can find a specific fact later.

## People

**Owner**:
The one person the brain belongs to, who supplies raw material and reads the notes.
_Avoid_: user, customer

**Agent**:
The AI (Claude Code, Codex) that files material into notes and keeps them tidy; the only writer.
_Avoid_: bot, assistant

## The brain and what it holds

**Brain**:
The owner's collection of notes, sources, files, and inbox, kept with its full history.
_Avoid_: vault, database, repo

**Domain**:
A broad area of the owner's life with its own tag and hub, such as Fields or College.
_Avoid_: project, category, space

**Note**:
One markdown document about one topic, with a title, summary, tags, and dates.
_Avoid_: page, document, entry

**Hub**:
A note that maps one domain by listing its notes, one line each.
_Avoid_: index page, category page, table of contents

**Root hub**:
The hub named `index` that lists every domain hub; the starting point of every trail.
_Avoid_: home note, main index

**Source**:
Raw material (a transcript, pasted text) kept word for word, from which notes are derived.
_Avoid_: raw note, original

**File**:
A document stored inside the brain (PDF, Word, slides, spreadsheet) that notes list as an attachment.
_Avoid_: asset, upload, attachment file

**Inbox item**:
Material the owner dropped for the agent that has not been filed yet.
_Avoid_: draft, pending note

**Summary**:
The one sentence at the top of a note that names the facts it holds, for a reader deciding whether to open it.
_Avoid_: description, excerpt, abstract

**Tag**:
A label that places a note in a domain; a note usually has one.
_Avoid_: category, label

**Slug**:
A note's unique, lowercase, hyphenated name, used in links.
_Avoid_: id, filename, key

**Pin**:
A shortcut the owner keeps to a note, hub, or source on Home or in the sidebar.
_Avoid_: favorite, bookmark, star

## How notes relate

**Link**:
A `[[slug]]` reference from one note to another, written in the note's text, not inside code.
_Avoid_: reference, wikilink (in prose)

**Backlink**:
A link seen from the note it points at: the notes that link here.
_Avoid_: inbound reference, citation

**Mention**:
A full path to a document on the owner's laptop, written as inline code in a note, which the owner may open or show in its folder from that note.
_Avoid_: file link, path reference

**Trail**:
The chain of hubs from the root hub down to the hub that lists a note.
_Avoid_: breadcrumb (the web view's rendering of a trail), path, ancestry

**Note graph**:
The links, mentions, and hub listings among all notes, taken together.
_Avoid_: link table, knowledge graph

## Keeping it findable

**Index**:
The search cache rebuilt from the brain; never the source of truth.
_Avoid_: database, store

**Filing**:
Turning raw material or inbox items into sources and small linked notes.
_Avoid_: importing, ingesting

**Gardening**:
Tidying existing notes: merging duplicates, fixing links, keeping hubs current.
_Avoid_: cleanup, maintenance
