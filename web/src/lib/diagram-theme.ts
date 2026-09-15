/*
 * The colours a mermaid diagram draws with, taken from the app's CSS tokens at runtime so a
 * figure matches the page without a colour written in source. components/diagram.tsx reads the
 * tokens and passes these variables to mermaid's "base" theme.
 */

export interface DiagramTokens {
  /** --foreground */
  text: string;
  /** --muted-foreground */
  mutedText: string;
  /** --border */
  border: string;
  /** --card */
  card: string;
  /** --primary */
  primary: string;
  /** The body's font-family. */
  fontFamily: string;
}

/** The custom properties each token comes from. */
export const TOKEN_PROPERTIES: Record<Exclude<keyof DiagramTokens, "fontFamily">, string> = {
  text: "--foreground",
  mutedText: "--muted-foreground",
  border: "--border",
  card: "--card",
  primary: "--primary",
};

/** Read the tokens from computed styles: custom properties from the root, the font from the body. */
export function readDiagramTokens(root: Element, body: Element): DiagramTokens {
  const rootStyle = getComputedStyle(root);
  const read = (property: string) => rootStyle.getPropertyValue(property).trim();
  return {
    text: read(TOKEN_PROPERTIES.text),
    mutedText: read(TOKEN_PROPERTIES.mutedText),
    border: read(TOKEN_PROPERTIES.border),
    card: read(TOKEN_PROPERTIES.card),
    primary: read(TOKEN_PROPERTIES.primary),
    fontFamily: getComputedStyle(body).fontFamily,
  };
}

/** Mermaid colours up to 12 sections (THEME_COLOR_LIMIT); a timeline gives each period its own. */
const SECTION_SLOTS = 12;

/**
 * The same variable for every section slot. Timeline periods sit on the primary colour with card
 * text, so no period gets one of mermaid's derived greys with white text on it.
 */
function sectionScale(t: DiagramTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (let i = 0; i < SECTION_SLOTS; i++) {
    vars[`cScale${i}`] = t.primary;
    vars[`cScaleLabel${i}`] = t.card;
    vars[`cScaleInv${i}`] = t.primary;
    vars[`cScalePeer${i}`] = t.primary;
  }
  return vars;
}

/**
 * Mermaid "base" theme variables. Shapes sit on the card colour with a primary outline and text in
 * the text colour; lines, grid, and secondary outlines use the muted text and border colours.
 * primaryColor stays the primary token so mermaid derives its slice scale (pie) from the app's blue.
 */
export function diagramThemeVariables(t: DiagramTokens): Record<string, string> {
  return {
    ...sectionScale(t),
    background: t.card,
    fontFamily: t.fontFamily,
    fontSize: "14px",

    primaryColor: t.primary,
    primaryTextColor: t.text,
    primaryBorderColor: t.primary,
    secondaryColor: t.card,
    secondaryTextColor: t.text,
    secondaryBorderColor: t.border,
    tertiaryColor: t.card,
    tertiaryTextColor: t.text,
    tertiaryBorderColor: t.border,

    mainBkg: t.card,
    nodeBkg: t.card,
    nodeBorder: t.primary,
    nodeTextColor: t.text,
    textColor: t.text,
    titleColor: t.text,
    lineColor: t.mutedText,
    arrowheadColor: t.mutedText,
    edgeLabelBackground: t.card,
    clusterBkg: t.card,
    clusterBorder: t.border,
    noteBkgColor: t.card,
    noteTextColor: t.text,
    noteBorderColor: t.border,

    actorBkg: t.card,
    actorBorder: t.primary,
    actorTextColor: t.text,
    actorLineColor: t.mutedText,
    signalColor: t.text,
    signalTextColor: t.text,
    labelBoxBkgColor: t.card,
    labelBoxBorderColor: t.border,
    labelTextColor: t.text,
    loopTextColor: t.text,

    sectionBkgColor: t.card,
    altSectionBkgColor: t.card,
    sectionBkgColor2: t.card,
    gridColor: t.border,
    taskBkgColor: t.primary,
    taskBorderColor: t.primary,
    taskTextColor: t.card,
    taskTextLightColor: t.card,
    taskTextDarkColor: t.text,
    taskTextOutsideColor: t.text,
    activeTaskBkgColor: t.card,
    activeTaskBorderColor: t.primary,
    doneTaskBkgColor: t.border,
    doneTaskBorderColor: t.mutedText,
    critBkgColor: t.card,
    critBorderColor: t.text,
    todayLineColor: t.primary,
    vertLineColor: t.mutedText,

    scaleLabelColor: t.card,
    pieTitleTextColor: t.text,
    pieSectionTextColor: t.card,
    pieLegendTextColor: t.text,
    pieStrokeColor: t.card,
    pieOuterStrokeColor: t.border,
  };
}

/**
 * Extra CSS for rules the theme variables cannot reach, again only from tokens. A timeline's
 * events become cards (card fill, border outline, text colour, a primary underline) under their
 * blue period, without mermaid's brightness filter; its axis line takes the muted text colour
 * instead of the period label colour, which would be invisible on the card.
 */
export function diagramThemeCss(t: DiagramTokens): string {
  return [
    `.eventWrapper { filter: none; }`,
    `.eventWrapper path, .eventWrapper rect { fill: ${t.card}; stroke: ${t.border}; stroke-width: 1px; }`,
    `.eventWrapper text { fill: ${t.text}; }`,
    `.eventWrapper line { stroke: ${t.primary}; }`,
    `.lineWrapper line { stroke: ${t.mutedText}; }`,
  ].join("\n");
}
