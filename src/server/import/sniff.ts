import type { ImportKind } from "@/domain/import-types";

// What kind of file an upload is, decided from its bytes (never from the MIME type the browser
// sent): docx = a zip holding word/document.xml; pdf = starts with "%PDF-"; txt = valid UTF-8 with
// no NUL bytes and a .txt name. Anything else is refused (`refusalForUnreadableKind` in the domain says which sentence).

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

const startsWith = (bytes: Uint8Array, magic: readonly number[]) => magic.every((b, i) => bytes[i] === b);

/** True when `needle` (ASCII) occurs in the bytes. Zip entry names are stored as plain bytes. */
export function hasAscii(bytes: Uint8Array, needle: string): boolean {
  const pattern = new TextEncoder().encode(needle);
  const first = pattern[0];
  outer: for (let i = bytes.indexOf(first); i !== -1 && i <= bytes.length - pattern.length; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return true;
  }
  return false;
}

/** The text of a UTF-8 file (a BOM is fine), or null when it isn't valid UTF-8 or holds a NUL byte. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

export function sniffKind(bytes: Uint8Array, filename: string): ImportKind | null {
  if (startsWith(bytes, ZIP)) return hasAscii(bytes, "word/document.xml") ? "docx" : null;
  if (startsWith(bytes, PDF)) return "pdf";
  if (/\.txt$/i.test(filename.trim()) && decodeText(bytes) !== null) return "txt";
  return null;
}
