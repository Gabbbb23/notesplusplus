# Shared components

Pages compose these components. They never restyle tables, badges, cards, links, alerts, headings, metadata, or long text on their own, so a design change made in one of these files reaches every page that uses it. `test/architecture.test.ts` makes `npm test` fail when code under `src` (outside `ui/`) breaks one of the rules listed at the end of this file.

The shadcn primitives in `ui/` are the raw material. Only the module named below may import each one. When a primitive's own look should change for everyone, such as the Button default colours, change it in `ui/`.

## data-table.tsx

Every table in the app. It is the only importer of `ui/table` and the only place that renders table markup.

- `DataTable` is what pages use. Give it `columns`, `rows`, and `rowKey`; mark the column that should wrap and take the spare width as `size: "fill"`, and an action column like "Open" as `hideHeader`.
- `ResponsiveTable` with `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell` is the lower level that `note-body.tsx` uses for markdown tables. Reach for it only when the rows are not a plain array.

Tables never scroll sideways. When the columns cannot fit, the table switches to a stacked layout where each row becomes a title plus label and value pairs. `chooseTableLayout` holds the rule: stack when the table is wider than its box, a fill column is narrower than 10rem (`FILL_MIN_REM`), or a text column (a note-table column) is narrower than 6rem (`TEXT_MIN_REM`). Each of those columns gets its minimum as a min-width span in its header. The table goes back only once the box is 24px wider than the width that was needed, so a scrollbar appearing cannot flip it straight back.

A note column is 48rem (768px) wide on a desktop screen, and a text column needs at least 6rem plus its 24px of padding (120px). So a note table with up to 5 columns of short cells stays a table, and one with 7 or more stacks.

How a stacked row lays out its pairs depends on the box width (`chooseStackArrangement`, set as `data-stack` on the wrapper):

- At least 36rem (`STACK_GRID_MIN_REM`, 576px): a grid of columns at least 12rem wide, as many as fit, each with a small muted label above its value. A record with seven fields takes two or three lines under its title.
- Narrower: one pair per line, the label on the left and the value on the right.

In both, the primary cell is the card's title across the full width, empty cells are hidden, and the cells keep their table roles and `data-label`.

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
- `variant`: `inline` (default, inherits size and weight), `strong` (medium weight), `title` (card title), or `muted` (breadcrumbs: muted text that turns foreground on hover, a hit area at least 24px tall, and a solid 2px focus ring in the ring colour).
- String children wrap through `BreakableText`.

## file-actions.tsx

Every control that acts on a file a note mentions. Apart from `lib/api.ts`, it is the only module that builds a file URL (`fileUrl`, `localFileUrl`, `viewUrlFor`), so every page offers the same actions the same way. A file is either a brain path (`files/...`) or an absolute Windows path outside the brain (`C:\...`); `lib/file-kinds.ts` holds the extension lists that decide which controls show. The server enforces the same lists.

- `FileActions` (`path`, `name`, `size`) for the controls on their own, such as the Files table's action column:
  - View, a `TextLink` to the file in a new tab, only for types a browser shows (PDF, images, audio, video, text).
  - Open, a button that opens the file in its default Windows app. It shows only for document, media, and archive types, never for programs or scripts. A path with no extension counts as a folder and shows "Open folder".
  - Show in folder, a button that opens File Explorer with the file selected. It always shows.
  - `size="default"` gives outline buttons with a label. `size="compact"` gives icon buttons with a tooltip, to sit after a line of text.
  - Every control's accessible name includes the file name ("Open Module 1.pdf in its default app"). A button is disabled while its request runs, and the result shows as a toast.
- `FileLink` (`path`, `name`, `code`) for a file named in running text: the path or name through `BreakableText`, then the compact `FileActions`. The actions follow the last line of the text and move below it as a group when they do not fit. `code` shows the text as code. The note header's Files, file search results, and local paths in note bodies use it.

In a note body, `lib/rehype-local-paths.ts` marks inline code whose whole text is an absolute Windows path, and `note-body.tsx` renders it through `FileLink`, in lists and table cells alike. Fenced code blocks, other inline code, and code inside a link stay as they are.

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

