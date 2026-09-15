/**
 * Print the text the index would extract from a file. Useful for agents that need to read
 * a document before writing notes about it.
 *
 *   npx tsx src/cli/extract.ts <path> [--max <chars>]
 */
import path from "node:path";
import { extractFileText } from "../core/index/extract.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: tsx src/cli/extract.ts <path> [--max <chars>]");
  process.exit(2);
}
const maxIdx = args.indexOf("--max");
const max = maxIdx >= 0 ? Number.parseInt(args[maxIdx + 1] ?? "", 10) : Number.POSITIVE_INFINITY;

const abs = path.resolve(file);
const ext = path.extname(abs).slice(1).toLowerCase();
const text = await extractFileText(abs, ext);
if (!text) {
  console.error(`(no text extracted from ${abs}; extension "${ext}" may be unsupported or the file may be image-only)`);
  process.exit(1);
}
process.stdout.write(Number.isFinite(max) ? text.slice(0, max) : text);
process.stdout.write("\n");
