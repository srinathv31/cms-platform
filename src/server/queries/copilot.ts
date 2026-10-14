import "server-only";
import { z } from "zod";
import { buildCopilotPrompt } from "@/domain/copilot";
import type { CopilotPrompt } from "@/domain/import-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { refusal, type ReadResult } from "@/server/api/reads";
import type { RequestContext } from "@/server/context/request";
import { services } from "@/server/services";

// The Copilot prompt for a template's draft (Phase 7a), served by
// GET /api/templates/[templateId]/copilot-prompt. A read, not a change: the dialog sends the pending
// autosave first (`session.flush()`), so the saved draft is what is on screen. The backend answers the draft
// with its team and content type (`services().templates.copilotPrompt`, for someone who may edit it); the
// prompt is worded here from it (the body only; the email subject and preheader stay out). Nothing is written,
// audited or refreshed.

const Input = z.object({ templateId: z.string().min(1).max(64) });

export async function getCopilotPrompt(
  ctx: RequestContext,
  input: { templateId: string },
): Promise<ReadResult<{ prompt: CopilotPrompt }>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success)
    return refusal(400, REQUEST_REFUSALS.templateUnavailable);
  const facts = await services().templates.copilotPrompt(ctx, {
    templateId: parsed.data.templateId,
  });
  if (!facts.ok) return facts;
  return { ok: true, prompt: buildCopilotPrompt(facts) };
}
