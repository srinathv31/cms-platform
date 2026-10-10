import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { channelFieldValues, type ChannelFieldValues } from "@/domain/channel-fields";
import { can } from "@/domain/permissions";
import type { Channel, JSONContent, SampleSet, Variable, Viewer } from "@/domain/types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { refusal, type ReadResult } from "@/server/api/reads";
import { db } from "@/server/db/client";
import { templates, versions } from "@/server/db/schema/ucomp";

// A read, not a change: the content of the version an open draft was started from, for the header's
// "Revert to v3", served by GET /api/templates/[templateId]/base-version?draft=<version id>. The client
// puts it on screen and saves it through autosave like any other edit (so the toast can undo it), which
// keeps the permission, rev and audit rules in one place. Nothing is written, audited or refreshed here.
//
// The client names the draft on its screen (`versionId`) and gets that draft's base, or a refusal:
// never the base of another draft the template has by now (the one on screen was submitted, and
// someone started a new one).

/**
 * The draft's fields as they are in the version it was started from: its name too, and each channel field
 * by id ("email.subject", null when it has none), the way the workspace holds and saves them.
 */
export interface BaseVersionContent extends ChannelFieldValues {
  number: number;
  name: string;
  body: JSONContent;
  variables: Variable[];
  channels: Channel[];
  sampleSets: SampleSet[];
}

const Input = z.object({ templateId: z.string().min(1).max(64), versionId: z.string().min(1).max(64) });

export async function getBaseVersion(
  viewer: Viewer,
  input: {
    templateId: string;
    /** The draft on screen (the workspace session's binding). */
    versionId: string | null;
  },
): Promise<ReadResult<{ base: BaseVersionContent }>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return refusal(400, REQUEST_REFUSALS.templateUnavailable);
  const template = await db
    .select({ id: templates.id, teamId: templates.teamId })
    .from(templates)
    .where(eq(templates.id, parsed.data.templateId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!template) return refusal(404, REQUEST_REFUSALS.templateUnavailable);

  const allowed = can(viewer, "draft.edit", { teamId: template.teamId });
  if (!allowed.ok) return refusal(403, allowed);

  const list = await db
    .select({
      id: versions.id,
      number: versions.number,
      state: versions.state,
      basedOnVersionId: versions.basedOnVersionId,
      name: versions.name,
      body: versions.body,
      variables: versions.variables,
      channels: versions.channels,
      channelFields: versions.channelFields,
      sampleSets: versions.sampleSets,
    })
    .from(versions)
    .where(eq(versions.templateId, template.id));

  const draft = list.find((v) => v.id === parsed.data.versionId);
  if (!draft) return refusal(404, REQUEST_REFUSALS.noDraftToRevert);
  if (draft.state !== "draft") return refusal(409, REQUEST_REFUSALS.noDraftToRevert);
  const base = draft.basedOnVersionId ? list.find((v) => v.id === draft.basedOnVersionId) : undefined;
  if (!base || base.number === null) return refusal(409, REQUEST_REFUSALS.noBaseVersion);

  return {
    ok: true,
    base: {
      number: base.number,
      name: base.name,
      body: base.body,
      variables: base.variables,
      channels: base.channels,
      sampleSets: base.sampleSets,
      ...channelFieldValues(base.channelFields),
    },
  };
}
