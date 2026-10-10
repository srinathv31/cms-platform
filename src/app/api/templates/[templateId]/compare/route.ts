import type { NextRequest } from "next/server";
import { readResponse } from "@/server/api/reads";
import { loadVersionsToCompare } from "@/server/queries/compare";
import { getViewer } from "@/server/viewer";

// The Compare dialog's two versions, read when it opens and on each change of pair:
// GET ?from=<version id>&to=<version id> → { ok: true, family, from, to } | { ok: false, code, reason }, with 400, 403
// or 404 (src/server/api/reads.ts). Anyone who can see the template. Request-time only: it reads the
// persona cookie first.

export async function GET(request: NextRequest, ctx: RouteContext<"/api/templates/[templateId]/compare">) {
  const viewer = await getViewer();
  const { templateId } = await ctx.params;
  const query = request.nextUrl.searchParams;
  return readResponse(await loadVersionsToCompare(viewer, { templateId, from: query.get("from"), to: query.get("to") }));
}
