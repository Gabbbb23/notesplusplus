# Skill: file this material

Use this when the owner hands you raw material in conversation or says "process the inbox". Read `brain://conventions` first if you have not this session. Do not ask for confirmation at any step; every write is a git commit and can be undone.

## Procedure

1. **`inbox_list`.** Note every item. If the owner gave you material in conversation instead of the inbox, skip to step 3 and treat their message as the source: call `write_note` with `type: source`, the material verbatim as the body, and a summary.

2. **`inbox_take` each item.** Give it a real title, not the filename: "Interview with Dr. Cruz on sleep and shift work, 2026-08-30", not "transcript3.txt". Give it a one-line summary saying what the material is and where it came from. The tool returns the new source note's slug and full contents; a non-text item goes to `files/` instead and you attach it to a note via `files:`.

3. **Read the source.** The whole thing. List the distinct topics it touches; each becomes a candidate note.

4. **`search` for each topic.** Use specific terms from the material. For each hit that covers the same topic, decide: update that note, or write a new one that links to it. Prefer updating when the fact belongs to an existing claim; prefer a new note when it is a new claim.

5. **Write or update notes.** For each topic, `write_note` with:
   - `type: note`, a title that is a claim or a noun phrase, a one-sentence summary that contains the fact.
   - `sources: [<source slug>]` and a `[[<source slug>]]` link in a `## Related` section.
   - Wikilinks to the related notes you found in step 4. Add a backlink from the existing note when the relation matters both ways (`get_note` it, append to its Related section, `write_note` with the `expectedMtimeMs` you got).
   - Tags from `list_tags`. Create a tag only when the material opens a broad category the registry lacks; describe it in one line.
   - A body that leads with the fact and names dates, numbers, names, versions.

6. **Update hubs.** Add each new note to its domain hub with one line. If there is no hub for that domain, write one (`type: hub`) and add it to `index`.

7. **`check_links`.** Fix everything it reports before you finish.

8. **Report** to the owner in a few lines: which sources were taken, which notes were created, which were updated, and anything you could not place or found contradictory. Include slugs so the owner can look.

## A file the owner added to a tracked folder

When the owner says they added a file, or asks what has not been filed yet, run `npm run unfiled` in the app repo. It lists the documents in their tracked folders that no note records, newest first, so the file they mean is usually the first line (`-- --all` includes images and video, `-- --limit 0` drops the cut-off). Read it with `npx tsx src/cli/extract.ts "<path>"`; if nothing comes out, say the file is image-only rather than guessing at its contents. Then file it through the procedure above, and record the file itself in one of these two ways, or the next scan lists it again:

- **Mention it.** Write its full path as inline code in the note that covers it. This is enough on its own, and it gives the owner Open and Show in folder buttons on that note.
- **Copy it in.** Put a copy under `files/`, in the folder the brain already uses for that domain, and list the copy in the note's `files:`. Do this when the file should live inside the brain's history; a mention leaves it where it is.

Naming the file in prose does not record it. `Short Reflection Vinculado.pdf` in a sentence says nothing about which file on disk it is.

## Video and audio transcripts

Extract claims and facts. Drop filler, greetings, sponsor reads, and repeated points. Keep who said what when the speaker matters ("Dr. Cruz says shift workers should keep a fixed wake time"); drop attribution when it is the presenter restating common knowledge. Keep timestamps only if the source has them and a reader would use them to jump back to the video; write them as `[12:34]` after the claim. A one-hour transcript usually yields three to eight notes, not one.

## Material the owner wrote

The owner's own text carries opinions and decisions. Preserve their wording for those; do not paraphrase a decision into something softer or broader. Mark them as the owner's view in the body: "Owner's decision (2026-09-13): ..." or "The owner thinks ...". Facts the owner states about the world can be reworded like any other source. Still create a source note first so the original wording survives.

## Do not

- File a whole transcript as one note. Split by topic.
- Put a fact in a note without listing the source in `sources`.
- Guess at a tag. Check `list_tags`.
