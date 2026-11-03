# notes++ UI design system

The web UI follows Material Design 3 (https://m3.material.io). This file records how notes++ applies it. Where it is silent, the M3 spec decides.

## 0. Research log

- 2026-11-03: the owner installed `@material/web` and asked for Material 3 throughout, in light and dark (DECISIONS.md, "The web UI uses Material 3, in light and dark").
- `@material/web` 2.5 has buttons, fields, menus, chips, lists, tabs, and dialogs, but no navigation drawer or rail, card, table, tooltip, or snackbar. The app already had a Radix component layer that every behavior test runs against, so that layer stays and wears the M3 specs; `@material/web` supplies `md-ripple` only.
- Earlier references still hold for density: the Windows File Explorer view menu and the #fields tag page.

## 1. Product atmosphere

A local reference shelf for reading. Notes sit on the `surface` role in the body-large type role, with navigation in a drawer on `surface-container-low`. Colour goes to the active destination, the one action that moves work forward, and the kind and status labels.

## 2. Color

`web/scripts/theme.ts` generates every colour role from one source colour, #1A73E8, with the tonal spot scheme at standard contrast, and writes `web/src/theme.css`: a light scheme on `:root` and a dark one under `prefers-color-scheme: dark`. The print page always takes the light roles. `npm run theme` regenerates the file, and `test/m3-tokens.test.ts` fails while the file and the script disagree. To try another colour or scheme variant, change `SOURCE` or the scheme class in the script.

Success (#188038) and warning (#F9AB00) are extended colours, harmonized toward the source, each with `color`, `on-color`, `color-container`, and `on-color-container` roles.

`index.css` maps the roles to Tailwind (`bg-surface-container-low`, `text-on-surface-variant`, `border-outline-variant`) and adds app tokens that name what they colour: `kind-{note,hub,source,file}-{bg,fg}` on the primary, success, warning, and tertiary containers; `status-{neutral,success,warning,danger}-{bg,fg}`; and `mark` for search hits. Components use these, never hex values. `test/contrast.test.ts` checks every text pair at 4.5:1 and the outline and focus indicator at 3:1, in both schemes.

## 3. Typography

The M3 type scale, as Tailwind classes that set size, line height, tracking, and weight together: `text-display-*`, `text-headline-*`, `text-title-*`, `text-body-*`, `text-label-*`, each in large, medium, and small. Roboto 400, 500, and 700 ship inside the build.

| Use | Role |
|---|---|
| Page title (the one h1) | headline-medium |
| Section heading, markdown h2 | title-large |
| Card title | title-medium |
| Note text, body default | body-large |
| Supporting text, summaries | body-medium in on-surface-variant |
| Metadata | body-small or label-medium in on-surface-variant |
| Buttons, chips, nav items | label-large |
| Table header and cell | title-small and body-medium |

## 4. Spacing and layout

A 4px rhythm. Layout follows the M3 window size classes, available as Tailwind variants: compact below 600px (no prefix), `medium:` from 600px, `expanded:` from 840px, `large:` from 1200px, `extra-large:` from 1600px.

| Window | Navigation |
|---|---|
| Compact | top app bar with a menu button that opens the modal navigation drawer |
| Medium | navigation rail; its menu button opens the modal drawer, which also holds the pins |
| Expanded and up | standard navigation drawer with the destinations and the pins |

The content column is capped at 52rem, 80rem on a note page with its outline. Primary content never scrolls sideways. Touch targets are at least 48 by 48px.

## 5. Components

Each control is the M3 component and variant for its emphasis.

- **Buttons.** `Button` takes `variant` filled (the one action that moves work forward), tonal, outlined, text, elevated, or standard (an icon button with no container), and `size` default (40px), small (32px), icon (40px round), or icon-small (32px round).
- **Text fields.** Outlined text fields, 56px. Search fields are the M3 search bar: a full-round `surface-container-high` field with a leading search icon.
- **Menus.** `surface-container`, extra-small shape, elevation level 2, 48px items.
- **Cards.** Outlined cards for lists of notes and search results; filled cards for Home's stats.
- **Chips.** Tag links are assist chips. Type and sort pickers are chips that open a menu.
- **Segmented buttons.** The search mode switch and the view switch.
- **Dialogs.** The bookmark dialog is an M3 basic dialog: headline-small title, text-button actions on the right.
- **Labels.** Kind and status pills are small labels on their app tokens, not M3 notification badges.
- **Feedback.** Toasts are snackbars on `inverse-surface`. Tooltips are plain tooltips. Notices sit on the secondary, success, warning, or error container.

### View switch
- Structure: icon-only segmented buttons in a group named "View".
- Variants: list, details, tiles, content.
- States: selected (`secondary-container`), hover and pressed (state layer), focus, disabled.
- Accessibility: `aria-label` on the group and a pressed or selected state on each segment.

### Bookmark assignment dialog
- Structure: M3 basic dialog with the title, a checkbox list of groups, a new-group field, then Cancel and Save text buttons.
- States: loading, empty, selected, error.
- Accessibility: dialog heading, labelled controls, keyboard focus trap.

### Bookmark card
- Structure: title link, kind label, summary, tags and date metadata, actions.
- Variants: list, details, tiles, content.
- States: default, hover, focus.
- Accessibility: the title link is the primary target; the menu has an accessible name.

## 6. Motion and interaction

Hover, focus, and pressed states are M3 state layers. `<Ripple />` (`components/ui/ripple.tsx`, wrapping `md-ripple`) draws the hover layer at 8% and the pressed layer at 10% in the control's content colour, plus the press ripple. Radix menu items add a 10% layer while keyboard-highlighted. Easing uses `ease-standard`, with `ease-emphasized-decelerate` for things entering and `ease-emphasized-accelerate` for things leaving. Under `prefers-reduced-motion` every animation ends at once.

## 7. Depth and surface

Depth comes from surface-container tones first. A shadow (`shadow-level1` to `shadow-level5`) appears only where the M3 component spec gives one: filled and tonal buttons on hover, elevated buttons and cards, menus, the modal drawer, dialogs, and snackbars. Dividers and outlined cards use `outline-variant`; control boundaries use `outline`.

## 8. Accessibility constraints and accepted debt

WCAG 2.2 AA in both schemes, the M3 focus indicator on every focusable element (3px in the secondary role, 2px outside it), full keyboard access, and no horizontal scroll in primary content. No accepted debt.
