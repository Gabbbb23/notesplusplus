/**
 * Text extraction for files under files/.
 *
 * pdf via unpdf, docx via mammoth, plain-text types read as UTF-8, everything
 * else yields empty text and is indexed by filename only. Every extractor is
 * wrapped: a broken file produces "" and never throws.
 */

import fs from "node:fs/promises";

/** Extracted text is capped here so one huge file cannot bloat the index. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

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
