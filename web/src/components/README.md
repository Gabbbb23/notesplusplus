# Shared components

Pages compose these components. They never restyle tables, badges, cards, links, alerts, headings, metadata, or long text on their own, so a design change made in one of these files reaches every page that uses it. `test/architecture.test.ts` makes `npm test` fail when code under `src` (outside `ui/`) breaks one of the rules listed at the end of this file.

The shadcn primitives in `ui/` are the raw material. Only the module named below may import each one. When a primitive's own look should change for everyone, such as the Button default colours, change it in `ui/`.

Each primitive draws a Material 3 component:

- `dialog`: the basic dialog. It has no close X; it closes through its actions (text buttons in `DialogFooter`, wrapped in `DialogClose`) and Escape.
- `select`: `SelectTrigger` with `size="default"` (the default) is a 56px outlined text field; `size="chip"` is a 32px chip that opens a menu. The list is an M3 menu, the selected item in secondary-container with a trailing check.
- `dropdown-menu`: the menu, with 48px items. A checked checkbox or radio item is secondary-container with a check in the leading icon slot.
- `toggle-group` with `variant="outline"`: the outlined segmented button. A selected segment with a text label shows an 18px check before it; an icon-only one does not.
- `input` and `textarea`: the outlined text field. The border turns on-surface on hover and 2px primary while focused.
- `sheet` with `side="left"`: the modal navigation drawer, at most 360px wide, with its close button as a standard icon button.
- `tabs`: primary tabs; `TabsList variant="secondary"` for secondary tabs.
- `tooltip`: the plain tooltip, with no arrow. `sonner`: the snackbar.
- `card`: the outlined card. `alert`: a neutral 12px-corner box that `Notice` colours. `badge`: a label pill that `badges.tsx` colours.
- `table`, `breadcrumb`, `separator`, `skeleton`: M3 type and colour roles only.

Menu items, chips, segmented buttons, tabs, and the sheet's close button carry the `Ripple` state layer. In a menu, the highlight Radix gives the item under the pointer or the keyboard is the 10% layer, so the ripple there only draws the press.

## Accessibility basics

These hold for every page, and `npm test` checks each of them.

- **Contrast.** Colours are the M3 colour roles in `src/theme.css`, generated light and dark by `scripts/theme.ts`, and `index.css` maps them to Tailwind names. `test/contrast.test.ts` computes WCAG ratios from both schemes: text reaches 4.5:1, and control boundaries and focus outlines 3:1, on `surface` and on every surface-container tone.
  - Links are `text-primary` (TextLink). Filled buttons put `on-primary` on `primary`, and every container role carries its own on-colour.
  - `outline` (`border-outline`) is the boundary of a text field, select, or outlined button. Cards, tables, and dividers use `outline-variant`, which is not a control boundary.
  - Every tinted pair reaches 4.5:1, and the test renders each `Notice` tone and each `KindBadge`, `StatusBadge`, and `FileTypeBadge` to check the classes they use. Kind and status pills sit on the primary, success, warning, tertiary, and error containers with their on-colours; success and warning are extended colours harmonized toward the source. A notice's message uses its title colour at full strength; a translucent `/90` would drop it below 4.5:1.
- **Focus.** `FOCUS_RING` in `lib/focus-ring.ts` is the one keyboard focus style, the M3 focus indicator: a solid 3px outline in the secondary role, 2px outside the element, following its corners. `test/contrast.test.ts` checks secondary reaches 3:1 on every surface in both schemes. It uses `focus-visible`, so a mouse click on a button shows nothing. Button, Input, SelectTrigger, Textarea, Toggle, ToggleGroupItem, TabsTrigger, the Sheet close button, Badge links, BreadcrumbLink, the DropdownMenu items (plain, checkbox, radio, and submenu triggers), and `TextLink` carry it; a `:focus-visible` rule in `index.css` (`outline: 3px solid var(--md-sys-color-secondary)`) gives the same outline to anything else that takes focus, such as the sidebar links. DropdownMenu items draw it inside their edges (`focus-visible:-outline-offset-3`), because the menu clips its overflow and would cut off an outline outside a full-width item. Text fields (Input, Textarea, the default SelectTrigger) also turn their border 2px primary while focused. A new interactive primitive adds `FOCUS_RING` to its classes.
- **Motion.** Under `prefers-reduced-motion: reduce`, one rule set in `index.css` ends every animation and transition at once: spinners and skeletons stand still, and the sheet appears without sliding.
- **Font.** Roboto 400, 400 italic, 500, and 700 ship inside the build from `@fontsource/roboto` (imported in `main.tsx`), so nothing loads from the network. Text set at 600 (`font-semibold`) draws with the 700 face. The stack is `Roboto, "Segoe UI", system-ui, sans-serif`; code uses `Consolas, "Cascadia Mono", ui-monospace, Menlo, monospace`.

## data-table.tsx

Every table in the app. It is the only importer of `ui/table` and the only place that renders table markup.

- `DataTable` is what pages use. Give it `columns`, `rows`, and `rowKey`; mark the column that should wrap and take the spare width as `size: "fill"`, and an action column like "Open" as `hideHeader`.
- `ResponsiveTable` with `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell` is the lower level that `note-body.tsx` uses for markdown tables. Reach for it only when the rows are not a plain array.

The look, in both layouts: an outlined container (`border-outline-variant`, 12px corners, `surface`), the header row in title small on-surface-variant on `surface-container-low`, cells in body medium, and `outline-variant` dividers between rows. The primary cell is title small.

Tables never scroll sideways. When the columns cannot fit, the table switches to a stacked layout where each row becomes a title plus label and value pairs. `chooseTableLayout` holds the rule: stack when the table is wider than its box, a fill column is narrower than 10rem (`FILL_MIN_REM`), or a text column (a note-table column) is narrower than 6rem (`TEXT_MIN_REM`). Each of those columns gets its minimum as a min-width span in its header. The table goes back only once the box is 24px wider than the width that was needed, so a scrollbar appearing cannot flip it straight back.

A note column is 48rem (768px) wide on a desktop screen, and a text column needs at least 6rem plus its 24px of padding (120px). So a note table with up to 5 columns of short cells stays a table, and one with 7 or more stacks.

How a stacked row lays out its pairs depends on the box width (`chooseStackArrangement`, set as `data-stack` on the wrapper):

