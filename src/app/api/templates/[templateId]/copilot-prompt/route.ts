import type { NextRequest } from "next/server";
import { readResponse, signedOutResponse } from "@/server/api/reads";
import { requestContextOrRefusal } from "@/server/context/request";
import { getCopilotPrompt } from "@/server/queries/copilot";

// The Copilot prompt, built from the saved draft each time its dialog opens:
// GET → { ok: true, prompt } | { ok: false, code, reason }, with 400, 401, 403, 404 or 409 (src/server/api/reads.ts).
// Only someone who may edit the team's drafts (403 to anyone else who can see the template; 404 to who can't).
// Request-time only: it reads the persona cookie first.

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/templates/[templateId]/copilot-prompt">,
) {
  const context = await requestContextOrRefusal();
  if (!context.ok) return signedOutResponse();
  const { templateId } = await ctx.params;
  return readResponse(await getCopilotPrompt(context.context, { templateId }));
}
