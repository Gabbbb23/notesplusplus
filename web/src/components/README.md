# Shared components

Pages compose these components. They never restyle tables, badges, cards, links, alerts, headings, metadata, or long text on their own, so a design change made in one of these files reaches every page that uses it. `test/architecture.test.ts` makes `npm test` fail when code under `src` (outside `ui/`) breaks one of the rules listed at the end of this file.

The shadcn primitives in `ui/` are the raw material. Only the module named below may import each one. When a primitive's own look should change for everyone, such as the Button default colours, change it in `ui/`.

## data-table.tsx

Every table in the app. It is the only importer of `ui/table` and the only place that renders table markup.

- `DataTable` is what pages use. Give it `columns`, `rows`, and `rowKey`; mark the column that should wrap and take the spare width as `size: "fill"`, and an action column like "Open" as `hideHeader`.
- `ResponsiveTable` with `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell` is the lower level that `note-body.tsx` uses for markdown tables. Reach for it only when the rows are not a plain array.

Tables never scroll sideways. When the columns cannot fit, the table switches to a stacked layout where each row becomes a title plus label and value pairs. `chooseTableLayout` holds the rule: stack when the table is wider than its box, a fill column is narrower than 10rem (`FILL_MIN_REM`), or a text column (a note-table column) is narrower than 6rem (`TEXT_MIN_REM`). Each of those columns gets its minimum as a min-width span in its header. The table goes back only once the box is 24px wider than the width that was needed, so a scrollbar appearing cannot flip it straight back.

Note-table cells also pass through `lib/rehype-table-cell-text.ts`:

- A word with a hyphen ("cross-region", "CU-h") sits in a nowrap span, so it never splits at the hyphen. In stacked layout that span may still wrap if it is wider than the whole cell.
- A symbol followed by a space and a number ("≥ 20", "$ 5") gets a non-breaking space, so the symbol stays with the number. The symbols are ≥ ≤ < > ~ ± $ ₱ € £ #.
- A value longer than 30 characters with no spaces (a URL, a file path) gets the same break points as `BreakableText`, and breaks anywhere as a last resort.

## breakable-text.tsx

`BreakableText` for file paths, slugs, tag names, inbox names, and titles. The break points come from `breakPieces` in `lib/break-points.ts`, which the note-table cell step uses too:

- always after `/ \ _ ? & =`, even between digits (`800164894_1057064503809638_n.png`)
- after `- . , :` unless both neighbours are digits (`2026-09-14`, `11-3-2026`, `12.00`, `1,500`, `17:52` stay whole)
- never before a final file extension (`Accounting-ACT.docx` keeps `ACT.docx` together)

As a last resort the text breaks anywhere.

## text-link.tsx

`TextLink` for every text link: page links, card titles, note metadata, and links inside note bodies. It is the only module that styles a link (`hover:underline`) or draws the external-link icon.

- `to` for an app route, opened in the same tab.
- `href` for a file or site, opened in a new tab with `rel="noopener noreferrer"` and the external-link icon.
- `variant`: `inline` (default, inherits size and weight), `strong` (medium weight), or `title` (card title).
- String children wrap through `BreakableText`.

## badges.tsx

Every pill, and the one way to show a tag name. It is the only importer of `ui/badge`.

- `KindBadge` for note, hub, source, file.
- `TagName` for a tag as text: a muted `#` and the name, wrapping. The Tags table, the Tag page heading, and the Search tag filter use it.
- `TagBadge` and `TagBadges` for `#tag` pill links. A long tag wraps inside its pill and never grows wider than its container.
- `FileTypeBadge` for a file extension.
- `StatusBadge` with a `tone` of neutral, success, warning, or danger, for states and counts.

Colours come from the `--kind-*` and `--status-*` custom properties in `src/index.css`.

## item-card.tsx

Every card, all on one shell (16px padding, 8px radius, hairline border). It is the only importer of `ui/card`.

