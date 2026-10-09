"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { templates, versions } from "@/server/db/schema/ucomp";
import { now } from "@/server/clock";
import { getViewer } from "@/server/viewer";
import { contractBaseline } from "@/domain/lifecycle";
import { can } from "@/domain/permissions";
import type { ActionResult } from "@/domain/review-types";
import { CHANNELS } from "@/domain/types";
import { listSets } from "@/components/preview/sample-sets/model";
import type { SubmitSummary } from "@/components/submit/types";

// A read, not a change: what the submit dialog lists, taken from the saved draft. The dialog sits in the
// tab bar, a separate subtree from the editor, so it can't see the live variables. It asks for them
// here, after the pending autosave has gone out (`session.flush()`), which makes the saved draft the
// live one. The draft's `rev` comes with it: submit sends it back, and is refused if the draft has
// changed since. Read-only, so nothing is written, audited or refreshed.

const Input = z.object({ templateId: z.string().min(1).max(64) });

export async function getSubmitSummary(input: { templateId: string }): Promise<ActionResult<{ summary: SubmitSummary }>> {
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

  const allowed = can(viewer, "version.submit", { teamId: template.teamId });
  if (!allowed.ok) return { ok: false, reason: allowed.reason };

  const list = await db
    .select({
      number: versions.number,
      state: versions.state,
      rev: versions.rev,
      sunsetAt: versions.sunsetAt,
      name: versions.name,
      channels: versions.channels,
      variables: versions.variables,
      sampleSets: versions.sampleSets,
    })
    .from(versions)
    .where(eq(versions.templateId, template.id));

  const draft = list.find((v) => v.state === "draft");
  if (!draft) {
    return {
      ok: false,
      reason: list.some((v) => v.state === "in_review")
        ? "This version is already in review."
        : "There is no draft to submit.",
    };
  }
  const at = await now();
  // What submit will compare with: the newest version that still renders (the Active one, if any).
  const baseline = contractBaseline(list, at);
  const today = at.toISOString().slice(0, 10);

  return {
    ok: true,
    summary: {
      templateId: template.id,
      rev: draft.rev,
      number: list.reduce((max, v) => Math.max(max, v.number ?? 0), 0) + 1,
      name: draft.name,
      channels: CHANNELS.filter((channel) => draft.channels.includes(channel)),
      sampleSetNames: listSets(draft.sampleSets, draft.variables, today).map((set) => set.name),
      variables: draft.variables,
      baseline:
        baseline && baseline.number !== null
          ? { number: baseline.number, name: baseline.name, variables: baseline.variables }
          : null,
    },
  };
}
