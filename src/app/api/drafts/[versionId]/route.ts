import type { NextRequest } from "next/server";
import { REQUEST_REFUSALS, refuse } from "@/domain/refusals";
import type { DraftSaveResponse } from "@/domain/types";
import { statusOf } from "@/server/drafts/http";
import {
  MAX_BODY_SIZE,
  parseDraftPatchText,
} from "@/server/drafts/parse-patch";
import { prepareDraftPatch } from "@/server/drafts/prepare-patch";
import { readBodyCapped } from "@/server/api/read-body";
import { requestContextOrRefusal } from "@/server/context/request";
import { services } from "@/server/services";

// Autosave. A route handler rather than a server action because actions run one at a time per
// client, which would queue saves behind a slow one. Request-time only: it reads the persona cookie.
//
// The answer is a save (`{ ok: true, rev, savedAt }`) or a refusal as every refusal is,
// `{ ok: false, code, reason }` (src/domain/refusals.ts), with the status `statusOf` gives its code.
//
// Nothing is read from the body until the viewer may edit the draft (`drafts.saveAccess`, from the version id in
// the path), and the body is then read with a byte counter that stops past MAX_BODY_SIZE: a declared
// Content-Length is only a hint, and a chunked body has none. The patch is parsed, its documents prepared for
// storage (prepare-patch.ts), and only then handed to `drafts.save`, which the backend answers.

function respond(body: DraftSaveResponse): Response {
  return Response.json(body, {
    status: statusOf(body),
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params;
  const context = await requestContextOrRefusal();
  if (!context.ok) return respond(context);
  const ctx = context.context;

  // Permission first, before a byte of the body is read.
  const access = await services().drafts.saveAccess(ctx, { versionId });
  if (!access.ok) return respond(access);

  // Too large: refused from the declared length when there is one, else as soon as the count passes it.
  const tooLarge = refuse(REQUEST_REFUSALS.draftTooLarge);
  if (Number(request.headers.get("content-length")) > MAX_BODY_SIZE)
    return respond(tooLarge);
  const body = await readBodyCapped(request.body, MAX_BODY_SIZE);
  if (!body.ok) return respond(tooLarge);

  const parsed = parseDraftPatchText(new TextDecoder().decode(body.bytes));
  if (!parsed.ok)
    return respond(refuse(REQUEST_REFUSALS.invalidInput(parsed.message)));
  const prepared = prepareDraftPatch(parsed.patch);
  if (!prepared.ok) return respond(prepared);

  return respond(
    await services().drafts.save(ctx, { versionId, patch: prepared.patch }),
  );
}
