import type { NextRequest } from "next/server";
import { readResponse } from "@/server/api/reads";
import { getBaseVersion } from "@/server/queries/base-version";
import { getViewer } from "@/server/viewer";

// "Revert to v3": the content of the version the draft on screen was started from.
// GET ?draft=<version id> → { ok: true, base } | { ok: false, code, reason }, with 400, 403, 404 or 409
// (src/server/api/reads.ts). Only someone who may edit the team's drafts. Request-time only: it reads
// the persona cookie first.

export async function GET(request: NextRequest, ctx: RouteContext<"/api/templates/[templateId]/base-version">) {
  const viewer = await getViewer();
  const { templateId } = await ctx.params;
  return readResponse(await getBaseVersion(viewer, { templateId, versionId: request.nextUrl.searchParams.get("draft") }));
}
