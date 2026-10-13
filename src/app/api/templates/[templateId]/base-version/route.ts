import type { NextRequest } from "next/server";
import { readResponse, signedOutResponse } from "@/server/api/reads";
import { requestContextOrRefusal } from "@/server/context/request";
import { getBaseVersion } from "@/server/queries/base-version";

// "Revert to v3": the content of the version the draft on screen was started from.
// GET ?draft=<version id> → { ok: true, base } | { ok: false, code, reason }, with 400, 403, 404 or 409
// (src/server/api/reads.ts). Only someone who may edit the team's drafts. Request-time only: it reads
// the persona cookie first.

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/templates/[templateId]/base-version">,
) {
  const context = await requestContextOrRefusal();
  if (!context.ok) return signedOutResponse();
  const { viewer } = context.context;
  const { templateId } = await ctx.params;
  return readResponse(
    await getBaseVersion(viewer, {
      templateId,
      versionId: request.nextUrl.searchParams.get("draft"),
    }),
  );
}
