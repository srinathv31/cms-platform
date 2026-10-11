import type { NextRequest } from "next/server";
import { REQUEST_REFUSALS, refuse } from "@/domain/refusals";
import type { DraftSaveResponse } from "@/domain/types";
import { statusOf } from "@/server/drafts/http";
import { MAX_BODY_SIZE, parseDraftPatchText } from "@/server/drafts/parse-patch";
import { draftAccessRefusal, saveDraft } from "@/server/drafts/save-draft";
import { readBodyCapped } from "@/server/api/read-body";
import { getViewer } from "@/server/viewer";

// Autosave. A route handler rather than a server action because actions run one at a time per
// client, which would queue saves behind a slow one. Request-time only: it reads the persona cookie.
//
// The answer is a save (`{ ok: true, rev, savedAt }`) or a refusal as every refusal is,
// `{ ok: false, code, reason }` (src/domain/refusals.ts), with the status `statusOf` gives its code.
//
// Nothing is read from the body until the viewer may edit the draft (the version id is in the path
// for that), and the body is then read with a byte counter that stops past MAX_BODY_SIZE: a declared
// Content-Length is only a hint, and a chunked body has none.

function respond(body: DraftSaveResponse): Response {
  return Response.json(body, { status: statusOf(body), headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const viewer = await getViewer();

  // Permission first, before a byte of the body is read.
  const refused = await draftAccessRefusal(viewer, versionId);
  if (refused) return respond(refused);

  // Too large: refused from the declared length when there is one, else as soon as the count passes it.
  const tooLarge = refuse(REQUEST_REFUSALS.draftTooLarge);
  if (Number(request.headers.get("content-length")) > MAX_BODY_SIZE) return respond(tooLarge);
  const body = await readBodyCapped(request.body, MAX_BODY_SIZE);
  if (!body.ok) return respond(tooLarge);

  const parsed = parseDraftPatchText(new TextDecoder().decode(body.bytes));
  if (!parsed.ok) return respond(refuse(REQUEST_REFUSALS.invalidInput(parsed.message)));

  return respond(await saveDraft(viewer, versionId, parsed.patch));
}
