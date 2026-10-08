"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { templates, versions } from "@/server/db/schema/ucomp";
import { getViewer } from "@/server/viewer";
import { can } from "@/domain/permissions";
import type { ActionResult } from "@/domain/review-types";
import type { Channel, JSONContent, SampleSet, Variable } from "@/domain/types";

// A read, not a change: the content of the version an open draft was started from, for the header's
// "Revert to v3". The client puts it on screen and saves it through autosave like any other edit (so
// the toast can undo it), which keeps the permission, rev and audit rules in one place. Nothing is
// written, audited or refreshed here.

/** The draft's fields as they are in the version it was started from. */
export interface BaseVersionContent {
  number: number;
  body: JSONContent;
  variables: Variable[];
  channels: Channel[];
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
  sampleSets: SampleSet[];
}

const Input = z.object({ templateId: z.string().min(1).max(64) });

export async function getBaseVersion(input: { templateId: string }): Promise<ActionResult<{ base: BaseVersionContent }>> {
  const viewer = await getViewer();
  const parsed = Input.safeParse(input);
  const template = parsed.success
    ? await db
        .select({ id: templates.id, teamId: templates.teamId })
        .from(templates)
        .where(eq(templates.id, parsed.data.templateId))
        .limit(1)
        .then((rows) => rows[0])
    : undefined;
  if (!template) return { ok: false, reason: "This template isn't available." };

  const allowed = can(viewer, "draft.edit", { teamId: template.teamId });
  if (!allowed.ok) return { ok: false, reason: allowed.reason };

  const list = await db
    .select({
      id: versions.id,
      number: versions.number,
      state: versions.state,
      basedOnVersionId: versions.basedOnVersionId,
      body: versions.body,
      variables: versions.variables,
      channels: versions.channels,
      emailSubject: versions.emailSubject,
      emailPreheader: versions.emailPreheader,
      sampleSets: versions.sampleSets,
    })
    .from(versions)
    .where(eq(versions.templateId, template.id));

  const draft = list.find((v) => v.state === "draft");
  if (!draft) return { ok: false, reason: "There is no draft to revert." };
  const base = draft.basedOnVersionId ? list.find((v) => v.id === draft.basedOnVersionId) : undefined;
  if (!base || base.number === null) return { ok: false, reason: "This draft wasn't started from an earlier version." };

  return {
    ok: true,
    base: {
      number: base.number,
      body: base.body,
      variables: base.variables,
      channels: base.channels,
      emailSubject: base.emailSubject,
      emailPreheader: base.emailPreheader,
      sampleSets: base.sampleSets,
    },
  };
}