- `ItemCard` for one thing in a list: a linked title (`to` for an app route, `href` for a new tab), then optional badge, summary, snippet, and meta row.
- `CardList` stacks cards with the standard gap.
- `SectionCard` for a titled block with an optional count, such as a Check section or the Inbox form.
- `StatCard` for a number with a label on Home.
- `LoadingCards` for card-shaped placeholders.

`note-card.tsx` (`NoteCard`, `NoteList`) and `search-results.tsx` (`SearchResultCard`) are built on `ItemCard`.

## meta.tsx

Small muted details about a thing.

- `MetaList` with `MetaItem` (`label`, children) for a label and value grid: the note header's tags, dates, path, sources, and files.
- `MetaRow` for one wrapping line of details: a card's tags and date, the Home hub's tags, date, and "open as note" link.

## page-header.tsx

`PageHeader` goes at the top of every page, Home included, and owns the page's only `h1`. It takes `title`, `description`, `aside` (a count on the right), `badge` (after the title), and children for extra rows such as note metadata. Every page uses the same 24px heading.

## section-heading.tsx

`SectionHeading` for a section title inside a page that is not in a `SectionCard`, such as the note's "Backlinks". Markdown `h2` in a note body renders through it too, so both look the same. It takes children and heading attributes such as `id`, and sets no margins.

## callout.tsx

`Callout` for a highlighted paragraph set off from the text around it: the note summary.

## notice.tsx

`Notice` for every alert box. It is the only importer of `ui/alert`. It takes `tone` (info, success, warning, danger), `title`, children for the explanation, and an optional `icon` to replace the tone's default. It has the card's 16px padding and 8px radius. The Check page's "All clear" is a success notice; Home's "No root hub yet" is an info notice.

## search-input.tsx

`SearchInput` for the search field with its icon, in the top bar (`shape="pill"`) and on the Search page (`shape="box"`). It takes `value`, `onChange`, `label`, `placeholder`, `name`, and `autoFocus`. The form and any button stay with the caller.

## page-state.tsx

- `LoadingBlock` for grey bars while something loads.
- `ErrorAlert` for an API error or the "server not reachable" hint, built on `Notice` with the danger tone.
- `EmptyState` for an empty list.
- `NotFoundState` (`title`, `message`, `value`) for the note 404 and the not-found page: the title, one sentence ending in the missing value as code, and a Back home button.

## What the architecture test enforces

It scans every `.ts` and `.tsx` file under `src` except `components/ui/`, plus `src/index.css`. Each rule also has fixtures in the test that prove it flags the pattern.

| Rule | Allowed only in | Use instead |
|---|---|---|
| import `@/components/ui/table` | `data-table.tsx` | `DataTable` |
| import `@/components/ui/badge` | `badges.tsx` | `KindBadge`, `TagBadge`, `StatusBadge`, ... |
| import `@/components/ui/card` | `item-card.tsx` | `ItemCard`, `SectionCard`, ... |
| import `@/components/ui/alert` | `notice.tsx` | `Notice`, `ErrorAlert` |
| import `react-markdown` | `note-body.tsx` | `NoteBody` |
| `ExternalLinkIcon` | `text-link.tsx` | `TextLink` with `href` |
| table elements, `role="table"` or `"grid"`, `createElement("table")` | `data-table.tsx` | `DataTable` |
| `<h1` | `page-header.tsx` | `PageHeader`, or `SectionHeading` for a section |
| `hover:underline` | `text-link.tsx` | `TextLink` |
| `overflow-x-auto`, `overflow-x-scroll`, `overflow-auto`, `overflow-scroll`, `overflowX`, `overflow: "auto"` | nowhere | `DataTable` and `BreakableText` |
| Tailwind palette colours (`text-red-600`, `bg-blue-50`, ...) | nowhere | a token class from `index.css` |
| hex colours, `rgb(`, `rgba(`, `hsl(`, `oklch(` | nowhere | a token in `index.css` |
| a colour class in `className` on `<Button`, `<Alert`, or `<Badge` | `badges.tsx`, `notice.tsx` | a Button variant, `Notice` tone, or a badge component |
| horizontal scrolling in `index.css` | `pre` and `code` rules | wrapping |