- At least 36rem (`STACK_GRID_MIN_REM`, 576px): a grid of columns at least 12rem wide, as many as fit, each with its label (label medium, on-surface-variant) above its value. A record with seven fields takes two or three lines under its title.
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
- `href` for a site, opened in a new tab with `rel="noopener noreferrer"` and the external-link icon.
- `variant`: `inline` (default, inherits size and weight), `strong` (medium weight), `title` (a title in `text-title-medium`), `card` (the title of a card that opens as a whole: `on-surface`, no underline, the link stretched over the card with the focus indicator around it), or `muted` (breadcrumbs: `on-surface-variant` text that turns `on-surface` on hover, and a hit area at least 24px tall).
- Every variant but `muted` is `text-primary`. Every variant is underlined on hover and has `FOCUS_RING` and the `rounded-extra-small` (4px) radius, so the focus outline has soft corners.
- String children wrap through `BreakableText`.

## file-actions.tsx

Every control that acts on a file a note mentions, so every page offers the same two actions the same way. A file is either a brain path (`files/...`) or an absolute Windows path outside the brain (`C:\...`); `lib/file-kinds.ts` holds the extension list that decides whether Open shows. The server enforces the same list.

No page shows a file in a browser tab. The View link is gone (DECISIONS.md, 2026-09-15, "File buttons are Open and Show in folder only"), and the architecture test flags any source that builds a `/api/files/...` or `/api/local-file` URL.

- `FileActions` (`path`, `name`, `size`) for the controls on their own, such as the Files table's action column:
  - Open, a button that opens the file in its default Windows app. It shows only for document, media, and archive types, never for programs or scripts. A path with no extension counts as a folder and shows "Open folder".
  - Show in folder, a button that opens File Explorer with the file selected. It always shows, last, so in the Files table's end-aligned column it lines up in every row.
  - `size="default"` gives outlined small buttons (32px) with a label. `size="compact"` gives 32px standard icon buttons with a 20px icon and the hint as a tooltip (`title`), to sit after a line of text; negative margins let them share a 24px line without making it taller.
  - Every control's accessible name includes the file name ("Open Module 1.pdf in its default app"). A button is disabled while its request runs, and the result shows as a toast.
- `FileLink` (`path`, `name`, `code`) for a file named in running text: the path or name through `BreakableText`, then the compact `FileActions`. The actions follow the last line of the text and move below it as a group when they do not fit. `code` shows the text as code. The note header's Files, file search results, and local paths in note bodies use it.

In a note body, `NoteBody` takes the note's `mentions` from the server, and `lib/rehype-local-paths.ts` marks the inline code whose text is one of them; `note-body.tsx` renders it through `FileLink`, in lists and table cells alike (in print mode, as code with no buttons). The web has no path rule of its own: the server decides what a mention is and opens only those paths, so a button never leads to a refusal. Code blocks, other inline code (a path the server does not list included), and code inside a link stay as they are. Pass `mentions={[]}` for markdown that is not a note body.

## Wikilinks

`lib/remark-wikilinks.ts` turns `[[slug]]` and `[[slug|label]]` into links to `/notes/slug`, rendered through `TextLink`. It works on the syntax tree that `remark-gfm` builds and looks only in text, so nothing inside inline code (any number of backticks), a ```` ``` ```` or `~~~` fence, an indented code block, or a markdown link's text becomes a link. The server reads links with the same rule, so every rendered link is one the server counts for backlinks, trails, and hub membership. In a table cell the label's pipe must be escaped (`[[slug\|label]]`), or GFM splits the cell there. On the print page a wikilink is its label as plain text.

## badges.tsx

Every label pill and tag chip, and the one way to show a tag name. It is the only importer of `ui/badge`.

- `KindBadge` for note, hub, source, file.
- `FileTypeBadge` for a file extension.
- `StatusBadge` with a `tone` of neutral, success, warning, or danger, for states and counts.
- `TagName` for a tag as text: an `on-surface-variant` `#` and the name, wrapping. The Tags list, the Tag page heading, and the Search tag filter use it.
- `TagBadge` and `TagBadges` for `#tag` links, each an M3 assist chip: 32px tall, `rounded-small`, a 1px `outline-variant` border, 16px side padding, `text-label-large` in `on-surface-variant`, a `Ripple` state layer, and `FOCUS_RING`. Chips in a row sit 8px apart. A long tag wraps inside its chip, which grows taller and never wider than its container.
- `NoteChip` (`note`) for a note as the same assist chip, its title linking to the note. A domain card's sub-hubs use it.

The three label pills share one shape: 24px tall, `rounded-small`, 8px side padding, `text-label-medium`. Their colours are the `kind-*` and `status-*` tokens in `src/index.css`, which map onto the M3 container roles.

## item-card.tsx

Every card but Home's domain cards (`DomainCard` in `domains.tsx`, an M3 filled card). It is the only importer of `ui/card`. Lists and sections use the M3 outlined card: `bg-surface`, a 1px `outline-variant` border, `rounded-medium` (12px), and 16px padding, with no shadow.

- `ItemCard` for one thing in a list: a title (`to` for an app route, `href` for a new tab, or neither for plain text when the meta row carries a `FileLink`), then optional badge, summary, snippet, and meta row, 8px apart. A linked title makes the whole card one target: the title link (`TextLink` `card`) stretches over the card, the card shows the M3 state layer and ripple, and every other link or button inside (the menu, tag chips, file buttons) sits above it and keeps working on its own. The title is `text-title-medium`, the summary and snippet `text-body-medium` (the summary in `on-surface-variant`), and the meta row is a `MetaRow`.
  - `actions` puts controls at the right end of the title row, such as `NoteActionsMenu`. They sit beside the title link, never inside it, so clicking one does not follow the link. A long title wraps beside them while they stay in the top right corner. Negative margins (8px above, below, and to the right) let a 40px icon button share the 24px title line without making the card taller, and line its icon up with the card's padding.
- `CardList` stacks cards 8px apart. `NoteList` uses the same gap, in its list and tile views.
- `SectionCard` for a titled block with an optional count, such as a Check section or the Inbox form: an outlined card with the title in `text-title-medium` and the count as a `StatusBadge` beside it. The Check page has one per list in `GET /api/check-links`: broken links, missing files, missing sources, invalid notes, notes no hub lists, notes listed by more than one hub (each with links to those hubs), and pins to missing notes (each slug as code, since there is no note to link to). Any entry in any list withholds "All clear".
- `LoadingCards` for outlined card shapes holding placeholder bars, 8px apart like `CardList`.

`note-card.tsx` and `search-results.tsx` are built on `ItemCard`:

- `NoteCard` (`note`, `actions`) shows a note's title, type, summary, tags, and updated date. With `compact`, it shows the title and type only and takes a `NoteRef` (slug, title, type); the tiles views of `NoteList` and the Bookmarks page use it.
- `NoteList` gives every card its `NoteActionsMenu`. The Tag page and a note's Backlinks use it.
- `SearchResultCard` gives a note result its `NoteActionsMenu` and a file result none. `SearchResults` opens with a count line in `text-body-medium` `on-surface-variant`: "20 results for “ryzen”", or "More than 20 results for “ryzen”" when its `hasMore` is set. A result's snippet marks its hits with `<mark>` (`Snippet`), which `index.css` paints in the `mark` and `on-mark` tokens.

