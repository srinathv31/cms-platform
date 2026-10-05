import type { ConvertResult, ImportKind } from "@/domain/import-types";
import { convertDocx } from "./docx";
import type { IsolationOptions } from "./isolate";
import { convertPdf } from "./pdf";
import { convertTxt } from "./txt";

/**
 * The converter for a sniffed kind. Never throws: a file it can't make sense of is `unreadable`.
 * .docx and .pdf parse in a worker thread (isolate.ts); `isolation` overrides its limits (tests).
 */
export async function convertFile(kind: ImportKind, bytes: Uint8Array, isolation?: IsolationOptions): Promise<ConvertResult> {
  try {
    if (kind === "docx") return await convertDocx(bytes, isolation);
    if (kind === "pdf") return await convertPdf(bytes, isolation);
    return convertTxt(bytes);
  } catch (error) {
    console.error(`Import: the ${kind} converter failed`, error);
    return { ok: false, code: "unreadable" };
  }
}
