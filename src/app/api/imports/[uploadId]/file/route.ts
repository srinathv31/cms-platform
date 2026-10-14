import type { NextRequest } from "next/server";
import { readResponse, signedOutResponse } from "@/server/api/reads";
import { requestContextOrRefusal } from "@/server/context/request";
import { services } from "@/server/services";

// An imported template's original, exactly as uploaded (the Original tab draws a PDF from it).
// 404 (`{ ok: false, code, reason }`, like every other refusal) when the upload doesn't exist or the
// viewer can't see the template's space. Request-time only: it reads the persona cookie first.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  const context = await requestContextOrRefusal();
  if (!context.ok) return signedOutResponse();
  const { uploadId } = await params;
  const found = await services().templates.importOriginal(context.context, {
    uploadId,
  });
  if (!found.ok) return readResponse(found);

  return new Response(found.bytes.slice().buffer, {
    status: 200,
    headers: {
      "Content-Type": found.mime,
      "Content-Length": String(found.bytes.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeRfc5987(found.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** RFC 5987 value: percent-encoded UTF-8, with the characters encodeURIComponent leaves alone that the RFC doesn't allow. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
