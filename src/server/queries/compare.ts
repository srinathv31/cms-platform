"use server";

import { and, eq, inArray } from "drizzle-orm";
import { can } from "@/domain/permissions";
import type { ActionResult } from "@/domain/review-types";
import type { JSONContent, Variable, VersionState } from "@/domain/types";
import { db } from "@/server/db/client";
import { templates, versions } from "@/server/db/schema/ucomp";
import { getViewer } from "@/server/viewer";

// What the Compare dialog needs and the Versions read model doesn't carry: the bodies and variable
// lists of the versions being compared. A read, so it checks only that the viewer may see the
// template (as the Versions page itself does). The diff is computed in the dialog.

export interface CompareVersion {
  id: string;
  /** Null for the open draft. */
  number: number | null;
  state: VersionState;
  body: JSONContent;
  variables: Variable[];
}

export async function loadVersionsToCompare(input: {
  templateId: string;
  versionIds: string[];
}): Promise<ActionResult<{ versions: CompareVersion[] }>> {
  const viewer = await getViewer();

  const template = await db
    .select({ teamId: templates.teamId })
    .from(templates)
    .where(eq(templates.id, input.templateId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!template || !can(viewer, "template.view", { teamId: template.teamId }).ok) {
    return { ok: false, reason: "This template isn't available to you." };
  }

  const ids = [...new Set(input.versionIds)].slice(0, 2);
  const rows = ids.length
    ? await db
        .select({ id: versions.id, number: versions.number, state: versions.state, body: versions.body, variables: versions.variables })
        .from(versions)
        .where(and(eq(versions.templateId, input.templateId), inArray(versions.id, ids)))
    : [];

  return {
    ok: true,
    versions: ids.flatMap((id) => {
      const row = rows.find((r) => r.id === id);
      return row ? [{ ...row, number: row.state === "draft" ? null : row.number }] : [];
    }),
  };
}
