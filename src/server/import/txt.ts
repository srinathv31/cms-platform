import { IMPORT_LIMITS, type ConvertResult } from "@/domain/import-types";
import { textToBody } from "@/domain/import";
import { decodeText } from "./sniff";

// .txt → paragraphs (src/domain/import.ts: textToBody). The bytes were sniffed as UTF-8 already.

export function convertTxt(bytes: Uint8Array): ConvertResult {
  const text = decodeText(bytes);
  if (text === null) return { ok: false, code: "unreadable" };
  if (text.length > IMPORT_LIMITS.maxChars) return { ok: false, code: "tooLong" };
  const body = textToBody(text);
  if (!body.content?.length) return { ok: false, code: "empty" };
  return { ok: true, file: { kind: "txt", body, dropped: [] } };
}
