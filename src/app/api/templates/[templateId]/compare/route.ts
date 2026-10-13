import type { NextRequest } from "next/server";
import { readResponse, signedOutResponse } from "@/server/api/reads";
import { requestContextOrRefusal } from "@/server/context/request";
import { services } from "@/server/services";

// The Compare dialog's two versions, read when it opens and on each change of pair:
// GET ?from=<version id>&to=<version id> → { ok: true, family, from, to } | { ok: false, code, reason }, with 400, 401,
// 403 or 404 (`VersionService.compare` says which). Anyone who can see the template. Request-time only: it reads
// the persona cookie first.

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/templates/[templateId]/compare">,
) {
  const context = await requestContextOrRefusal();
  if (!context.ok) return signedOutResponse();
  const { templateId } = await ctx.params;
  const query = request.nextUrl.searchParams;
  return readResponse(
    await services().versions.compare(context.context, {
      templateId,
      from: query.get("from"),
      to: query.get("to"),
    }),
  );
}