- `ItemCard` for one thing in a list: a title (`to` for an app route, `href` for a new tab, or neither for plain text when the meta row carries a `FileLink`), then optional badge, summary, snippet, and meta row.
- `CardList` stacks cards with the standard gap.
- `SectionCard` for a titled block with an optional count, such as a Check section or the Inbox form.
- `StatCard` for a number with a label on Home.
- `LoadingCards` for card-shaped placeholders.

`note-card.tsx` (`NoteCard`, `NoteList`) and `search-results.tsx` (`SearchResultCard`, `SearchResults`) are built on `ItemCard`. `SearchResults` opens with a count line: "20 results for “ryzen”", or "More than 20 results for “ryzen”" when its `hasMore` is set.

## show-more.tsx

The one way a list grows in place. No page builds its own "Show more" button.

- `ShowMore` (`label`, `loading`, `progress`, `onClick`) goes under the list, 16px below it. It renders an outline `Button` with a chevron, plus the optional `progress` text ("Showing 50 of 93") beside it in muted 14px, which the button names as its description. While `loading`, the button stays where it is, disabled and `aria-busy`, and the chevron turns into a spinner of the same size, so nothing moves.
- `ShowMoreLimit` is a muted line in the button's place for a list that stops at a cap.
- `useFocusFirstNew(count, listKey)` returns `listRef`, for the element around the cards, and `expectMore()`, to call on click. Once more `ItemCard`s render than there were at the click, focus moves to the first link or button in the first new card, so a keyboard user carries on from the new rows. A different `listKey` (a new query or tag) drops the pending focus.

Where it is used:

- **Search** asks for 20 results. When the response says `hasMore`, "Show more results" re-runs the same query with the limit raised by 20, up to 100; an offset would let the ranking shift between batches. The rows on screen stay while the bigger batch loads, and placeholders show only for a new query. The limit sits in the URL as `n` (left out at 20), replaced rather than pushed, so Back from a note restores the longer list and leaves the search in one step. At 100 with `hasMore`, `ShowMoreLimit` reads "Showing the top 100. Refine the search to narrow it."
- **Tag page** loads 50 notes at a time through `offset` with `lib/use-paged-list.ts`. The header count comes from the response's `total` ("93 notes"), and "Show more notes" carries "Showing 50 of 93" until every note is loaded.

The Tags page needs neither: `GET /api/tags` carries each tag's count, so it is one request.

## meta.tsx

Small muted details about a thing.

- `MetaList` with `MetaItem` (`label`, children) for a label and value grid: the note header's tags, dates, path, sources, and files.
- `MetaRow` for one wrapping line of details: a card's tags and date, the Home hub's tags, date, and "open as note" link.

## page-header.tsx

`PageHeader` goes at the top of every page, Home included, and owns the page's only `h1`. It takes `title`, `description`, `aside` (a count on the right), `badge` (after the title), `breadcrumbs` (the items for `Breadcrumbs`, shown above the title row), and children for extra rows such as note metadata. Every page uses the same 24px heading.

## breadcrumbs.tsx

`Breadcrumbs` (`items`, each a `label` and a `to` route) for where a page sits. It is the only importer of `ui/breadcrumb`, and `PageHeader` is the only component that renders it: pages pass items through `PageHeader`'s `breadcrumbs` prop, so every page places them 8px above the title the same way.

- A `nav` named "Breadcrumb" with an ordered list. Every item is a `TextLink` with the `muted` variant; the chevrons between them are hidden from assistive tech.
- The trail never names the current page, because the title right below already does.
- 13px muted text on a 20px line, 4px either side of each chevron. Long titles wrap through `BreakableText`; nothing truncates or scrolls sideways.

`lib/breadcrumb-items.ts` holds which items each page shows:

- A note: Home, then each hub below `index` down to the hub that lists it, from `GET /api/notes/:slug/trail` (Home › College › GE09 Life and Works of Rizal). `index` and the hubs it lists directly get Home alone. A note no hub reaches gets Home › Tags › its first tag, shown with `TagName`, or Home when it has no tags. While the trail loads, or when the request fails, the note shows Home alone in the same spot.
- The Tag page: Home › Tags (`TAG_PAGE_CRUMBS`).
- Search, Tags, Files, Inbox, Check, and not found, including the note 404: Home (`TOP_LEVEL_CRUMBS`). `NotFoundState` adds it itself.
- Home: none.

