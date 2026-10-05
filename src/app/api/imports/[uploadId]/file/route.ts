import type { NextRequest } from "next/server";
import { IMPORT_MIME } from "@/domain/import-types";
import { getImportOriginalFile } from "@/server/queries/import";
import { getViewer } from "@/server/viewer";

// An imported template's original, exactly as uploaded (the Original tab draws a PDF from it).
// 404 when the upload doesn't exist or the viewer can't see the template's space. Request-time only:
// it reads the persona cookie first.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const viewer = await getViewer();
  const { uploadId } = await params;
  const found = await getImportOriginalFile(viewer, uploadId);
  if (!found) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

  return new Response(found.bytes.slice().buffer, {
    status: 200,
    headers: {
      "Content-Type": IMPORT_MIME[found.ref.kind],
      "Content-Length": String(found.bytes.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeRfc5987(found.ref.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** RFC 5987 value: percent-encoded UTF-8, with the characters encodeURIComponent leaves alone that the RFC doesn't allow. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
