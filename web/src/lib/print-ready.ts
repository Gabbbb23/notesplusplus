/*
 * How the print page tells the server it can be printed. The server's headless Edge waits for the
 * root element's data-print-ready to become "true" (print now) or "error" (the note did not load,
 * with the reason in data-print-error). This is the only module that writes those attributes.
 */

export type PrintState = { ready: "true" } | { ready: "error"; error: string };

export function setPrintState(state: PrintState): void {
  const { dataset } = document.documentElement;
  dataset.printReady = state.ready;
  if (state.ready === "error") dataset.printError = state.error;
  else delete dataset.printError;
}

/** Remove both attributes, when the print page goes away. */
export function clearPrintState(): void {
  const { dataset } = document.documentElement;
  delete dataset.printReady;
  delete dataset.printError;
}

/** Resolves once the fonts the page uses have loaded, so the PDF never falls back to another typeface. */
export function fontsLoaded(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  return fonts ? fonts.ready.then(() => undefined) : Promise.resolve();
}
