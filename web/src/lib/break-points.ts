/*
 * Where a long path, slug, file name, or URL may wrap. Shared by BreakableText and by the
 * note-table cell step (rehype-table-cell-text.ts), so both break at the same places.
 */

/** A break is always offered after these, even between two digits. */
const ALWAYS_BREAK_AFTER = new Set(["/", "\\", "_", "?", "&", "="]);

/** A break is offered after these unless both neighbours are digits: "2026-09-14", "12.00", "1,500", "17:52". */
const BREAK_AFTER_UNLESS_BETWEEN_DIGITS = new Set(["-", ".", ",", ":"]);

/** A final file extension: a dot, 1 to 5 letters or digits, then the end of the string. */
const FINAL_EXTENSION = /\.[A-Za-z0-9]{1,5}$/;

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * Split text into pieces that each end at a break point. Joining the pieces gives the text back.
 *
 * - Always after / \ _ ? & =
 * - After - . , : unless both neighbours are digits
 * - Never before a final file extension, so "report.docx" keeps ".docx" with its name
 * - Never at the end of the text or before whitespace, where the line can already break
 */
export function breakPieces(text: string): string[] {
  const extension = FINAL_EXTENSION.exec(text);
  // Break positions at or after this index would split the extension from its name.
  const noBreakFrom = extension ? extension.index : text.length;
  const pieces: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const always = ALWAYS_BREAK_AFTER.has(c);
    if (!always && !BREAK_AFTER_UNLESS_BETWEEN_DIGITS.has(c)) continue;
    const next = text[i + 1];
    if (next === undefined || /\s/.test(next)) continue;
    if (i + 1 >= noBreakFrom) continue;
    if (!always && isDigit(text[i - 1]) && isDigit(next)) continue;
    pieces.push(text.slice(start, i + 1));
    start = i + 1;
  }
  pieces.push(text.slice(start));
  return pieces;
}