## note-row.tsx

The M3 list item, for lists the owner scans rather than reads: `LinkRow` (`to`, `headline`, `leading`, `supporting`, `trailing`, `actions`) is one row that opens a page, and `NoteRow` (`note`, plus the same `supporting`, `trailing`, and `actions`) is a `LinkRow` for a note, with the note's type icon in front and its title as the headline. The whole row is the target: the headline's link stretches over it, the row shows the state layer and ripple, and the focus indicator goes around it, while `actions` (usually `NoteActionsMenu`) sit above the link and keep working on their own. A row is 56px tall with one line and grows with a supporting line, which is cut at two lines. The type icon is named by the type ("hub"), outside the link's name, so a screen reader hears the type the old cards showed as a badge. `RowList` holds the rows; Home's Pinned, Recent, Bookmarks, and Stats sections, the Tags page, and the Bookmarks page's list and details views use them. `NOTE_TYPE_ICON` is the icon for each type, which the drawer's pinned links use too.

## show-more.tsx

The one way a list grows in place. No page builds its own "Show more" button.

- `ShowMore` (`label`, `loading`, `progress`, `onClick`) goes under the list, 16px below it. It renders an outlined `Button` with a chevron, plus the optional `progress` text ("Showing 50 of 93") beside it in `text-body-medium` `on-surface-variant`, which the button names as its description. While `loading`, the button stays where it is, disabled and `aria-busy`, and the chevron turns into a `primary` spinner of the same size, so nothing moves.
- `ShowMoreLimit` is a `text-body-medium` `on-surface-variant` line in the button's place for a list that stops at a cap.
- `useFocusFirstNew(count, listKey)` returns `listRef`, for the element around the cards or rows, and `expectMore()`, to call on click. Once more `ItemCard`s or `LinkRow`s render than there were at the click, focus moves to the first link or button in the first new one, so a keyboard user carries on from the new rows. A different `listKey` (a new query or tag) drops the pending focus.

Where it is used:

