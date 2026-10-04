import type { NextRequest } from "next/server";
import type { DraftSaveResponse } from "@/domain/types";
import { statusOf } from "@/server/drafts/http";
import { MAX_BODY_SIZE, parseDraftPatchText } from "@/server/drafts/parse-patch";
import { saveDraft } from "@/server/drafts/save-draft";
import { getViewer } from "@/server/viewer";

// Autosave. A route handler rather than a server action because actions run one at a time per
// client, which would queue saves behind a slow one. Request-time only: it reads the persona cookie.

function respond(body: DraftSaveResponse): Response {
  return Response.json(body, { status: statusOf(body), headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;

  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_SIZE) {
    return respond({ ok: false, error: "invalid", message: "The draft is too large to save." });
  }

  const parsed = parseDraftPatchText(await request.text());
  if (!parsed.ok) return respond({ ok: false, error: "invalid", message: parsed.message });

  return respond(await saveDraft(await getViewer(), versionId, parsed.patch));
}
