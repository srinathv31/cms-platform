import type { NextRequest } from "next/server";
import { readResponse } from "@/server/api/reads";
import { loadIntegrationPanel } from "@/server/queries/integration";
import { getViewer } from "@/server/viewer";

// The SHARE integration panel, read when it opens and on hover or focus of the ring, as a prefetch:
// GET → { ok: true, panel } | { ok: false, code, reason }, with 400, 403, 404 or 409 (src/server/api/reads.ts).
// A GET route, so the prefetch never waits on, or holds up, the page's server actions (Edit, Submit).
// Anyone who can see the template. Request-time only: it reads the persona cookie first.

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/templates/[templateId]/integration">) {
  const viewer = await getViewer();
  const { templateId } = await ctx.params;
  return readResponse(await loadIntegrationPanel(viewer, { templateId }));
}