## section-heading.tsx

`SectionHeading` for a section title inside a page that is not in a `SectionCard`, such as the note's "Backlinks". Markdown `h2` in a note body renders through it too, so both look the same. It takes children and heading attributes such as `id`, and sets no margins.

## callout.tsx

`Callout` for a highlighted paragraph set off from the text around it: the note summary.

## diagram.tsx

`Diagram` (`source`) for a mermaid diagram. A fenced code block with the language `mermaid` in a note body renders through it; every other code block stays a code block. It is the only module that imports `mermaid`.

- **Loading.** Mermaid is bundled, so diagrams work offline. It loads with a dynamic `import()` the first time a diagram renders, in its own chunk, so a note without a diagram never loads it. Grey bars hold the space meanwhile.
- **Security and theme.** It renders with `securityLevel: "strict"`, because notes are agent-written, and the `base` theme. `lib/diagram-theme.ts` reads the theme colours at runtime from the `--foreground`, `--muted-foreground`, `--border`, `--card`, and `--primary` tokens, so no colour is written in source. Shapes sit on the card colour with a blue outline; timeline periods are blue with white labels, and their events are cards with a blue underline.
- **Width.** Gantt charts lay out to the figure's width, and tick monthly when the figure is under 560px so the date labels do not overlap. Other diagrams scale down to fit, so a wide timeline gets small text on a phone; the source toggle and the note's own text carry the same facts.
- **Renders.** Each render gets a fresh id and runs after the previous one, and a result for an older source is dropped, so StrictMode and edited markdown are safe.
- **The figure.** A card-like `figure` with the SVG scaled to the content width (never wider, never scrolling), and a ghost "Show source" button with `aria-expanded` that reveals the source as a code block.
- **Errors.** When mermaid cannot parse or draw the diagram, a warning `Notice` titled "This diagram could not be drawn" shows the parser's first error line and the source.

## Callouts

A blockquote whose first line is a GitHub alert marker renders as a `Notice`, with the marker line removed. `lib/rehype-callouts.ts` finds them and holds the table below; `note-body.tsx` renders them. The marker is case-insensitive and must stand alone on its line, as on GitHub. A blockquote without one stays a blockquote.

| Marker | Tone | Title |
|---|---|---|
| `[!NOTE]` | info | Note |
| `[!TIP]` | success | Tip |
| `[!IMPORTANT]` | info, with its own icon | Important |
| `[!WARNING]` | warning | Warning |
| `[!CAUTION]` | danger | Caution |

## notice.tsx

`Notice` for every alert box. It is the only importer of `ui/alert`. It takes `tone` (info, success, warning, danger), `title`, children for the explanation, an optional `icon` to replace the tone's default, and `live`. By default (`live`) it has `role="alert"`, so screen readers announce it when it appears, as `ErrorAlert` and Home's "No root hub yet" need. `live={false}` gives `role="note"`, a static box read in place; note-body callouts use it so a note's callouts are not announced on load. It has the card's 16px padding and 8px radius. The Check page's "All clear" is a success notice; Home's "No root hub yet" is an info notice.

## search-input.tsx

`SearchInput` for the search field with its icon, in the top bar (`shape="pill"`) and on the Search page (`shape="box"`). It takes `value`, `onChange`, `label`, `placeholder`, `name`, `autoFocus`, and `shortcutTarget`. The form and any button stay with the caller.

`shortcutTarget` (`"top-bar"` or `"page"`) makes the field a target of the Alt+K shortcut (see `search-shortcut.tsx`). While the shortcut goes to that field, it gets `aria-keyshortcuts="Alt+K"` and, while empty and unfocused, the keycap hint on its right. The hint is `aria-hidden`, so the label is read once and the keys are not read twice. It shows only from the `md` width (768px) up and on devices with hover and a fine pointer, and the field keeps 80px of right padding there so text never runs under it. Narrower windows and phones get neither, so the placeholder stays whole.

## search-shortcut.tsx

