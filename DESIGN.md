# notes++ UI design system

## 0. Research Log

- Existing UI extraction: light Google-white surfaces, Roboto, blue links, compact bordered cards, and a fixed sidebar.
- User references: Windows File Explorer view menu and the existing #fields tag page define the new view switch and list density.

## 1. Product atmosphere

A quiet local reference shelf: dense enough for scanning, with white cards on a cool grey page and blue reserved for navigation and actions. The signature is one consistent card system that can change density without changing meaning.

## 2. Color

Existing CSS custom properties are the source of truth: `--background`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--input`, `--primary`, `--link`, and `--accent`.

## 3. Typography

Roboto 400, 500, and 700 with Segoe UI fallback. Body text is 16px; compact metadata is 14px; page titles are 24px semibold; labels are 12px to 14px.

## 4. Spacing & layout

Use the existing 4px rhythm. The content column is capped at 52rem. Cards use 16px padding, lists use 16px gaps, and controls use 8px gaps. Primary content never scrolls sideways.

## 5. Components

### View switch
- Structure: labelled segmented control with one icon button per view.
- Variants: list, details, tiles, content.
- States: selected, hover, focus, disabled.
- Accessibility: `aria-label` on the group and `aria-pressed` on each button.

### Bookmark assignment dialog
- Structure: modal title, group checkbox list, new-group input, cancel/save actions.
- States: loading, empty, selected, error.
- Accessibility: dialog heading, labelled controls, keyboard focus trap.

### Bookmark card
- Structure: title link, type badge, summary, tags/date metadata, actions.
- Variants: list, details, tiles, content.
- States: default, hover, focus.
- Accessibility: title link is the primary target; menu has an accessible name.

## 6. Motion & interaction

Use existing Tailwind transitions for color and opacity. No layout animation. Respect `prefers-reduced-motion` through the existing global styles.

## 7. Depth & surface

Borders-only. Cards use `--border`; selected controls use `--accent`; popovers use `--popover` and the existing shadow token.

## 8. Accessibility constraints & accepted debt

WCAG 2.2 AA, visible keyboard focus, full keyboard access, and no horizontal scroll in primary content. No new accepted debt.
