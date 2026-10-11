import type { NextRequest } from "next/server";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { readResponse, refusal } from "@/server/api/reads";
import { getImportOriginalView } from "@/server/queries/import";
import { getViewer } from "@/server/viewer";

// The rail's Original tab: ImportOriginalView JSON (the ref, the source to show, the report and its
// lines). Same visibility as the file route; otherwise 404 with `{ ok: false, code, reason }` like
// every other refusal. Request-time only (the persona cookie).

export async function GET(_request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const viewer = await getViewer();
  const { uploadId } = await params;
  const view = await getImportOriginalView(viewer, uploadId);
  if (!view) return readResponse(refusal(404, REQUEST_REFUSALS.uploadUnavailable));
  return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
}