The Alt+K shortcut that focuses the search field. `lib/shortcuts.ts` holds its facts: the physical key `KeyK`, Alt with no Ctrl, Shift, or Meta, the `aria-keyshortcuts` value "Alt+K", and the keys the hint draws ("Alt K", or "⌥ K" on macOS, with the platform read once). The listener, the input's aria attribute, and the hint all read them from there.

- `SearchShortcutProvider` is mounted once, in `layout.tsx`. It holds the one `keydown` listener on `window`.
- `SearchInput` joins its registry through `shortcutTarget`. No page looks fields up with selectors.
- The shortcut matches on `event.code`, so Option+K on macOS (which types "˚") still counts. It ignores key repeats, and Ctrl+Alt (AltGr on Windows layouts) never triggers it. It works from anywhere, including inside another input or textarea.
- It prevents the default action, then focuses the Search page box when there is one, otherwise the top bar field, and selects the field's text. When no field is shown, it opens `/search` and focuses the box there.

## kbd.tsx

Every keycap. It is the only module that renders a `<kbd>` element.

- `Kbd` for one key, written as it should read ("Alt", not "ALT"): the app font at 12px medium, muted, 20px tall, 6px side padding, a 1px border, a 4px radius, and the card background.
- `KbdGroup` (`keys`) for keys pressed together, 4px apart. The search field's shortcut hint uses it.

## page-state.tsx

- `LoadingBlock` for grey bars while something loads.
- `ErrorAlert` for an API error or the "server not reachable" hint, built on `Notice` with the danger tone.
- `EmptyState` for an empty list.
- `NotFoundState` (`title`, `message`, `value`) for the note 404 and the not-found page: Home breadcrumbs, the title, one sentence ending in the missing value as code, and a Back home button.

## What the architecture test enforces

It scans every `.ts` and `.tsx` file under `src` except `components/ui/`, plus `src/index.css`. Each rule also has fixtures in the test that prove it flags the pattern.

| Rule | Allowed only in | Use instead |
|---|---|---|
| import `@/components/ui/table` | `data-table.tsx` | `DataTable` |
| import `@/components/ui/badge` | `badges.tsx` | `KindBadge`, `TagBadge`, `StatusBadge`, ... |
| import `@/components/ui/card` | `item-card.tsx` | `ItemCard`, `SectionCard`, ... |
| import `@/components/ui/alert` | `notice.tsx` | `Notice`, `ErrorAlert` |
| import `@/components/ui/breadcrumb` | `breadcrumbs.tsx` | `PageHeader` with `breadcrumbs` |
| `<Breadcrumbs` | `page-header.tsx` | `PageHeader` with `breadcrumbs` |
| import `react-markdown` | `note-body.tsx` | `NoteBody` |
| import `mermaid`, static or dynamic | `diagram.tsx` | `Diagram`, or a fenced `mermaid` block in a note |
| `ExternalLinkIcon` | `text-link.tsx` | `TextLink` with `href` |
| calling `fileUrl(`, `localFileUrl(`, or `viewUrlFor(` | `lib/api.ts`, `file-actions.tsx` | `FileActions`, `FileLink` |
| table elements, `role="table"` or `"grid"`, `createElement("table")` | `data-table.tsx` | `DataTable` |
| `<h1` | `page-header.tsx` | `PageHeader`, or `SectionHeading` for a section |
| `<kbd`, `createElement("kbd")` | `kbd.tsx` | `Kbd`, `KbdGroup` |
| a `<Button>` whose label or attributes say "show more", "load more", "see more", or "view more" | `show-more.tsx` | `ShowMore` |
| `hover:underline` | `text-link.tsx` | `TextLink` |
| `overflow-x-auto`, `overflow-x-scroll`, `overflow-auto`, `overflow-scroll`, `overflowX`, `overflow: "auto"` | nowhere | `DataTable` and `BreakableText` |
| Tailwind palette colours (`text-red-600`, `bg-blue-50`, ...) | nowhere | a token class from `index.css` |
| hex colours, `rgb(`, `rgba(`, `hsl(`, `oklch(` | nowhere | a token in `index.css` |
| a colour class in `className` on `<Button`, `<Alert`, or `<Badge` | `badges.tsx`, `notice.tsx` | a Button variant, `Notice` tone, or a badge component |
| horizontal scrolling in `index.css` | `pre` and `code` rules | wrapping |
