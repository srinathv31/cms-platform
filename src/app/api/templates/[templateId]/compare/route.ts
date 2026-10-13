import type { NextRequest } from "next/server";
import { readResponse, signedOutResponse } from "@/server/api/reads";
import { requestContextOrRefusal } from "@/server/context/request";
import { loadVersionsToCompare } from "@/server/queries/compare";

// The Compare dialog's two versions, read when it opens and on each change of pair:
// GET ?from=<version id>&to=<version id> → { ok: true, family, from, to } | { ok: false, code, reason }, with 400, 403
// or 404 (src/server/api/reads.ts). Anyone who can see the template. Request-time only: it reads the
// persona cookie first.

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/templates/[templateId]/compare">,
) {
  const context = await requestContextOrRefusal();
  if (!context.ok) return signedOutResponse();
  const { viewer } = context.context;
  const { templateId } = await ctx.params;
  const query = request.nextUrl.searchParams;
  return readResponse(
    await loadVersionsToCompare(viewer, {
      templateId,
      from: query.get("from"),
      to: query.get("to"),
    }),
  );
}