- **Search** asks for 20 results. When the response says `hasMore`, "Show more results" re-runs the same query with the limit raised by 20, up to 100; an offset would let the ranking shift between batches. The rows on screen stay while the bigger batch loads, and placeholders show only for a new query. The limit sits in the URL as `n` (left out at 20), replaced rather than pushed, so Back from a note restores the longer list and leaves the search in one step. At 100 with `hasMore`, `ShowMoreLimit` reads "Showing the top 100. Refine the search to narrow it."
- **Tag page** loads 50 notes at a time through `offset` with `lib/use-paged-list.ts`. The header count comes from the response's `total` ("93 notes"), and "Show more notes" carries "Showing 50 of 93" until every note is loaded. With a filter on, the count reads against the tag's own count from `GET /api/tags` ("12 of 93 notes"); see `note-list-controls.tsx`. The hook remembers, per history entry, how many notes the list had loaded (session storage, newest 50 lists), so Back or Forward to the page asks for that many in one request (`limit=100`, at most the API's 500) instead of 50, and the scroll position `history-nav.tsx` restores is reachable. A fresh visit is a new entry and starts at 50 again.

The Tags page needs neither: `GET /api/tags` carries each tag's count, so it is one request.

## note-list-controls.tsx

`NoteListControls` (`filters`, `types`) sits above a note list and narrows and orders it. The Tag page is its only caller. The filter field takes its own full-width line; the type and sort menus are M3 chips that open a menu (32px, with a drop-down arrow, `SelectTrigger size="chip"`) in a row below it, followed by Clear filters, and that row wraps on a narrow screen.

- **Filter field.** A `SearchInput` (`shape="box"`) named "Filter notes" with the placeholder "Filter by title or summary". Once typing pauses for 250ms (`FILTER_DELAY_MS`), its text goes to the server as `q` on `GET /api/notes`, which keeps the notes whose title or summary holds every word, ignoring case. It filters on the server, not over the rows on screen, because the Tag page loads 50 at a time and a note not yet loaded would silently drop out.
- **Type menu.** "Any type" plus the `types` the caller passes. The Tag page passes note and hub, since sources carry no tags.
- **Sort menu.** "Title A to Z" (the default), "Recently added" (`created`), and "Recently updated" (`updated`), from `NOTE_SORT_OPTIONS`.
- **Clear filters.** A small text button in the chip row, shown only while the field or the type narrows the list. It empties both at once and leaves the sort alone. The empty list then reads "No notes match these filters."
- **`trailing`.** An optional node at the right end of the chip row. The Tag page puts its `ViewSwitch` there.

`useNoteListFilters(types)` in `lib/note-list-filters.ts` holds the state. It lives in the URL as `q`, `sort`, and `type`, each left out at its default, so Back, reload, and a copied link show the same list. Every change replaces the history entry rather than pushing one, so Back leaves the page in one step. When Back or a link changes `q`, the field follows; the hook's own writes never overwrite text typed after them.

While the filtered list loads, the rows already on screen stay, dimmed and `aria-busy`, with no Show more button: `usePagedList` keeps them when its third argument, `listKey` (the tag), is unchanged, and reports `stale` meanwhile. A different tag drops them at once. If the filtered first page fails, the old rows go and the error shows alone, so a failed filter never leaves the previous results looking current.

## recent-notes.tsx

`RecentNotes` is Home's "Recent" section, at the top of the supporting pane: what was filed lately, so the newest note is one click from Home instead of a search away. Home is its only caller.

- It asks for `GET /api/notes?sort=created&limit=50` once, groups those notes by their `created` date, and shows each day as a list subheader, an `h3` inset like the rows: the date in `text-title-small`, then on the same line a `text-body-small` `on-surface-variant` detail ("today · 3 notes", "yesterday · 1 note", "2 notes" on older days). The notes are `NoteRow`s with their `NoteActionsMenu`, so a new note can be pinned or exported from Home.
- It orders by `created`, not `updated`: the section answers "what is new", and a note edited today does not come back to the top.
- Eight notes show at first; `ShowMore` reveals eight more from the batch already fetched, so no request follows a click. Once the batch is fully shown and the brain holds more, `ShowMoreLimit` names the cap ("Showing the newest 50 notes of 191.").
- A failed load shows an `ErrorAlert` with Try again, which re-runs only this request. An empty brain renders nothing at all, so a new brain shows just the root hub notice.

## meta.tsx

Small details about a thing.

- `MetaList` with `MetaItem` (`label`, children) for a label and value grid: the note header's tags, dates, path, sources, and files. Labels are `text-label-medium` `on-surface-variant`, values `text-body-medium`, on a shared baseline.
- `MetaRow` for one wrapping line of details in `text-body-small` `on-surface-variant`: a card's tags and date.

## page-header.tsx

`PageHeader` goes at the top of every page, Home included, and owns the page's only `h1`. It takes `title`, `tabTitle`, `description`, `aside` (a count on the right), `badge` (after the title), `actions`, `breadcrumbs` (the items for `Breadcrumbs`, shown above the title row), and children for extra rows such as note metadata. Every page sets its title the same way, in headline-medium (28px on a 36px line).

`actions` holds controls at the right end of the title row. The note page passes its `NoteActionsMenu` there, for notes, hubs, and sources alike. The actions keep their place beside the first line of a title that wraps, and `aside` stays to their left.

It also sets the browser tab title, through `usePageTitle` in `lib/page-title.ts`, the only module that writes `document.title`. The title is `tabTitle` or, when that is left out, a string `title`, followed by " · notes++". When the header unmounts, the tab goes back to "notes++", so a page showing a loading or error state never keeps the previous page's title.

| Page | Tab title | How |
|---|---|---|
| Home | notes++ | `tabTitle=""` |
| A note | College · notes++ | the title |
| Search | Search: rizal · notes++, or Search · notes++ with no query | `tabTitle` |
| A tag | #college · notes++ | `tabTitle` |
| Tags, Files, Inbox, Check | Tags · notes++, ... | the title |
| Not found, a missing note | Not found · notes++, Note not found · notes++ | the title |

## breadcrumbs.tsx

`Breadcrumbs` (`items`, each a `label` and a `to` route) for where a page sits. It is the only importer of `ui/breadcrumb`, and `PageHeader` is the only component that renders it: pages pass items through `PageHeader`'s `breadcrumbs` prop, so every page places them 8px above the title the same way.

- A `nav` named "Breadcrumb" with an ordered list. Every item is a `TextLink` with the `muted` variant; the chevrons between them are hidden from assistive tech.
- The trail never names the current page, because the title right below already does.
- Body-medium (14px on a 20px line) in on-surface-variant, 4px either side of each chevron. Long titles wrap through `BreakableText`; nothing truncates or scrolls sideways.

`lib/breadcrumb-items.ts` holds which items each page shows:

- A note: Home, then each hub below `index` down to the hub that lists it, from `GET /api/notes/:slug/trail` (Home › College › GE09 Life and Works of Rizal). `index` and the hubs it lists directly get Home alone. A note no hub reaches gets Home › Tags › its first tag, shown with `TagName`, or Home when it has no tags. While the trail loads, or when the request fails, the note shows Home alone in the same spot.
- The Tag page: Home › Tags (`TAG_PAGE_CRUMBS`).
- Search, Tags, Files, Inbox, Check, and not found, including the note 404: Home (`TOP_LEVEL_CRUMBS`). `NotFoundState` adds it itself.
- Home: none.

## section-heading.tsx

`SectionHeading` for a section title inside a page that is not in a `SectionCard`, such as the note's "Backlinks". Markdown `h2` in a note body renders through it too, so both look the same. It takes children and heading attributes such as `id`, and sets no margins. It is title-large (22px) in on-surface over a 1px outline-variant rule. `action` puts one small control at the right end of the title's line, above the same rule and outside the `h2`, so the heading is named by its title alone; Home's Domains passes its "Open index" text button. The rule stays where it is without one.

## callout.tsx

`Callout` for a paragraph set off from the text around it: the note summary. It sits on `bg-surface-container` with `rounded-large` (16px) corners, 20px side and 16px vertical padding, in `text-body-large` `on-surface`, with no border or tint.

## diagram.tsx

`Diagram` (`source`) for a mermaid diagram. A fenced code block with the language `mermaid` in a note body renders through it; every other code block stays a code block. It is the only module that imports `mermaid`.

- **Loading.** Mermaid is bundled, so diagrams work offline. It loads with a dynamic `import()` the first time a diagram renders, in its own chunk, so a note without a diagram never loads it. Placeholder bars hold the space meanwhile.
- **Security and theme.** It renders with `securityLevel: "strict"`, because notes are agent-written, and the `base` theme. `lib/diagram-theme.ts` reads the colours at runtime from the M3 roles (`--md-sys-color-on-surface`, `on-surface-variant`, `outline-variant`, `surface`, `surface-container`, `primary`, `on-primary`, `primary-container`, `on-primary-container`), so no colour is written in source. Shapes sit on surface-container with a primary outline; timeline periods and gantt tasks are primary with on-primary labels, timeline events sit on surface-container with a primary underline, and sequence notes are primary-container.
- **Light and dark.** `useColorScheme` (`lib/use-color-scheme.ts`) follows `prefers-color-scheme: dark`, and a change of scheme draws every diagram again with the new roles; the old drawing stays until the new one is ready. Without `matchMedia` (jsdom) the scheme reads as light. The print page always reads the light roles, because theme.css keeps them under `.print-page`.
- **Width.** Gantt charts lay out to the figure's width, and tick monthly when the figure is under 560px so the date labels do not overlap. Other diagrams scale down to fit, so a wide timeline gets small text on a phone; the source toggle and the note's own text carry the same facts.
- **Renders.** Each render gets a fresh id and runs after the previous one, and a result for an older source or scheme is dropped, so StrictMode and edited markdown are safe.
- **The figure.** An outlined `figure` (`outline-variant` border, 12px corners, `surface`) with the SVG scaled to the content width (never wider, never scrolling), and a small text button "Show source" with `aria-expanded` that reveals the source as a code block. `print` leaves the button out.
- **Errors.** When mermaid cannot parse or draw the diagram, a warning `Notice` titled "This diagram could not be drawn" shows the parser's first error line and the source.
- **Done drawing.** Inside a `RenderTrackerProvider` (`render-tracker.tsx`), a diagram counts as drawing from mount until it is drawn or has failed. The print page waits for that count to reach zero.

## Callouts

A blockquote whose first line is a GitHub alert marker renders as a static `Notice` (`live={false}`), with the marker line removed. `lib/rehype-callouts.ts` finds them and holds the table below; `note-body.tsx` renders them. The marker is case-insensitive and must stand alone on its line, as on GitHub. A blockquote without one stays a blockquote.

| Marker | Tone | Title |
|---|---|---|
| `[!NOTE]` | info | Note |
| `[!TIP]` | success | Tip |
| `[!IMPORTANT]` | info, with its own icon | Important |
| `[!WARNING]` | warning | Warning |
| `[!CAUTION]` | danger | Caution |

## notice.tsx

`Notice` for every alert box. It is the only importer of `ui/alert`. It takes `tone` (info, success, warning, danger), `title`, children for the explanation, an optional `icon` to replace the tone's default, and `live`. By default (`live`) it has `role="alert"`, so screen readers announce it when it appears, as `ErrorAlert` and Home's "No root hub yet" need. `live={false}` gives `role="note"`, a static box read in place; note-body callouts use it so a note's callouts are not announced on load.

A notice has no border: its tone's container colour sets it apart, with 16px padding and `rounded-medium` (12px) corners. Info is `secondary-container`, success `success-container`, warning `warning-container`, and danger `error-container`. The `text-title-small` title and the `text-body-medium` message both use the container's matching on-colour at full strength, and the 20px icon lines up with the title. The Check page's "All clear" is a success notice; Home's "No root hub yet" is an info notice.

## layout.tsx

`Layout` is the shell around every page but the print page. It mounts `SearchShortcutProvider`, `PinsProvider`, `DomainsProvider`, and `HistoryProvider` once, and the toasts, which show as snackbars at the bottom centre. The shell follows the M3 window size classes:

- **Compact** (under 600px). A 64px top app bar holds the menu button, the brand mark, Back and Forward, and the search bar. The menu button opens the modal navigation drawer.
- **Medium** (600 to 839px). A navigation rail, 80px wide, runs down the left: the menu button at the top, then the seven destinations, each an icon in a 56×32 indicator with its label under it. The indicator fills with the secondary container on the current page. Domains and pinned notes are in the modal drawer only. The top app bar holds Back and Forward and the search bar.
- **Expanded and up** (840px and wider). A standard navigation drawer, 18rem wide and the full height of the window, on surface-container-low: the brand, the destinations as 56px pills, the Domains group, and the Pinned group (see `pins.tsx`). The top app bar is the same as at medium.
- **The modal drawer** (the Sheet) shows the brand, the destinations, the Domains group, and the Pinned group with the standard drawer's item styles. Opening it focuses Close. Closing it returns focus to the menu button that opened it, the rail's or the top app bar's.
- **The top app bar** sticks to the top on surface, and takes surface-container once the page is scrolled.

**Domains.** Between the destinations and the pins, both drawers show a `nav` named "Domains" with the same title-small section headline as Pinned: one 56px row per domain from `useDomains()`, in the root hub's order, each a link to the domain's hub with a 24px letter avatar (secondary container) and the title in label-large, cut at two lines. The domain whose hub is open gets the destinations' active colours from the same `navStateClass`. Nothing shows while the domains load, when they fail, or when the root hub lists none; Home is where a failure is reported.

The rail and the standard drawer each render the destinations as a `nav` named "Main". Each is `hidden` outside its window class, which takes it out of the accessibility tree, so assistive tech finds one "Main" nav at a time; the modal drawer's copy exists only while it is open, and the page behind it is hidden then. jsdom applies no CSS, so tests find both and pick one by `data-slot`: `navigation-rail`, `navigation-drawer`, or `top-app-bar`.

The main column stays 52rem wide, 80rem on a note page and on Home (the `.note-page` and `.home-page` rules in `index.css`). A note's outline moves beside the text from the large window class (1200px) up, the first width where both fit beside the drawer.

## search-input.tsx

`SearchInput` for the search field with its leading search icon. `shape="pill"` is the M3 search bar, for the top app bar: 48px, fully rounded, on surface-container-high with no outline, and a hover state layer. `shape="box"`, the default, is the M3 outlined text field from `ui/input`, 56px, with the icon 12px in; the Search page and the Tag page filter use it. It takes `value`, `onChange`, `label`, `placeholder`, `name`, `autoFocus`, and `shortcutTarget`. The form and any button stay with the caller.

`shortcutTarget` (`"top-bar"` or `"page"`) makes the field a target of the / shortcut (see `search-shortcut.tsx`). While the shortcut goes to that field, it gets `aria-keyshortcuts="/"` and, while empty and unfocused, the keycap hint on its right. The hint is `aria-hidden`, so the label is read once and the keys are not read twice. It shows only from the medium window class (600px) up and on devices with hover and a fine pointer, and the field keeps 48px of right padding there so text never runs under it. Narrower windows and phones get neither, so the placeholder stays whole.

## search-shortcut.tsx

The / shortcut that focuses the search field. `lib/shortcuts.ts` holds its facts: the character "/" with no Ctrl, Alt, or Meta, the `aria-keyshortcuts` value "/", and the one key the hint draws. The listener, the input's aria attribute, and the hint all read them from there.

- `SearchShortcutProvider` is mounted once, in `layout.tsx`. It holds the one `keydown` listener on `window`.
- `SearchInput` joins its registry through `shortcutTarget`. No page looks fields up with selectors.
- The shortcut matches on `event.key`, so a layout that types "/" with Shift still counts. It ignores key repeats. Inside an input, textarea, select, or editable content it does nothing, so "/" types there as usual.
- It prevents the default action, then focuses the Search page box when there is one, otherwise the top bar field, and selects the field's text. When no field is shown, it opens `/search` and focuses the box there.

## history-nav.tsx

Back and Forward in the top app bar, before the search bar, and the scroll memory behind them. `Layout` mounts `HistoryProvider` once inside the router and draws `HistoryNav`; no other module calls `window.scrollTo` or sets `history.scrollRestoration`.

- **The buttons.** Two standard icon buttons in a group named "History", "Back" and "Forward", each disabled while it leads nowhere, so they read like a browser's. Back is `navigate(-1)` and Forward `navigate(1)`, which is what the mouse's side buttons and Alt with an arrow do, so all three behave the same. Whether they lead anywhere comes from `lib/history-position.ts`: the keys of the entries visited since the page loaded, in order, with PUSH cutting off the forward ones, REPLACE swapping the current one, and POP moving along them. After a reload the stack holds one key; Back still enables when react-router's `history.state.idx` says the browser has earlier entries of the app, and Forward waits until the app has seen a later one.
- **The scroll memory.** Every scroll is recorded under the current entry's `location.key` (`lib/scroll-memory.ts`, mirrored to session storage so a reload keeps it, newest 50). On POP (Back, Forward, the side buttons) the provider scrolls to the entry's remembered position. The page is usually still a loading block then, so `restoreScroll` tries on every animation frame until the page is tall enough to reach the position, or two seconds pass and it scrolls as far as it can; it stops at once when the reader wheels, touches, or presses a key. The browser's own restoration is switched off (`scrollRestoration = "manual"`) because it would scroll before the note has loaded.
- **New pages open at the top.** A PUSH without a hash scrolls to 0 before the new page paints. A PUSH to a heading (`#note-heading-3`) is left to the browser, and a REPLACE (the Tag page's filters, the search limit) leaves the scroll where it is.
- **Heading links are entries too.** An outline link is a plain `#heading` anchor, so the browser makes the history entry itself, with no router state: the router calls every such entry `default`, the first page's key, and `history.state.idx` is missing. The provider names it `default#note-heading-3` instead, and the stack treats an unknown entry with no index as one pushed after the current, so Back still leads to the pages before it. The browser scrolls to the heading before the router hears of the entry; that scroll would be recorded against the page left, so scroll events are dropped while `window.location.hash` differs from the entry on record. Reaching such an entry again with Forward scrolls the heading into view.

## pins.tsx

The owner's pins: notes, hubs, or sources pinned to Home, to the sidebar, or both. The server keeps them in `pins.yml` in the brain, and the web UI may write that one file (DECISIONS.md, 2026-09-15, "Pins live in the brain and the web UI may write them").

`PinsProvider` is mounted once, in `layout.tsx`, the same way `SearchShortcutProvider` is. It loads `GET /api/pins` once and holds the one copy that every menu, Home's Pinned section, and the sidebar read. `usePins()` returns:

- `lists`: `{ home, sidebar }`, each a list of `PinnedNote` in pin order: the `NoteRef` (slug, title, type) plus the note's `tags`. Every pin the server sends carries them; a pin still on its way carries them when the note it was made from did. Home's Pinned rows read them for the domain.
- `isPinned(slug, target)`.
- `setPin(note, target, pinned)`: `PUT /api/pins/:target` with `{ slug, pinned }`. Pinning appends to the end of the list, as the server does.
- `move(slug, target, "up" | "down")`: swaps the note with its neighbour and sends `PUT /api/pins/:target/order` with every slug in the new order. A move past either end sends nothing.
- `status` (`loading`, `ready`, `error`) and `retryLoad()`, which a menu calls when it opens after a failed load.

Every write carries `X-Brain-Tool: web` and a JSON body.

- **Before the answer.** A change shows at once. Changes go to the server one at a time, in order, and each answer carries both lists, which replace what is on screen. A move's order is worked out from the server's latest lists, so it never undoes the change before it.
- **Toasts.** "Pinned to Home", "Unpinned from Home", "Pinned to sidebar", or "Unpinned from sidebar" once the server accepts; a move shows only in the list. When the server refuses (404 for a note that does not exist, 400 when a list already holds 50), the change is taken back out and an error toast reads "Could not pin to Home" with the server's message under it.
- **A failed load** is quiet: the lists read as empty, so no pinned section shows, and the menus still work.

Outside a `PinsProvider`, `usePins` throws.

Where pins show:

- **Home.** A "Pinned" section in the main column under the Domains: a `SectionHeading` and `NoteRow`s in pin order, in two columns once the column is 40rem wide. Each row's supporting line is the note's domain tag as `TagName` (the first of its tags that a domain carries), or nothing for a note in no domain. Each row's menu adds Move up and Move down. With no Home pins the section does not render.
- **Navigation drawers.** A "Pinned" group under the Domains (a `nav` named "Pinned", headed in title-small), in the standard drawer and the modal drawer alike; the rail has none. Each row is a link with a 24px type icon (note, hub, source) and the title in label-large, cut at two lines with an ellipsis (`line-clamp-2`), so a row is 56px tall like a destination; the full title stays the link's accessible name and its tooltip. The current note's link gets the destinations' active colours, the secondary container, from the same `navStateClass`. Each row has a 32px `NoteActionsMenu` at its right, shown on hover, while the row holds focus, while its menu is open, and always on devices without hover; that menu is where a sidebar pin is moved or unpinned. With no sidebar pins the group does not render. The drawer's link area scrolls up and down when the pins outgrow the screen, never sideways.

## domains.tsx

The brain's domains are the hubs the root hub `index` links to, in the order it lists them. `DomainsProvider`, mounted once in `layout.tsx` beside `PinsProvider`, loads them once for the whole app, and `useDomains()` returns `{ status, error, domains, retry }`, which Home's cards and the drawer's Domains group both read (outside the provider it throws). It asks for `GET /api/notes/index` first; a 404 there makes the status `missing`, with nothing else requested. Otherwise it asks for every hub (`GET /api/notes?type=hub&limit=500`) and the tag counts (`GET /api/tags`) together, and `buildDomains` turns the root hub's links into one `Domain` per link that is a hub: its slug, title, and updated date; its `tag`, the hub's tag named like its slug, or else its first tag; `count`, the number of notes carrying that tag; and `subHubs`, the other hubs carrying the tag (never `index` or another domain), by title. A link to a plain note or to a missing slug is skipped. Any failed request makes the status `error`, and `retry` asks again for all of it. `DomainAvatar` is the domain's first letter on a round secondary-container avatar, 24px in the drawer and 40px on a card. `DomainCard` is one domain as an M3 filled card (`surface-container-highest`, 12px corners, no border or shadow) that opens the hub when clicked anywhere: the 40px avatar, the title (`TextLink` `card`, stretched over the card), "updated <date>", the sub-hubs as `NoteChip`s, and a text button "<count> notes" to the tag page. The chips and the button sit above the card's link, so each opens its own page.

## Home

`pages/home.tsx` is titled "Home" (the tab reads "notes++") with no description. Below the large window class it is one column; from 1200px a main column sits beside a 22rem supporting pane, which scrolls with the page because Recent can grow past the screen. Sections sit 32px apart, each under a `SectionHeading`.

- **Main column.** Domains, with an "Open index" text button at the right of its heading that opens the root hub (shown once the domains load): one `DomainCard` per domain, one column, two once the column is 36rem wide. While they load, placeholder bars; with no root hub, the "No root hub yet" info notice; with no hub links, "No domains yet." Then Pinned (see `pins.tsx`). Home no longer renders the root hub's own text; "Open index" reaches it.
- **Supporting pane.** Recent (see `recent-notes.tsx`); then Bookmarks, one `LinkRow` per group from `GET /api/bookmarks`, the name with hyphens as spaces and its note count, opening `/bookmarks#<bookmarkGroupId>`, and left out when there are no groups or the request fails; then Stats, three `LinkRow`s, Notes, Files, and Invalid notes, opening Tags, Files, and Check, with the invalid count in the error colour once it is above 0.
- **Errors.** One `ErrorAlert` stands for the domains and the stats: in the Domains spot when the domains failed, otherwise in the Stats spot. Its Try again reloads whichever failed, the domains through `useDomains().retry` and the stats through their own reload.

## note-actions-menu.tsx

`NoteActionsMenu` (`note`, `pinnedList`, `onRemovedFromList`, `size`) is the three-dot menu for one note. It is the only importer of `ui/dropdown-menu`. The note page header, every note card and note row (search results, the Tag page, Backlinks, the Bookmarks page, Home's Pinned and Recent sections), and each sidebar pin use it.

- **Trigger.** A standard icon button with `EllipsisVertical` in on-surface-variant, named "More actions for <title>". `size="default"` is 40px, for cards and headers; `size="small"` is 32px, for a pinned row in a navigation drawer.
- **Items.** "Pin to Home" and "Pin to sidebar" are checkbox items, checked while pinned. After a separator comes "Bookmark", which opens `BookmarkAssignment`'s dialog (see `bookmarks.tsx`). With `pinnedList`, a separator and "Move up" and "Move down" follow, the first disabled for the top pin and the second for the bottom one. With `bookmarkOrder` (`group`, `index`, `count`, `onMove`), a separator and "Move up in <group>" and "Move down in <group>" follow, disabled the same way; the Bookmarks page passes it while its sort is Manual order. After another separator comes "Export as".
- **Keyboard.** Radix handles the keys: Enter, Space, or ArrowDown opens the menu, the arrow keys move through it, and Escape closes it. After an item runs, focus goes back to the trigger with `preventScroll`, so toggling a pin never moves the page.
- **Not modal.** The page behind an open menu stays readable by screen readers and scrollable, and nothing locks the page's scrolling. A click or Tab outside closes the menu and leaves focus where it went.
- **A row that removes itself.** Unpinning a note from the list its menu sits in removes the menu's own row. `usePinnedListFocus(count)` returns `listRef`, for the element around the rows, and `rowRemoved(index)`, for that row's `onRemovedFromList`. Focus then moves to the menu button of the row that took its place, or of the new last row.
- **Bookmark groups.** `GroupActionsMenu` (`name`, `index`, `count`, `onMove`) is the three-dot menu for a group on the Bookmarks page, here so the page does not import the primitive: "Move up" and "Move down", the first disabled for the top group and the second for the bottom one.

## Export

"Export as" in `NoteActionsMenu` opens a submenu, on hover, with ArrowRight, or with Enter, that holds "PDF" and "Markdown". `lib/export-note.ts` does the work. It is the only module that makes an object URL (`URL.createObjectURL`).

- **Markdown** (`exportMarkdown`). A temporary same-origin link with a `download` attribute fetches `GET /api/notes/:slug/export.md`, the file as stored, and the toast reads "Downloaded <slug>.md".
- **PDF** (`exportPdf`). A loading toast reads "Preparing PDF of <title>…" while `GET /api/notes/:slug/export.pdf` runs.
  - On 200, the blob is saved through an object URL under the name from `Content-Disposition` (the UTF-8 `filename*` first, then `filename`, then `<title>.pdf`), the URL is revoked, and the toast turns into "Downloaded <file name>".
  - On 503 `pdf_unavailable`, the print page opens in a new tab with `?autoprint=1` and the toast turns into "Opening the print dialog; choose Save as PDF". If the browser blocks the tab, the toast gets an "Open print page" button.
  - On any other error, the toast gives "Could not export <title> as PDF" with the server's message.
  - While one PDF export of a note runs, the PDF item in every menu for that note is disabled with `aria-busy` and a spinner, and another export of it does nothing.

## bookmarks.tsx

Bookmark groups are named lists of note slugs in `bookmarks.yml` (DECISIONS.md, 2026-09-23). Group names are slugs ("fields-sales"); every screen shows them with the hyphens as spaces ("fields sales").

- `BookmarkAssignment` (`note`) is the Bookmark item in `NoteActionsMenu`: a text button that opens an M3 basic dialog titled "Bookmark “<title>”", with a checkbox row per group (checked where the note already is), a "New bookmark group" field with an "Add to new group" icon button, then Cancel and Save.
- `NewGroupDialog` (`onCreated`) is the Bookmarks page's tonal "New group" button and its basic dialog: a "Group name" field, then Cancel and Create text buttons. Create is disabled while the field is blank or the request runs, and Enter in the field submits. On success it hands the server's lists to `onCreated`, toasts "Bookmark group created", and closes, and focus goes back to the button. When the server refuses, its message shows as an error toast and the dialog stays open.
- `bookmarkGroupId(name)` is a group's section id on the Bookmarks page, `bookmark-group-<name>`. A link to `/bookmarks#bookmark-group-<name>` opens that group.
- `bookmarkGroupNotes(group, notes)` returns the group's notes in the group's order, skipping slugs that are not among `notes`.

### The Bookmarks page

`pages/bookmarks.tsx` loads `GET /api/bookmarks` and `GET /api/notes?limit=500`, and shows placeholder bars until both answer. If either fails, an `ErrorAlert` takes the page's place, and its Try again reloads the one that failed.

- **Header.** "Bookmarks", the group count as `aside` ("2 groups"), and `NewGroupDialog` in `actions`. With no groups the page reads "No bookmark groups yet." and the header still offers New group.
- **Toolbar.** Right-aligned under the header, shown while there are groups: the sort chip ("Manual order", the default, "Title A to Z", "Recently added", "Recently updated") and the `ViewSwitch`.
- **Groups.** Each group is a `section` with the `bookmarkGroupId` id, with an `outline-variant` divider between groups. Its first row is an M3 list subheader inside an `h2`: one 56px button with `aria-expanded` that opens and closes the group (folder icon, the name in title-medium, the note count, the chevron), then `GroupActionsMenu`, whose moves send `PUT /api/bookmarks/order`. From the medium window class the open group's notes are indented 40px, so they start under the group's name.
- **Views.** Each shows a different amount of each note:
  - list: `NoteRow`s with the title alone
  - details: `NoteRow`s with the summary as the supporting line and "updated <date>" as trailing text
  - tiles: compact `NoteCard`s (title and kind) in a grid, 1 column, 2 from the medium window class, 3 from large
  - content: `ItemCard`s with the summary, the tags as `TagBadges`, and "created <date>" and "updated <date>"

  Every note keeps its `NoteActionsMenu`, with `bookmarkOrder` while the sort is Manual order; a move sends `PUT /api/bookmarks/:group/order`. A failed move is taken back and shows an error toast.
- **An empty group** reads "No notes in this group." and "Choose Bookmark in a note's three-dot menu to add it here."
- **Remembered.** The view, the sort, and which groups are open live in local storage under `notesplusplus.bookmarks.preferences`. With nothing saved, every group starts open.
- **Links to a group.** When the page opens with `#bookmark-group-<name>`, that group opens even if it was saved closed, and the page scrolls to it once its notes have rendered. This happens once per history entry, so closing the group afterwards sticks. `scroll-mt-20` keeps the group's row clear of the top app bar.

## Print page

`/print/notes/:slug` (`pages/print-note.tsx`) is one note as it prints. The server's headless Edge opens it to make the PDF, and the browser's print dialog uses it when Edge cannot start. It sits outside the layout, so it has no sidebar, top bar, breadcrumbs, menus, backlinks, or toasts, and it loads nothing but the note.

It shows the title (`PageHeader`), the type (`KindBadge`), the summary (`Callout`), the tags as `TagName` text, the created and updated dates (`MetaList`), and the body: `NoteBody` with `print`, or `SourceBody` for a source.

`NoteBody`'s `print` mode changes four things and nothing else:

- a wikilink, or any other link into the app, is its text; links to sites stay links
- a mentioned path is code, with break points, and no Open or Show in folder
- diagrams have no "Show source" toggle
- images load at once instead of lazily

**Ready to print.** The page sets `data-print-ready="true"` on the root element once the note has rendered, every diagram and image has finished (`RenderTrackerProvider` and `useRenderPending` in `render-tracker.tsx`; `Diagram` and the print image register while they draw), and the fonts have loaded. When the note fails to load it sets `data-print-ready="error"` and `data-print-error` to the message. `lib/print-ready.ts` is the only module that writes those attributes, and the page removes them when it unmounts. With `?autoprint=1` it calls `window.print()` once, when ready.

**Print styles** (`index.css`). The server renders the page 1024px wide and prints A4 with 18mm top, 20mm bottom, and 16mm side margins, which leaves 178mm for text. `.print-sheet` is 178mm wide on screen too, so a table measures the width it prints at and chooses its layout from that: a note table with 5 columns of short cells stays a table. `.print-page` is always the light scheme, even when Windows is dark (theme.css keeps the light roles under it), on `surface-container-lowest` (white), Roboto at 11pt on a 1.45 line, with no shadows, and figures and tables drop their `surface` background for the `outline-variant` border alone. Under `@media print`, table rows, figures, diagrams, callouts, and code blocks do not break across pages, headings are not left at the bottom of a page, and a diagram taller than 230mm shrinks to fit. A source's text may break across pages, since a transcript can run for many.

## kbd.tsx

Every keycap. It is the only module that renders a `<kbd>` element.

- `Kbd` for one key, written as it should read ("Alt", not "ALT"): the app font in label-medium (12px, medium weight) in on-surface-variant, 20px tall, 6px side padding, a 1px outline-variant border, the extra-small (4px) corner, on surface-container.
- `KbdGroup` (`keys`) for keys pressed together, 4px apart. The search field's shortcut hint uses it.

## page-state.tsx

- `LoadingBlock` for placeholder bars while something loads.
- `ErrorAlert` for an API error or the "server not reachable" hint, built on `Notice` with the danger tone. `onRetry` adds a small outlined "Try again" button inside the notice, under the message. Every page that loads data passes it: `reload` from `lib/use-async.ts`, or `retry` from `lib/use-paged-list.ts` on the Tag page, which fetches the page that failed again. Retrying shows the loading state, then the result in the notice's place. Where one notice stands for several requests, its retry reloads each one that failed: the note page reloads the note plus its backlinks and trail, Home the domains plus the stats. The Inbox form's "Could not add" notice has no retry; the form is resubmitted instead.
- `EmptyState` for an empty list: one centred line in `text-body-medium` `on-surface-variant`.
- `NotFoundState` (`title`, `message`, `value`) for the note 404 and the not-found page: Home breadcrumbs, the title, one sentence ending in the missing value as code, and a tonal "Back home" button that is a link to `/`.

## What the architecture test enforces

It scans every `.ts` and `.tsx` file under `src` except `components/ui/`, plus `src/index.css`. Each rule also has fixtures in the test that prove it flags the pattern.

| Rule | Allowed only in | Use instead |
|---|---|---|
| import `@/components/ui/table` | `data-table.tsx` | `DataTable` |
| import `@/components/ui/badge` | `badges.tsx` | `KindBadge`, `TagBadge`, `StatusBadge`, ... |
| import `@/components/ui/card` | `item-card.tsx` | `ItemCard`, `SectionCard`, ... |
| import `@/components/ui/alert` | `notice.tsx` | `Notice`, `ErrorAlert` |
| import `@/components/ui/dropdown-menu` | `note-actions-menu.tsx` | `NoteActionsMenu` |
| import `@/components/ui/breadcrumb` | `breadcrumbs.tsx` | `PageHeader` with `breadcrumbs` |
| `<Breadcrumbs` | `page-header.tsx` | `PageHeader` with `breadcrumbs` |
| import `react-markdown` | `note-body.tsx` | `NoteBody` |
| import `mermaid`, static or dynamic | `diagram.tsx` | `Diagram`, or a fenced `mermaid` block in a note |
| `ExternalLinkIcon` | `text-link.tsx` | `TextLink` with `href` |
| a `/api/files/...` or `/api/local-file` URL in a string, or calling `fileUrl(`, `localFileUrl(`, or `viewUrlFor(` | nowhere | `FileActions`, `FileLink` |
| `URL.createObjectURL` | `lib/export-note.ts` | `exportPdf`, `exportMarkdown` |
| table elements, `role="table"` or `"grid"`, `createElement("table")` | `data-table.tsx` | `DataTable` |
| `<h1` | `page-header.tsx` | `PageHeader`, or `SectionHeading` for a section |
| `<kbd`, `createElement("kbd")` | `kbd.tsx` | `Kbd`, `KbdGroup` |
| a `<Button>` whose label or attributes say "show more", "load more", "see more", or "view more" | `show-more.tsx` | `ShowMore` |
| `hover:underline` | `text-link.tsx` | `TextLink` |
| writing `document.title` | `lib/page-title.ts` | `PageHeader` with `title` or `tabTitle` |
| `overflow-x-auto`, `overflow-x-scroll`, `overflow-auto`, `overflow-scroll`, `overflowX`, `overflow: "auto"` | nowhere | `DataTable` and `BreakableText` |
| Tailwind palette colours (`text-red-600`, `bg-blue-50`, ...) | nowhere | a token class from `index.css` |
| hex colours, `rgb(`, `rgba(`, `hsl(`, `oklch(` | nowhere | a token in `index.css` |
| a colour class in `className` on `<Button`, `<Alert`, or `<Badge` | `badges.tsx`, `notice.tsx` | a Button variant, `Notice` tone, or a badge component |
| horizontal scrolling in `index.css` | `pre` and `code` rules | wrapping |
