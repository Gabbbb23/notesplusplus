/*
 * The colours a mermaid diagram draws with, taken from the M3 colour roles at runtime so a figure
 * matches the page, in the light scheme and the dark one, without a colour written in source.
 * components/diagram.tsx reads the roles and passes these variables to mermaid's "base" theme, and
 * draws again when the system scheme changes.
 */

export interface DiagramTokens {
  /** on-surface */
  text: string;
  /** on-surface-variant */
  mutedText: string;
  /** outline-variant */
  border: string;
  /** surface: the figure behind the diagram. */
  surface: string;
  /** surface-container: shapes, notes, and timeline events. */
  container: string;
  /** primary */
  primary: string;
  /** on-primary */
  onPrimary: string;
  /** primary-container */
  primaryContainer: string;
  /** on-primary-container */
  onPrimaryContainer: string;
  /** The body's font-family. */
  fontFamily: string;
}

/** The custom properties each token comes from. */
export const TOKEN_PROPERTIES: Record<Exclude<keyof DiagramTokens, "fontFamily">, string> = {
  text: "--md-sys-color-on-surface",
  mutedText: "--md-sys-color-on-surface-variant",
  border: "--md-sys-color-outline-variant",
  surface: "--md-sys-color-surface",
  container: "--md-sys-color-surface-container",
  primary: "--md-sys-color-primary",
  onPrimary: "--md-sys-color-on-primary",
  primaryContainer: "--md-sys-color-primary-container",
  onPrimaryContainer: "--md-sys-color-on-primary-container",
};

/** Read the tokens from computed styles: the colour roles from the root, the font from the body. */
export function readDiagramTokens(root: Element, body: Element): DiagramTokens {
  const rootStyle = getComputedStyle(root);
  const read = (property: string) => rootStyle.getPropertyValue(property).trim();
  return {
    text: read(TOKEN_PROPERTIES.text),
    mutedText: read(TOKEN_PROPERTIES.mutedText),
    border: read(TOKEN_PROPERTIES.border),
    surface: read(TOKEN_PROPERTIES.surface),
    container: read(TOKEN_PROPERTIES.container),
    primary: read(TOKEN_PROPERTIES.primary),
    onPrimary: read(TOKEN_PROPERTIES.onPrimary),
    primaryContainer: read(TOKEN_PROPERTIES.primaryContainer),
    onPrimaryContainer: read(TOKEN_PROPERTIES.onPrimaryContainer),
    fontFamily: getComputedStyle(body).fontFamily,
  };
}

/** Mermaid colours up to 12 sections (THEME_COLOR_LIMIT); a timeline gives each period its own. */
const SECTION_SLOTS = 12;

/**
 * The same variables for every section slot. Timeline periods sit on primary with on-primary
 * labels, so no period gets one of mermaid's derived colours with a label it cannot be read on.
 */
function sectionScale(t: DiagramTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (let i = 0; i < SECTION_SLOTS; i++) {
    vars[`cScale${i}`] = t.primary;
    vars[`cScaleLabel${i}`] = t.onPrimary;
    vars[`cScaleInv${i}`] = t.primary;
    vars[`cScalePeer${i}`] = t.primary;
  }
  return vars;
}

/**
 * Mermaid "base" theme variables. Shapes sit on surface-container with a primary outline and
 * on-surface text; lines, grid, and secondary outlines use on-surface-variant and outline-variant.
 * primaryColor stays primary so mermaid derives its slice scale (pie) from the scheme's primary.
 */
export function diagramThemeVariables(t: DiagramTokens): Record<string, string> {
  return {
    ...sectionScale(t),
    background: t.surface,
    fontFamily: t.fontFamily,
    fontSize: "14px",

    primaryColor: t.primary,
    primaryTextColor: t.text,
    primaryBorderColor: t.primary,
    secondaryColor: t.container,
    secondaryTextColor: t.text,
    secondaryBorderColor: t.border,
    tertiaryColor: t.surface,
    tertiaryTextColor: t.text,
    tertiaryBorderColor: t.border,

    mainBkg: t.container,
    nodeBkg: t.container,
    nodeBorder: t.primary,
    nodeTextColor: t.text,
    textColor: t.text,
    titleColor: t.text,
    lineColor: t.mutedText,
    arrowheadColor: t.mutedText,
    edgeLabelBackground: t.surface,
    clusterBkg: t.surface,
    clusterBorder: t.border,
    noteBkgColor: t.primaryContainer,
    noteTextColor: t.onPrimaryContainer,
    noteBorderColor: t.primaryContainer,

    actorBkg: t.container,
    actorBorder: t.primary,
    actorTextColor: t.text,
    actorLineColor: t.mutedText,
    signalColor: t.text,
    signalTextColor: t.text,
    labelBoxBkgColor: t.container,
    labelBoxBorderColor: t.border,
    labelTextColor: t.text,
    loopTextColor: t.text,

    sectionBkgColor: t.surface,
    altSectionBkgColor: t.surface,
    sectionBkgColor2: t.surface,
    gridColor: t.border,
    taskBkgColor: t.primary,
    taskBorderColor: t.primary,
    taskTextColor: t.onPrimary,
    taskTextLightColor: t.onPrimary,
    taskTextDarkColor: t.text,
    taskTextOutsideColor: t.text,
    activeTaskBkgColor: t.primaryContainer,
    activeTaskBorderColor: t.primary,
    doneTaskBkgColor: t.border,
    doneTaskBorderColor: t.mutedText,
    critBkgColor: t.container,
    critBorderColor: t.text,
    todayLineColor: t.primary,
    vertLineColor: t.mutedText,

    scaleLabelColor: t.onPrimary,
    pieTitleTextColor: t.text,
    pieSectionTextColor: t.onPrimary,
    pieLegendTextColor: t.text,
    pieStrokeColor: t.surface,
    pieOuterStrokeColor: t.border,
  };
}

/**
 * Extra CSS for rules the theme variables cannot reach, again only from tokens. A timeline's
 * events sit on surface-container with an outline-variant edge and a primary underline, under their
 * primary period, without mermaid's brightness filter; its axis line takes on-surface-variant
 * instead of the period label colour, which would vanish against the surface.
 */
export function diagramThemeCss(t: DiagramTokens): string {
  return [
    `.eventWrapper { filter: none; }`,
    `.eventWrapper path, .eventWrapper rect { fill: ${t.container}; stroke: ${t.border}; stroke-width: 1px; }`,
    `.eventWrapper text { fill: ${t.text}; }`,
    `.eventWrapper line { stroke: ${t.primary}; }`,
    `.lineWrapper line { stroke: ${t.mutedText}; }`,
  ].join("\n");
}
