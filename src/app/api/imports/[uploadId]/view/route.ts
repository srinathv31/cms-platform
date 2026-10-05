import type { NextRequest } from "next/server";
import { getImportOriginalView } from "@/server/queries/import";
import { getViewer } from "@/server/viewer";

// The rail's Original tab: ImportOriginalView JSON (the ref, the source to show, the report and its
// lines). Same visibility as the file route; 404 otherwise. Request-time only (the persona cookie).

export async function GET(_request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const viewer = await getViewer();
  const { uploadId } = await params;
  const view = await getImportOriginalView(viewer, uploadId);
  if (!view) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
}
