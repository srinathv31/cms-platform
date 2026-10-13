import type { NextRequest } from "next/server";
import { readResponse, signedOutResponse } from "@/server/api/reads";
import { requestContextOrRefusal } from "@/server/context/request";
import { services } from "@/server/services";

// "Revert to v3": the content of the version the draft on screen was started from.
// GET ?draft=<version id> → { ok: true, base } | { ok: false, code, reason }, with 400, 401, 403, 404 or 409
// (`VersionService.baseVersion` says which). Only someone who may edit the team's drafts (403 to anyone else who can
// see the template; 404 to who can't). Request-time only: it
// reads the persona cookie first. Nothing is written, audited or refreshed here: the client saves the content
// through autosave like any other edit.

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/templates/[templateId]/base-version">,
) {
  const context = await requestContextOrRefusal();
  if (!context.ok) return signedOutResponse();
  const { templateId } = await ctx.params;
  return readResponse(
    await services().versions.baseVersion(context.context, {
      templateId,
      versionId: request.nextUrl.searchParams.get("draft"),
    }),
  );
}
