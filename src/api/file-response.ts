import fs from "node:fs";
import { Readable } from "node:stream";
import type { Context } from "hono";

const TEXT = "text/plain; charset=utf-8";

// Markup (html, xhtml, xml) is served as plain text so a file can never run script on this origin.
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  txt: TEXT,
  md: TEXT,
  csv: TEXT,
  json: TEXT,
  log: TEXT,
  html: TEXT,
  htm: TEXT,
  xhtml: TEXT,
  xml: TEXT,
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
};

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export function contentTypeFor(filePath: string): string {
  const name = baseName(filePath);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** `inline` (or `attachment`) with an ASCII fallback name and the real name in RFC 5987 form. */
export function contentDisposition(fileName: string, type: "inline" | "attachment" = "inline"): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export type ByteRange = { start: number; end: number };

/**
 * One `bytes=a-b`, `bytes=a-`, or `bytes=-n` range against a file of `size` bytes, end inclusive.
 * null means serve the whole file: no header, or one this server ignores (malformed, several ranges, b < a).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (header === undefined) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const [, first = "", last = ""] = m;
  if (first === "" && last === "") return null;
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (last !== "" && Number(last) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: last === "" ? size - 1 : Math.min(Number(last), size - 1) };
}

/**
 * Stream a file the caller has already checked. Always inline with nosniff; svg also gets a sandbox CSP
 * so its script cannot run. Honors a single Range so video and audio can seek.
 */
export function fileResponse(c: Context, abs: string, size: number): Response {
  const contentType = contentTypeFor(abs);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(baseName(abs)),
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  if (contentType === "image/svg+xml") headers["Content-Security-Policy"] = "sandbox";

  const range = parseRange(c.req.header("range"), size);
  if (range === "unsatisfiable") {
    const body = JSON.stringify({ error: { code: "range_not_satisfiable", message: `range outside ${size} bytes` } });
    return new Response(body, {
      status: 416,
      headers: { ...headers, "Content-Type": "application/json", "Content-Range": `bytes */${size}` },
    });
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  headers["Content-Length"] = String(end - start + 1);
  // Hono answers HEAD by dropping the GET body, so never open a stream nobody will read.
  const stream =
    c.req.method === "HEAD" || size === 0 ? null : (Readable.toWeb(fs.createReadStream(abs, { start, end })) as unknown as ReadableStream);
  return new Response(stream, { status: range ? 206 : 200, headers });
}
