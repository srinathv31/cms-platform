// The Import row's client side: the checks it can make before sending (the same limits the server
// applies, so a file we know will be refused never makes a request, and the console stays clean),
// and the upload itself to `POST /api/imports`. The server still decides: it sniffs the bytes.

import { IMPORT_LIMITS, IMPORT_REFUSALS, type ImportResponse } from "@/domain/import-types";

/** The names the server accepts (a .txt must also be named so; .docx and .pdf are then sniffed). */
const ACCEPTED_NAME = /\.(docx|pdf|txt)$/i;

/** Shown when the request itself fails (no answer from the server), not a refusal. */
export const IMPORT_FAILED = "Couldn't import the file. Try again.";

/** Why this file would be refused, from what the browser knows (name and size); null when it may go. */
export function precheckImport(file: Pick<File, "name" | "size">): string | null {
  // A legacy Word file is the one refusal with a way forward.
  if (/\.doc$/i.test(file.name.trim())) return IMPORT_REFUSALS.legacyDoc;
  if (!ACCEPTED_NAME.test(file.name)) return IMPORT_REFUSALS.type;
  if (file.size === 0) return IMPORT_REFUSALS.empty;
  if (file.size > IMPORT_LIMITS.maxBytes) return IMPORT_REFUSALS.size;
  return null;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b]; // PK: a .docx is a zip

/**
 * Whether the first bytes are what the name claims: a .pdf starts "%PDF", a .docx is a zip ("PK").
 * A file that isn't is refused here, so a renamed picture never makes a request the server will
 * refuse (and the console stays clean). The server still sniffs the whole file. A .txt has no magic.
 */
export async function precheckImportBytes(file: Pick<Blob, "slice"> & { name: string }): Promise<string | null> {
  const pdf = /\.pdf$/i.test(file.name.trim());
  const docx = /\.docx$/i.test(file.name.trim());
  if (!pdf && !docx) return null;
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  } catch {
    return null; // Unreadable here: let the server say.
  }
  const magic = pdf ? PDF_MAGIC : ZIP_MAGIC;
  if (magic.every((byte, i) => head[i] === byte)) return null;
  return pdf ? IMPORT_REFUSALS.notPdf : IMPORT_REFUSALS.notWord;
}

/**
 * Sends the file to be imported into a new template on `teamSlug`. A refusal comes back as
 * `{ ok: false, code, reason }`, with an import refusal code (`IMPORT_REFUSALS`, or `permission`).
 */
export async function uploadImport(file: File, teamSlug: string): Promise<ImportResponse> {
  const form = new FormData();
  form.set("file", file);
  // The team goes in the query: the server checks the permission before it reads the body.
  const response = await fetch(`/api/imports?team=${encodeURIComponent(teamSlug)}`, { method: "POST", body: form });
  try {
    return (await response.json()) as ImportResponse;
  } catch {
    return { ok: false, code: "unreadable", reason: IMPORT_FAILED };
  }
}
