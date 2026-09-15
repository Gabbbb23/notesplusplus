/**
 * The one keyboard focus style: a solid 2px outline in the ring colour, 2px outside the element,
 * following its corners. It is `focus-visible`, so a mouse click on a button draws nothing.
 *
 * Every interactive primitive in components/ui (button, input, select, textarea, toggle, toggle
 * group, tabs, the sheet's close button, badge links, breadcrumb links) and TextLink carry it.
 * index.css gives any other focusable element the same outline.
 *
 * An outline rather than a box-shadow ring, so it still shows in Windows contrast themes.
 * `outline-solid` is part of it because Tailwind's `outline-none` would otherwise leave the
 * outline style at none.
 */
export const FOCUS_RING =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
