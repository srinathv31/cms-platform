import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { buildCopilotPrompt, copilotUnavailable } from "@/domain/copilot";
import type { CopilotPrompt } from "@/domain/import-types";
import { can } from "@/domain/permissions";
import { contentTypeFamily, type Viewer } from "@/domain/types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { refusal, type ReadResult } from "@/server/api/reads";
import { db } from "@/server/db/client";
import { contentTypes, teams, templates, versions } from "@/server/db/schema/ucomp";

// The Copilot prompt for a template's draft (Phase 7a), served by
// GET /api/templates/[templateId]/copilot-prompt. A read, not a change: the dialog sends the pending
// autosave first (`session.flush()`), so the saved draft is what is on screen, and the prompt is built
// here from it (the body only; the email subject and preheader stay out). Only someone who may edit
// the draft gets it. Nothing is written, audited or refreshed.

const Input = z.object({ templateId: z.string().min(1).max(64) });

export async function getCopilotPrompt(viewer: Viewer, input: { templateId: string }): Promise<ReadResult<{ prompt: CopilotPrompt }>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return refusal(400, REQUEST_REFUSALS.templateUnavailable);

  const template = await db
    .select({
      id: templates.id,
      teamId: templates.teamId,
      teamName: teams.name,
      contentTypeName: contentTypes.name,
      requiredSections: contentTypes.requiredSections,
      allowedChannels: contentTypes.allowedChannels,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
    .where(eq(templates.id, parsed.data.templateId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!template) return refusal(404, REQUEST_REFUSALS.templateUnavailable);

  const allowed = can(viewer, "draft.edit", { teamId: template.teamId });
  if (!allowed.ok) return refusal(403, allowed);

  const draft = await db
    .select({ name: versions.name, body: versions.body, channels: versions.channels, variables: versions.variables })
    .from(versions)
    .where(and(eq(versions.templateId, template.id), eq(versions.state, "draft")))
    .limit(1)
    .then((rows) => rows[0]);
  if (!draft) return refusal(409, REQUEST_REFUSALS.noDraftToWrite);
  // The content type's family, never the draft's channels: a draft can't change what kind of template it is.
  if (copilotUnavailable(contentTypeFamily(template.allowedChannels))) return refusal(409, REQUEST_REFUSALS.copilotDocumentsOnly);

  const prompt = buildCopilotPrompt({
    templateName: draft.name,
    teamName: template.teamName,
    contentTypeName: template.contentTypeName,
    channels: draft.channels,
    requiredSections: template.requiredSections,
    variables: draft.variables,
    body: draft.body,
  });
  return { ok: true, prompt };
}
