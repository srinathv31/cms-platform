import "server-only";
import { describeImport } from "@/domain/import";
import type {
  CompareSource,
  ImportOriginalRef,
  ImportOriginalView,
} from "@/domain/import-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { RequestContext } from "@/server/context/request";
import { decodeText } from "@/server/import/sniff";
import { services } from "@/server/services";
import { refusal, type ReadResult } from "@/server/services/results";
import type { ImportedOriginal } from "@/server/services/templates";

// An imported template's original: the cheap ref the workspace carries, and what the rail's Original
// tab and the file route read. The original belongs to the template (`uploads.template_id`), so every version
// shows it; the backend decides who may see it (the template's space) and answers facts, which these words and
// lay out (the report's lines, the file's URL, the text a text file shows).

/** The ref the workspace carries: who uploaded what, and when. */
export function importOriginalRef(
  original: ImportedOriginal,
): ImportOriginalRef {
  return {
    uploadId: original.uploadId,
    filename: original.filename,
    kind: original.kind,
    size: original.size,
    uploadedAt: original.uploadedAt,
    uploadedByName: original.uploadedBy.name,
  };
}

/**
 * The Original tab's read model for GET /api/imports/{uploadId}/view: the ref, what to show of the file, the
 * report and its lines. `text` is a text file's decoded content (null for the other kinds).
 */
export function importOriginalView(
  facts: {
    original: ImportedOriginal;
    report: ImportOriginalView["report"];
    compareHtml: string | null;
  },
  text: string | null,
): ImportOriginalView | null {
  const { original, report } = facts;
  let source: CompareSource;
  if (original.kind === "docx") {
    if (facts.compareHtml === null) return null;
    source = { kind: "docx", html: facts.compareHtml };
  } else if (original.kind === "pdf") {
    source = {
      kind: "pdf",
      fileUrl: `/api/imports/${original.uploadId}/file`,
      pages: report.pages ?? 0,
    };
  } else {
    if (text === null) return null;
    source = { kind: "txt", text: text.replace(/^﻿/, "") };
  }
  return {
    ref: importOriginalRef(original),
    source,
    report,
    lines: describeImport(report),
  };
}

/** The Original tab's read model for GET /api/imports/{uploadId}/view, or the backend's refusal. */
export async function getImportOriginalView(
  ctx: RequestContext,
  uploadId: string,
): Promise<ReadResult<{ view: ImportOriginalView }>> {
  const facts = await services().templates.importOriginalView(ctx, {
    uploadId,
  });
  if (!facts.ok) return facts;
  // A text file is shown as the text of its original, which the view's facts leave to the original's own read.
  let text: string | null = null;
  if (facts.original.kind === "txt") {
    const bytes = await services().templates.importOriginal(ctx, { uploadId });
    if (!bytes.ok) return bytes;
    text = decodeText(bytes.bytes);
  }
  const view = importOriginalView(facts, text);
  return view
    ? { ok: true, view }
    : refusal(404, REQUEST_REFUSALS.uploadUnavailable);
}
