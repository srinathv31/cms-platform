import type { NextRequest } from "next/server";
import type { DraftSaveResponse } from "@/domain/types";
import { TOO_LARGE, TOO_LARGE_STATUS, statusOf } from "@/server/drafts/http";
import { MAX_BODY_SIZE, parseDraftPatchText } from "@/server/drafts/parse-patch";
import { draftAccessRefusal, saveDraft } from "@/server/drafts/save-draft";
import { readBodyCapped } from "@/server/import/read-body";
import { getViewer } from "@/server/viewer";

// Autosave. A route handler rather than a server action because actions run one at a time per
// client, which would queue saves behind a slow one. Request-time only: it reads the persona cookie.
//
// Nothing is read from the body until the viewer may edit the draft (the version id is in the path
// for that), and the body is then read with a byte counter that stops past MAX_BODY_SIZE: a declared
// Content-Length is only a hint, and a chunked body has none.

function respond(body: DraftSaveResponse, status = statusOf(body)): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const viewer = await getViewer();

  // Permission first, before a byte of the body is read.
  const refused = await draftAccessRefusal(viewer, versionId);
  if (refused) return respond(refused);

  // Too large: refused from the declared length when there is one, else as soon as the count passes it.
  if (Number(request.headers.get("content-length")) > MAX_BODY_SIZE) return respond(TOO_LARGE, TOO_LARGE_STATUS);
  const body = await readBodyCapped(request.body, MAX_BODY_SIZE);
  if (!body.ok) return respond(TOO_LARGE, TOO_LARGE_STATUS);

  const parsed = parseDraftPatchText(new TextDecoder().decode(body.bytes));
  if (!parsed.ok) return respond({ ok: false, error: "invalid", message: parsed.message });

  return respond(await saveDraft(viewer, versionId, parsed.patch));
}
