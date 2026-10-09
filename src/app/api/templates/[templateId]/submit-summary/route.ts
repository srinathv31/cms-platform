import type { NextRequest } from "next/server";
import { readResponse } from "@/server/api/reads";
import { getSubmitSummary } from "@/server/queries/submit-summary";
import { getViewer } from "@/server/viewer";

// What the submit dialog lists, read from the saved draft when Submit is pressed and again on "Refresh
// summary": GET → { ok: true, summary } | { ok: false, code, reason }, with 400, 403, 404 or 409
// (src/server/api/reads.ts). Only someone who may submit on the team. Request-time only: it reads the
// persona cookie first.

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/templates/[templateId]/submit-summary">) {
  const viewer = await getViewer();
  const { templateId } = await ctx.params;
  return readResponse(await getSubmitSummary(viewer, { templateId }));
}
