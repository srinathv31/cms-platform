import type { NextRequest } from "next/server";
import { readResponse } from "@/server/api/reads";
import { getCopilotPrompt } from "@/server/queries/copilot";
import { getViewer } from "@/server/viewer";

// The Copilot prompt, built from the saved draft each time its dialog opens:
// GET → { ok: true, prompt } | { ok: false, reason }, with 400, 403, 404 or 409 (src/server/api/reads.ts).
// Only someone who may edit the team's drafts. Request-time only: it reads the persona cookie first.

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/templates/[templateId]/copilot-prompt">) {
  const viewer = await getViewer();
  const { templateId } = await ctx.params;
  return readResponse(await getCopilotPrompt(viewer, { templateId }));
}
