import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_DOCUMENT_CHARS = 80_000;
const MAX_TOTAL_CHARS = 160_000;

export type ExtractedDocument = { path: string; text: string };

export function formatAttachmentContext(documents: ExtractedDocument[]) {
  return documents.map((document) => `[Attached document: ${basename(document.path)}]\n${document.text}`).join("\n\n");
}

export async function extractDocuments(paths: string[]) {
  const extracted: ExtractedDocument[] = [];
  let total = 0;
  for (const path of paths.slice(0, 10)) {
    const extension = extname(path).toLowerCase();
    let text = "";
    if (extension === ".txt" || extension === ".md" || extension === ".markdown") {
      text = await readFile(path, "utf8");
    } else if (extension === ".docx") {
      text = (await mammoth.extractRawText({ path })).value;
    } else if (extension === ".pdf") {
      const parser = new PDFParse({ data: await readFile(path) });
      text = (await parser.getText()).text;
      await parser.destroy();
    } else {
      throw new Error(`${basename(path)} is not a supported document.`);
    }
    const bounded = text.replace(/\0/g, "").slice(0, Math.min(MAX_DOCUMENT_CHARS, MAX_TOTAL_CHARS - total));
    if (bounded) extracted.push({ path, text: bounded });
    total += bounded.length;
    if (total >= MAX_TOTAL_CHARS) break;
  }
  return formatAttachmentContext(extracted);
}
