import type { ConvertResult, ImportKind } from "@/domain/import-types";
import { normalizeDocument } from "@/editor/model/normalize";
import { convertDocx } from "./docx";
import type { IsolationOptions } from "./isolate";
import { convertPdf } from "./pdf";
import { convertTxt } from "./txt";

/**
 * The converter for a sniffed kind. Never throws: a file it can't make sense of is `unreadable`.
 * .docx and .pdf parse in a worker thread (isolate.ts); `isolation` overrides its limits (tests).
 * The body comes back normalized like a saved document (docs/render-spec.md §3: tabs as spaces,
 * headings ≤ 3, cells holding paragraphs and lists, wide tables split, links checked).
 */
export async function convertFile(kind: ImportKind, bytes: Uint8Array, isolation?: IsolationOptions): Promise<ConvertResult> {
  try {
    const result = await convert(kind, bytes, isolation);
    return result.ok ? { ...result, file: { ...result.file, body: normalizeDocument(result.file.body) } } : result;
  } catch (error) {
    console.error(`Import: the ${kind} converter failed`, error);
    return { ok: false, code: "unreadable" };
  }
}

function convert(kind: ImportKind, bytes: Uint8Array, isolation?: IsolationOptions): Promise<ConvertResult> | ConvertResult {
  if (kind === "docx") return convertDocx(bytes, isolation);
  if (kind === "pdf") return convertPdf(bytes, isolation);
  return convertTxt(bytes);
}
