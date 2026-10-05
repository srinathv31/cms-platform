import type { ConvertResult, ImportKind } from "@/domain/import-types";
import { convertDocx } from "./docx";
import { convertPdf } from "./pdf";
import { convertTxt } from "./txt";

/** The converter for a sniffed kind. Never throws: a file it can't make sense of is `unreadable`. */
export async function convertFile(kind: ImportKind, bytes: Uint8Array): Promise<ConvertResult> {
  try {
    if (kind === "docx") return await convertDocx(bytes);
    if (kind === "pdf") return await convertPdf(bytes);
    return convertTxt(bytes);
  } catch (error) {
    console.error(`Import: the ${kind} converter failed`, error);
    return { ok: false, code: "unreadable" };
  }
}
