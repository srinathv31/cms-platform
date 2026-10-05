import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ORIGINAL_BASENAME, UPLOADS_SUBDIR, type ImportKind, type ImportReport } from "@/domain/import-types";

// Where an import's files live (./data/uploads stands in for Azure Blob):
//
//   <root>/<uploadId>/original.<docx|pdf|txt>   the file exactly as uploaded
//   <root>/<uploadId>/compare.html              docx only: the allowlisted Compare view
//   <root>/<uploadId>/report.json               the ImportReport
//
// Every path is built from a checked upload id and fixed names: the client's file name never
// reaches the file system. `root` defaults to ./data/uploads; tests point it at a temp folder.

const UPLOAD_ID = /^up_[0-9a-z]{10}$/;
const STORED_PATH = /^(up_[0-9a-z]{10})\/original\.(docx|pdf|txt)$/;

export const COMPARE_FILE = "compare.html";
export const REPORT_FILE = "report.json";

export function defaultUploadsRoot(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), UPLOADS_SUBDIR);
}

function folder(root: string, uploadId: string): string {
  if (!UPLOAD_ID.test(uploadId)) throw new Error("Invalid upload id");
  return path.join(/*turbopackIgnore: true*/ root, uploadId);
}

/** `uploads.path` for an original: "<uploadId>/original.<ext>", relative to the root. */
export function originalPath(uploadId: string, kind: ImportKind): string {
  if (!UPLOAD_ID.test(uploadId)) throw new Error("Invalid upload id");
  return `${uploadId}/${ORIGINAL_BASENAME}.${kind}`;
}

/** The kind an `uploads.path` names, or null when the path isn't one this store wrote. */
export function kindOfPath(stored: string): ImportKind | null {
  return (STORED_PATH.exec(stored)?.[2] as ImportKind | undefined) ?? null;
}

export interface UploadFiles {
  uploadId: string;
  kind: ImportKind;
  bytes: Uint8Array;
  compareHtml?: string;
  report: ImportReport;
}

/** Writes an upload's folder. Returns `uploads.path`. */
export async function writeUpload(files: UploadFiles, root = defaultUploadsRoot()): Promise<string> {
  const dir = folder(root, files.uploadId);
  await mkdir(dir, { recursive: true });
  const stored = originalPath(files.uploadId, files.kind);
  await writeFile(path.join(/*turbopackIgnore: true*/ root, stored), files.bytes);
  if (files.compareHtml !== undefined) await writeFile(path.join(/*turbopackIgnore: true*/ dir, COMPARE_FILE), files.compareHtml, "utf8");
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, REPORT_FILE), JSON.stringify(files.report), "utf8");
  return stored;
}

/** Removes an upload's folder (the transaction that would have recorded it failed). */
export async function removeUpload(uploadId: string, root = defaultUploadsRoot()): Promise<void> {
  await rm(folder(root, uploadId), { recursive: true, force: true });
}

/** The original's bytes, by its `uploads.path`; null when missing or not a path this store wrote. */
export async function readOriginal(stored: string, root = defaultUploadsRoot()): Promise<Uint8Array | null> {
  if (!STORED_PATH.test(stored)) return null;
  return readFile(path.join(/*turbopackIgnore: true*/ root, stored)).then((b) => new Uint8Array(b), () => null);
}

export async function readCompareHtml(uploadId: string, root = defaultUploadsRoot()): Promise<string | null> {
  return readFile(path.join(/*turbopackIgnore: true*/ folder(root, uploadId), COMPARE_FILE), "utf8").catch(() => null);
}

export async function readReport(uploadId: string, root = defaultUploadsRoot()): Promise<ImportReport | null> {
  const text = await readFile(path.join(/*turbopackIgnore: true*/ folder(root, uploadId), REPORT_FILE), "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as ImportReport);
}
