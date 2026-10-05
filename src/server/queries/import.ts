import "server-only";
import { desc, eq } from "drizzle-orm";
import { describeImport } from "@/domain/import";
import type { CompareSource, ImportKind, ImportOriginalRef, ImportOriginalView } from "@/domain/import-types";
import { canSeeSpace } from "@/domain/permissions";
import type { Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import { teams, templates, uploads, users } from "@/server/db/schema/ucomp";
import { decodeText } from "@/server/import/sniff";
import { defaultUploadsRoot, kindOfPath, readCompareHtml, readOriginal, readReport } from "@/server/import/store";

// An imported template's original (Phase 7a): the cheap ref the workspace carries, and what the
// rail's Original tab and the file route read. The original belongs to the template
// (`uploads.template_id`), so every version shows it. Visibility is the template's space.

const refColumns = {
  uploadId: uploads.id,
  filename: uploads.filename,
  path: uploads.path,
  size: uploads.size,
  createdAt: uploads.createdAt,
  uploadedByName: users.name,
};

type RefRow = { uploadId: string; filename: string; path: string; size: number; createdAt: Date; uploadedByName: string };

function toRef(row: RefRow, kind: ImportKind): ImportOriginalRef {
  return {
    uploadId: row.uploadId,
    filename: row.filename,
    kind,
    size: row.size,
    uploadedAt: row.createdAt.toISOString(),
    uploadedByName: row.uploadedByName,
  };
}

/** The template's imported original (the newest, should there ever be more), or null. */
export async function getImportOriginalRef(templateId: string): Promise<ImportOriginalRef | null> {
  const row = await db
    .select(refColumns)
    .from(uploads)
    .innerJoin(users, eq(users.id, uploads.createdBy))
    .where(eq(uploads.templateId, templateId))
    .orderBy(desc(uploads.createdAt))
    .limit(1)
    .then((rows) => rows[0]);
  const kind = row ? kindOfPath(row.path) : null;
  return row && kind ? toRef(row, kind) : null;
}

interface VisibleUpload {
  ref: ImportOriginalRef;
  path: string;
}

/** An upload the viewer may see: it belongs to a template in a space they can see. */
async function visibleUpload(viewer: Viewer, uploadId: string): Promise<VisibleUpload | null> {
  const row = await db
    .select({ ...refColumns, teamSlug: teams.slug })
    .from(uploads)
    .innerJoin(users, eq(users.id, uploads.createdBy))
    .innerJoin(templates, eq(templates.id, uploads.templateId))
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .where(eq(uploads.id, uploadId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!row || !canSeeSpace(viewer, row.teamSlug)) return null;
  const kind = kindOfPath(row.path);
  return kind ? { ref: toRef(row, kind), path: row.path } : null;
}

/** The original's bytes for GET /api/imports/{uploadId}/file; null = 404. */
export async function getImportOriginalFile(
  viewer: Viewer,
  uploadId: string,
  root = defaultUploadsRoot(),
): Promise<{ ref: ImportOriginalRef; bytes: Uint8Array } | null> {
  const upload = await visibleUpload(viewer, uploadId);
  if (!upload) return null;
  const bytes = await readOriginal(upload.path, root);
  return bytes ? { ref: upload.ref, bytes } : null;
}

/** The Original tab's read model for GET /api/imports/{uploadId}/view; null = 404. */
export async function getImportOriginalView(
  viewer: Viewer,
  uploadId: string,
  root = defaultUploadsRoot(),
): Promise<ImportOriginalView | null> {
  const upload = await visibleUpload(viewer, uploadId);
  if (!upload) return null;
  const report = await readReport(uploadId, root);
  if (!report) return null;

  let source: CompareSource;
  if (upload.ref.kind === "docx") {
    const html = await readCompareHtml(uploadId, root);
    if (html === null) return null;
    source = { kind: "docx", html };
  } else if (upload.ref.kind === "pdf") {
    source = { kind: "pdf", fileUrl: `/api/imports/${uploadId}/file`, pages: report.pages ?? 0 };
  } else {
    const bytes = await readOriginal(upload.path, root);
    const text = bytes ? decodeText(bytes) : null;
    if (text === null) return null;
    source = { kind: "txt", text: text.replace(/^﻿/, "") };
  }
  return { ref: upload.ref, source, report, lines: describeImport(report) };
}
