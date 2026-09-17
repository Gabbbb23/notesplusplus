# Shared components

Pages compose these components. They never restyle tables, badges, cards, links, alerts, headings, metadata, or long text on their own, so a design change made in one of these files reaches every page that uses it. `test/architecture.test.ts` makes `npm test` fail when code under `src` (outside `ui/`) breaks one of the rules listed at the end of this file.

The shadcn primitives in `ui/` are the raw material. Only the module named below may import each one. When a primitive's own look should change for everyone, such as the Button default colours, change it in `ui/`.

## Accessibility basics

These hold for every page, and `npm test` checks each of them.

- **Contrast.** Colours are tokens in `src/index.css`, and `test/contrast.test.ts` computes WCAG ratios from them. Text reaches 4.5:1 and control boundaries and focus outlines 3:1, on both the page (#F8F9FA) and cards (white).
  - `--link` (#1967D2, `text-link`) is the link blue: 5.09:1 on the page, 5.37:1 on a card. `--link-hover` (#185ABC) is one step darker. `--primary` (#1A73E8) stays for filled buttons, where white text sits on it.
  - `--input` (#80868B, `border-input`) is the border of an input, select, textarea, or toggle: 3.49:1 on the page, 3.68:1 on a card. Card, table, and divider hairlines keep `--border` (#DADCE0); they are not control boundaries.
  - Every tinted pair reaches 4.5:1, and the test renders each `Notice` tone and each `KindBadge`, `StatusBadge`, and `FileTypeBadge` to check the classes they use. `--success` is Google Green 800 (#137333): 5.24:1 on the green tint, for the success notice and the hub and success badges. `--kind-source-fg` (#9E5600) is one step darker than Google Orange 900 on the same hue: 5.18:1 on the yellow tint, for the warning notice and the source and warning badges. A notice's message uses its title colour at full strength; a translucent `/90` would drop it below 4.5:1.
- **Focus.** `FOCUS_RING` in `lib/focus-ring.ts` is the one keyboard focus style: a solid 2px outline in `--ring` (#1A73E8, 4.27:1 on the page), 2px outside the element, following its corners. It uses `focus-visible`, so a mouse click on a button shows nothing. Button, Input, SelectTrigger, Textarea, Toggle, ToggleGroupItem, TabsTrigger, the Sheet close button, Badge links, BreadcrumbLink, the DropdownMenu items (plain, checkbox, radio, and submenu triggers), and `TextLink` carry it; a `:focus-visible` rule in `index.css` gives the same outline to anything else that takes focus, such as the sidebar links. A new interactive primitive adds `FOCUS_RING` to its classes.
- **Motion.** Under `prefers-reduced-motion: reduce`, one rule set in `index.css` ends every animation and transition at once: spinners and skeletons stand still, and the sheet appears without sliding.
- **Font.** Roboto 400, 400 italic, 500, and 700 ship inside the build from `@fontsource/roboto` (imported in `main.tsx`), so nothing loads from the network. Text set at 600 (`font-semibold`) draws with the 700 face. The stack is `Roboto, "Segoe UI", system-ui, sans-serif`; code uses `Consolas, "Cascadia Mono", ui-monospace, Menlo, monospace`.

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
- `href` for a site, opened in a new tab with `rel="noopener noreferrer"` and the external-link icon.
- `variant`: `inline` (default, inherits size and weight), `strong` (medium weight), `title` (card title), or `muted` (breadcrumbs: muted text that turns foreground on hover, and a hit area at least 24px tall).
- Every variant but `muted` is `text-link`, turning `text-link-hover` and underlined on hover. Every variant has `FOCUS_RING` and a 4px radius, so the focus outline has soft corners.
- String children wrap through `BreakableText`.

## file-actions.tsx

Every control that acts on a file a note mentions, so every page offers the same two actions the same way. A file is either a brain path (`files/...`) or an absolute Windows path outside the brain (`C:\...`); `lib/file-kinds.ts` holds the extension list that decides whether Open shows. The server enforces the same list.

No page shows a file in a browser tab. The View link is gone (DECISIONS.md, 2026-09-15, "File buttons are Open and Show in folder only"), and the architecture test flags any source that builds a `/api/files/...` or `/api/local-file` URL.

- `FileActions` (`path`, `name`, `size`) for the controls on their own, such as the Files table's action column:
  - Open, a button that opens the file in its default Windows app. It shows only for document, media, and archive types, never for programs or scripts. A path with no extension counts as a folder and shows "Open folder".
  - Show in folder, a button that opens File Explorer with the file selected. It always shows, last, so in the Files table's end-aligned column it lines up in every row.
  - `size="default"` gives outline buttons with a label. `size="compact"` gives icon buttons with a tooltip, to sit after a line of text.
  - Every control's accessible name includes the file name ("Open Module 1.pdf in its default app"). A button is disabled while its request runs, and the result shows as a toast.
- `FileLink` (`path`, `name`, `code`) for a file named in running text: the path or name through `BreakableText`, then the compact `FileActions`. The actions follow the last line of the text and move below it as a group when they do not fit. `code` shows the text as code. The note header's Files, file search results, and local paths in note bodies use it.

In a note body, `NoteBody` takes the note's `mentions` from the server, and `lib/rehype-local-paths.ts` marks the inline code whose text is one of them; `note-body.tsx` renders it through `FileLink`, in lists and table cells alike (in print mode, as code with no buttons). The web has no path rule of its own: the server decides what a mention is and opens only those paths, so a button never leads to a refusal. Code blocks, other inline code (a path the server does not list included), and code inside a link stay as they are. Pass `mentions={[]}` for markdown that is not a note body.

## Wikilinks

`lib/remark-wikilinks.ts` turns `[[slug]]` and `[[slug|label]]` into links to `/notes/slug`, rendered through `TextLink`. It works on the syntax tree that `remark-gfm` builds and looks only in text, so nothing inside inline code (any number of backticks), a ```` ``` ```` or `~~~` fence, an indented code block, or a markdown link's text becomes a link. The server reads links with the same rule, so every rendered link is one the server counts for backlinks, trails, and hub membership. In a table cell the label's pipe must be escaped (`[[slug\|label]]`), or GFM splits the cell there. On the print page a wikilink is its label as plain text.

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
  - `actions` puts controls at the right end of the title row, such as `NoteActionsMenu`. They sit beside the title link, never inside it, so clicking one does not follow the link. A long title wraps beside them while they stay in the top right corner; negative margins let the 32px menu button share the 24px title line without making the card taller.
- `CardList` stacks cards with the standard gap.
- `SectionCard` for a titled block with an optional count, such as a Check section or the Inbox form. The Check page has one per list in `GET /api/check-links`: broken links, missing files, missing sources, invalid notes, notes no hub lists, notes listed by more than one hub (each with links to those hubs), and pins to missing notes (each slug as code, since there is no note to link to). Any entry in any list withholds "All clear".
- `StatCard` for a number with a label on Home.
- `LoadingCards` for card-shaped placeholders.

`note-card.tsx` and `search-results.tsx` are built on `ItemCard`:

- `NoteCard` (`note`, `actions`) shows a note's title, type, summary, tags, and updated date. With `compact`, it shows the title and type only and takes a `NoteRef` (slug, title, type); Home's Pinned and Recent sections use it.
- `NoteList` gives every card its `NoteActionsMenu`. The Tag page and a note's Backlinks use it.
- `SearchResultCard` gives a note result its `NoteActionsMenu` and a file result none. `SearchResults` opens with a count line: "20 results for “ryzen”", or "More than 20 results for “ryzen”" when its `hasMore` is set.

## show-more.tsx

The one way a list grows in place. No page builds its own "Show more" button.

- `ShowMore` (`label`, `loading`, `progress`, `onClick`) goes under the list, 16px below it. It renders an outline `Button` with a chevron, plus the optional `progress` text ("Showing 50 of 93") beside it in muted 14px, which the button names as its description. While `loading`, the button stays where it is, disabled and `aria-busy`, and the chevron turns into a spinner of the same size, so nothing moves.
- `ShowMoreLimit` is a muted line in the button's place for a list that stops at a cap.
- `useFocusFirstNew(count, listKey)` returns `listRef`, for the element around the cards, and `expectMore()`, to call on click. Once more `ItemCard`s render than there were at the click, focus moves to the first link or button in the first new card, so a keyboard user carries on from the new rows. A different `listKey` (a new query or tag) drops the pending focus.

Where it is used:

- **Search** asks for 20 results. When the response says `hasMore`, "Show more results" re-runs the same query with the limit raised by 20, up to 100; an offset would let the ranking shift between batches. The rows on screen stay while the bigger batch loads, and placeholders show only for a new query. The limit sits in the URL as `n` (left out at 20), replaced rather than pushed, so Back from a note restores the longer list and leaves the search in one step. At 100 with `hasMore`, `ShowMoreLimit` reads "Showing the top 100. Refine the search to narrow it."
- **Tag page** loads 50 notes at a time through `offset` with `lib/use-paged-list.ts`. The header count comes from the response's `total` ("93 notes"), and "Show more notes" carries "Showing 50 of 93" until every note is loaded.

The Tags page needs neither: `GET /api/tags` carries each tag's count, so it is one request.

## recent-notes.tsx

`RecentNotes` is Home's "Recent" section: what was filed lately, so the newest note is one click from Home instead of a search away. Home is its only caller.

- It asks for `GET /api/notes?sort=created&limit=50` once, groups those notes by their `created` date, and shows each day under an `h3` of the date plus a muted detail line ("today · 3 notes", "yesterday · 1 note", "2 notes" on older days). Rows are compact `NoteCard`s with their `NoteActionsMenu`, so a new note can be pinned or exported from Home.
- It orders by `created`, not `updated`: the section answers "what is new", and a note edited today does not come back to the top.
- Eight notes show at first; `ShowMore` reveals eight more from the batch already fetched, so no request follows a click. Once the batch is fully shown and the brain holds more, `ShowMoreLimit` names the cap ("Showing the newest 50 notes of 191.").
- A failed load shows an `ErrorAlert` with Try again, which re-runs only this request. An empty brain renders nothing at all, so a new brain shows just the root hub notice.

## meta.tsx

Small muted details about a thing.

- `MetaList` with `MetaItem` (`label`, children) for a label and value grid: the note header's tags, dates, path, sources, and files.
- `MetaRow` for one wrapping line of details: a card's tags and date, the Home hub's tags, date, and "open as note" link.

## page-header.tsx

`PageHeader` goes at the top of every page, Home included, and owns the page's only `h1`. It takes `title`, `tabTitle`, `description`, `aside` (a count on the right), `badge` (after the title), `actions`, `breadcrumbs` (the items for `Breadcrumbs`, shown above the title row), and children for extra rows such as note metadata. Every page uses the same 24px heading.

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
- **The figure.** A card-like `figure` with the SVG scaled to the content width (never wider, never scrolling), and a ghost "Show source" button with `aria-expanded` that reveals the source as a code block. `print` leaves the button out.
- **Errors.** When mermaid cannot parse or draw the diagram, a warning `Notice` titled "This diagram could not be drawn" shows the parser's first error line and the source.
- **Done drawing.** Inside a `RenderTrackerProvider` (`render-tracker.tsx`), a diagram counts as drawing from mount until it is drawn or has failed. The print page waits for that count to reach zero.

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

## pins.tsx

The owner's pins: notes, hubs, or sources pinned to Home, to the sidebar, or both. The server keeps them in `pins.yml` in the brain, and the web UI may write that one file (DECISIONS.md, 2026-09-15, "Pins live in the brain and the web UI may write them").

`PinsProvider` is mounted once, in `layout.tsx`, the same way `SearchShortcutProvider` is. It loads `GET /api/pins` once and holds the one copy that every menu, Home's Pinned section, and the sidebar read. `usePins()` returns:

- `lists`: `{ home, sidebar }`, each a list of `NoteRef` in pin order.
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

- **Home.** A "Pinned" section under the header, above the stats, the Recent section, and the root hub's content: a `SectionHeading` and compact `NoteCard`s in pin order. Each card's menu adds Move up and Move down. With no Home pins the section does not render.
- **Sidebar.** A "Pinned" group under the page links (a `nav` named "Pinned"), in the desktop sidebar and the mobile Sheet alike. Each row is a link with a type icon (note, hub, source) and the title, cut at two lines with an ellipsis (`line-clamp-2`); the full title stays the link's accessible name and its tooltip. The current note's link gets the page links' active colours from the same `navStateClass`. Each row has a small `NoteActionsMenu` at its right, shown on hover, while the row holds focus, while its menu is open, and always on devices without hover; that menu is where a sidebar pin is moved or unpinned. With no sidebar pins the group does not render. The sidebar's link area scrolls up and down when the pins outgrow the screen, never sideways.

## note-actions-menu.tsx

`NoteActionsMenu` (`note`, `pinnedList`, `onRemovedFromList`, `size`) is the three-dot menu for one note. It is the only importer of `ui/dropdown-menu`. The note page header, every note card (search results, the Tag page, Backlinks, Home's Pinned and Recent sections), and each sidebar pin use it.

- **Trigger.** A ghost icon button with `EllipsisVertical`, named "More actions for <title>". `size="default"` is 32px, for cards and headers; `size="small"` is 24px, for a sidebar row.
- **Items.** "Pin to Home" and "Pin to sidebar" are checkbox items, checked while pinned. With `pinnedList`, a separator and "Move up" and "Move down" follow, the first disabled for the top pin and the second for the bottom one. After another separator comes "Export as".
- **Keyboard.** Radix handles the keys: Enter, Space, or ArrowDown opens the menu, the arrow keys move through it, and Escape closes it. After an item runs, focus goes back to the trigger with `preventScroll`, so toggling a pin never moves the page.
- **Not modal.** The page behind an open menu stays readable by screen readers and scrollable, and nothing locks the page's scrolling. A click or Tab outside closes the menu and leaves focus where it went.
- **A row that removes itself.** Unpinning a note from the list its menu sits in removes the menu's own row. `usePinnedListFocus(count)` returns `listRef`, for the element around the rows, and `rowRemoved(index)`, for that row's `onRemovedFromList`. Focus then moves to the menu button of the row that took its place, or of the new last row.

## Export

"Export as" in `NoteActionsMenu` opens a submenu, on hover, with ArrowRight, or with Enter, that holds "PDF" and "Markdown". `lib/export-note.ts` does the work. It is the only module that makes an object URL (`URL.createObjectURL`).

- **Markdown** (`exportMarkdown`). A temporary same-origin link with a `download` attribute fetches `GET /api/notes/:slug/export.md`, the file as stored, and the toast reads "Downloaded <slug>.md".
- **PDF** (`exportPdf`). A loading toast reads "Preparing PDF of <title>…" while `GET /api/notes/:slug/export.pdf` runs.
  - On 200, the blob is saved through an object URL under the name from `Content-Disposition` (the UTF-8 `filename*` first, then `filename`, then `<title>.pdf`), the URL is revoked, and the toast turns into "Downloaded <file name>".
  - On 503 `pdf_unavailable`, the print page opens in a new tab with `?autoprint=1` and the toast turns into "Opening the print dialog; choose Save as PDF". If the browser blocks the tab, the toast gets an "Open print page" button.
  - On any other error, the toast gives "Could not export <title> as PDF" with the server's message.
  - While one PDF export of a note runs, the PDF item in every menu for that note is disabled with `aria-busy` and a spinner, and another export of it does nothing.

## Print page

`/print/notes/:slug` (`pages/print-note.tsx`) is one note as it prints. The server's headless Edge opens it to make the PDF, and the browser's print dialog uses it when Edge cannot start. It sits outside the layout, so it has no sidebar, top bar, breadcrumbs, menus, backlinks, or toasts, and it loads nothing but the note.

It shows the title (`PageHeader`), the type (`KindBadge`), the summary (`Callout`), the tags as `TagName` text, the created and updated dates (`MetaList`), and the body: `NoteBody` with `print`, or `SourceBody` for a source.

`NoteBody`'s `print` mode changes four things and nothing else:

- a wikilink, or any other link into the app, is its text; links to sites stay links
- a mentioned path is code, with break points, and no Open or Show in folder
- diagrams have no "Show source" toggle
- images load at once instead of lazily

**Ready to print.** The page sets `data-print-ready="true"` on the root element once the note has rendered, every diagram and image has finished (`RenderTrackerProvider` and `useRenderPending` in `render-tracker.tsx`; `Diagram` and the print image register while they draw), and the fonts have loaded. When the note fails to load it sets `data-print-ready="error"` and `data-print-error` to the message. `lib/print-ready.ts` is the only module that writes those attributes, and the page removes them when it unmounts. With `?autoprint=1` it calls `window.print()` once, when ready.

**Print styles** (`index.css`). The server renders the page 1024px wide and prints A4 with 18mm top, 20mm bottom, and 16mm side margins, which leaves 178mm for text. `.print-sheet` is 178mm wide on screen too, so a table measures the width it prints at and chooses its layout from that: a note table with 5 columns of short cells stays a table. `.print-page` is white, Roboto at 11pt on a 1.45 line, with no shadows, and figures and tables drop their card background for the hairline border alone. Under `@media print`, table rows, figures, diagrams, callouts, and code blocks do not break across pages, headings are not left at the bottom of a page, and a diagram taller than 230mm shrinks to fit. A source's text may break across pages, since a transcript can run for many.

## kbd.tsx

Every keycap. It is the only module that renders a `<kbd>` element.

- `Kbd` for one key, written as it should read ("Alt", not "ALT"): the app font at 12px medium, muted, 20px tall, 6px side padding, a 1px border, a 4px radius, and the card background.
- `KbdGroup` (`keys`) for keys pressed together, 4px apart. The search field's shortcut hint uses it.

## page-state.tsx

- `LoadingBlock` for grey bars while something loads.
- `ErrorAlert` for an API error or the "server not reachable" hint, built on `Notice` with the danger tone. `onRetry` adds a "Try again" outline button inside the notice, under the message. Every page that loads data passes it: `reload` from `lib/use-async.ts`, or `retry` from `lib/use-paged-list.ts` on the Tag page, which fetches the page that failed again. Retrying shows the loading state, then the result in the notice's place. Where one notice stands for several requests, its retry reloads each one that failed: the note page reloads the note plus its backlinks and trail, Home the hub plus the stats. The Inbox form's "Could not add" notice has no retry; the form is resubmitted instead.
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
