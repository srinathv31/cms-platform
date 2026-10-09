"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { buildCopilotPrompt } from "@/domain/copilot";
import type { CopilotPrompt } from "@/domain/import-types";
import { can } from "@/domain/permissions";
import type { ActionResult } from "@/domain/review-types";
import { db } from "@/server/db/client";
import { contentTypes, teams, templates, versions } from "@/server/db/schema/ucomp";
import { getViewer } from "@/server/viewer";

// The Copilot prompt for a template's draft (Phase 7a). A read, not a change: the dialog sends the
// pending autosave first (`session.flush()`), so the saved draft is what is on screen, and the prompt
// is built here from it (the body only; the email subject and preheader stay out). Only someone who
// may edit the draft gets it. Nothing is written, audited or refreshed.

const Input = z.object({ templateId: z.string().min(1).max(64) });

const REASONS = {
  missing: "This template isn't available.",
  noDraft: "There is no draft to write.",
} as const;

export async function getCopilotPrompt(input: { templateId: string }): Promise<ActionResult<{ prompt: CopilotPrompt }>> {
  const viewer = await getViewer();
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, reason: REASONS.missing };

  const template = await db
    .select({
      id: templates.id,
      teamId: templates.teamId,
      teamName: teams.name,
      contentTypeName: contentTypes.name,
      requiredSections: contentTypes.requiredSections,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
    .where(eq(templates.id, parsed.data.templateId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!template) return { ok: false, reason: REASONS.missing };

  const allowed = can(viewer, "draft.edit", { teamId: template.teamId });
  if (!allowed.ok) return { ok: false, reason: allowed.reason };

  const draft = await db
    .select({ name: versions.name, body: versions.body, channels: versions.channels, variables: versions.variables })
    .from(versions)
    .where(and(eq(versions.templateId, template.id), eq(versions.state, "draft")))
    .limit(1)
    .then((rows) => rows[0]);
  if (!draft) return { ok: false, reason: REASONS.noDraft };

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
