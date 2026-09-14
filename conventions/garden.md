# Skill: garden the store

Use this when the owner says "garden", "tidy up", or "clean the brain". Read `brain://conventions` first if you have not this session. Work without asking; every change is a commit.

## Procedure

1. **`check_links`.** Fix every entry:
   - Broken link: `search` for the intended note. Retarget the link to the right slug, or remove the link if nothing matches.
   - Missing file: check the `files/` listing for a moved or renamed file, fix the path in `files:`, or drop the entry.
   - Missing source: find the source's real slug and fix `sources:`; if the source is gone, remove the entry and say so in the report.
   - Invalid note: `get_note` it, read the error, rewrite it with valid frontmatter (all required fields, tags from `list_tags`).

2. **Find duplicates.** Open `index`, then each hub. For every note listed, `search` by its title and again by its summary. Two notes that make the same claim get merged: keep the note with the better slug as the survivor, fold the other's body and `sources` into it with `write_note`, check the other's `backlinks` and point those links at the survivor, then `delete_note` the other. When the better slug belongs to the note you are deleting, `rename_note` the survivor onto it afterwards; the rename rewrites links for you.

3. **Find orphans.** For each note in `list_notes`, run `backlinks`. A note with none is an orphan. Link it from its domain hub and, when there is a related note, from that note's Related section.

4. **Refresh hubs.** Every note of type `note` appears in exactly one domain hub with a current one-line description. Remove lines for deleted notes, add lines for missing ones, move a note that sits in two hubs to the one that fits. `index` lists every hub and nothing else.

5. **Tighten summaries.** Any summary that describes instead of answers ("notes about the laptop") gets rewritten to carry the fact. Open the note, rewrite the summary, `write_note` with `expectedMtimeMs`.

6. **`check_links` again.** It should report "No problems."

7. **Report** in a few lines: links fixed, notes merged (slugs), orphans linked, hubs changed, summaries rewritten. Name anything you left alone because it was ambiguous.

## Limits

- Never change a source body. Only its summary.
- Do not merge two notes because they share a tag; merge only when they make the same claim.
- Do not create tags during gardening unless a hub has no fitting tag at all.
