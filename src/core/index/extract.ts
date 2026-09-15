/**
 * Text extraction for files under files/.
 *
 * pdf via unpdf, docx via mammoth, pptx via jszip (slide XML), xlsx/xlsm via
 * exceljs, plain-text types read as UTF-8, everything else yields empty text
 * and is indexed by filename only. Every extractor is wrapped: a broken file
 * produces "" and never throws.
 */

import fs from "node:fs/promises";

/** Extracted text is capped here so one huge file cannot bloat the index. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Rows emitted per worksheet before the rest is dropped. */
export const MAX_SHEET_ROWS = 5000;

const TEXT_EXTS = new Set(["txt", "md", "markdown", "csv", "json", "srt", "vtt", "log"]);

export async function extractFileText(absolutePath: string, ext: string): Promise<string> {
  try {
    const kind = ext.toLowerCase();
    let text = "";
    if (TEXT_EXTS.has(kind)) {
      text = await fs.readFile(absolutePath, "utf8");
    } else if (kind === "pdf") {
      text = await extractPdf(absolutePath);
    } else if (kind === "docx") {
      text = await extractDocx(absolutePath);
    } else if (kind === "pptx") {
      text = await extractPptx(absolutePath);
    } else if (kind === "xlsx" || kind === "xlsm") {
      text = await extractXlsx(absolutePath);
    }
    return cap(text);
  } catch {
    return "";
  }
}

async function extractPdf(absolutePath: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const buffer = await fs.readFile(absolutePath);
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

async function extractDocx(absolutePath: string): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const buffer = await fs.readFile(absolutePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// ---- pptx -----------------------------------------------------------------

/**
 * Output, one block per slide in numeric file order, blocks separated by a
 * blank line:
 *
 *   ## Slide 1
 *   <one line per paragraph>
 *   Notes:
 *   <one line per notes paragraph>      (only when the slide has notes)
 */
async function extractPptx(absolutePath: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const buffer = await fs.readFile(absolutePath);
  const zip = await JSZip.loadAsync(buffer);

  const slidePattern = /^ppt\/slides\/slide(\d+)\.xml$/;
  const slides = Object.keys(zip.files)
    .map((name) => ({ name, n: Number(slidePattern.exec(name)?.[1]) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);

  const blocks: string[] = [];
  for (const [i, slide] of slides.entries()) {
    const xml = await zip.file(slide.name)?.async("string");
    if (xml === undefined) continue;
    const lines = [`## Slide ${i + 1}`, ...drawingParagraphs(xml)];

    const notesName = await notesSlideFor(zip, slide.n);
    const notesXml = notesName ? await zip.file(notesName)?.async("string") : undefined;
    if (notesXml !== undefined) {
      const notes = drawingParagraphs(notesXml);
      if (notes.length > 0) lines.push("Notes:", ...notes);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/**
 * The notes part for a slide is named in the slide's relationships file.
 * Fall back to the same-numbered notesSlide when the rels are missing.
 */
async function notesSlideFor(
  zip: { file(name: string): { async(type: "string"): Promise<string> } | null },
  slideNumber: number,
): Promise<string | null> {
  const rels = await zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`)?.async("string");
  const target = rels ? /Target="(?:\.\.\/)?notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1] : undefined;
  const candidate = `ppt/notesSlides/${target ?? `notesSlide${slideNumber}.xml`}`;
  return zip.file(candidate) ? candidate : null;
}

/**
 * Paragraph text from DrawingML: runs (`<a:t>`) inside one `<a:p>` are joined
 * with nothing, empty paragraphs are dropped. Field placeholders such as the
 * slide-number field on notes pages are stripped first.
 */
function drawingParagraphs(xml: string): string[] {
  const withoutFields = xml.replace(/<a:fld\b[^>]*>[\s\S]*?<\/a:fld>/g, "");
  const out: string[] = [];
  for (const para of withoutFields.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const runs = [...(para[1] ?? "").matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1] ?? ""));
    const line = runs.join("").trim();
    if (line) out.push(line);
  }
  return out;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body] ?? whole;
  });
}

// ---- xlsx / xlsm ----------------------------------------------------------

/**
 * Output, one block per worksheet, blocks separated by a blank line:
 *
 *   ## Sheet: <name>
 *   <cell> | <cell> | <cell>            (one line per non-empty row)
 */
async function extractXlsx(absolutePath: string): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolutePath);

  const blocks: string[] = [];
  for (const sheet of workbook.worksheets) {
    const lines = [`## Sheet: ${sheet.name}`];
    let emitted = 0;
    sheet.eachRow((row) => {
      if (emitted >= MAX_SHEET_ROWS) return;
      const cells: string[] = [];
      row.eachCell((cell) => cells.push(cellText(cell)));
      const line = cells.join(" | ").trim();
      if (!line) return;
      lines.push(line);
      emitted++;
    });
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

interface CellLike {
  value: unknown;
  text: string;
}

function cellText(cell: CellLike): string {
  const value = cell.value;
  if (value instanceof Date) return isoDate(value);
  if (value && typeof value === "object" && "result" in value && value.result instanceof Date) {
    return isoDate(value.result);
  }
  const text = cell.text;
  if (typeof text === "string") return text;
  return value === null || value === undefined ? "" : String(value);
}

function isoDate(d: Date): string {
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// ---- shared ---------------------------------------------------------------

function cap(text: string): string {
  if (typeof text !== "string") return "";
  if (Buffer.byteLength(text, "utf8") <= MAX_TEXT_BYTES) return text;
  // Cut on characters, then trim until the byte budget fits.
  let out = text.slice(0, MAX_TEXT_BYTES);
  while (Buffer.byteLength(out, "utf8") > MAX_TEXT_BYTES) {
    out = out.slice(0, Math.floor(out.length * 0.9));
  }
  return out;
}
