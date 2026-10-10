import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { smsFooterOf } from "@/domain/lifecycle";
import { can } from "@/domain/permissions";
import type { ChannelFields } from "@/domain/channel-fields";
import type { Channel, ChannelFamily, JSONContent, Variable, VersionState, Viewer } from "@/domain/types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { refusal, type ReadResult } from "@/server/api/reads";
import { db } from "@/server/db/client";
import { templates, versions } from "@/server/db/schema/ucomp";
import { loadFamily, loadMessageRules } from "./review-shared";

// What the Compare dialog needs and the Versions read model doesn't carry: the names, bodies, channel
// fields, SMS footers and variable lists of the two versions being compared (an alert's message shows its
// footer locked under the text, as the composer does, and a footer that changed between them is redlined).
// Served by GET /api/templates/[templateId]/compare when the dialog opens and on each change of pair. A
// read, so it checks only that the viewer may see the template (as the Versions page itself does). The diff
// is computed in the dialog.

export interface CompareVersion {
  id: string;
  /** Null for the open draft. */
  number: number | null;
  /** Which submission of `number`; null for the open draft. */
  round: number | null;
  state: VersionState;
  /** The template's name as this version has it (a rename shows above the redline). */
  name: string;
  body: JSONContent;
  /** The channels that are on, and each channel's own fields: an alert's whole content, an email's subject. */
  channels: Channel[];
  channelFields: ChannelFields;
  /**
   * The SMS footer this version prints (`smsFooterOf`): the one frozen into it at submit, or for the open
   * draft the content type's as it stands. Null: none.
   */
  smsFooter: string | null;
  variables: Variable[];
}

/** The pair, and the template's family (its content type's: an alert compares only its fields). */
export interface ComparePair {
  family: ChannelFamily;
  from: CompareVersion;
  to: CompareVersion;
}

const Id = z.string().min(1).max(64);
const Input = z.object({ templateId: Id, from: Id, to: Id });

/** The two versions of one template, `from` the older and `to` the newer (the dialog picks them so). */
export async function loadVersionsToCompare(
  viewer: Viewer,
  input: { templateId: string; from: string | null; to: string | null },
): Promise<ReadResult<ComparePair>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return refusal(400, REQUEST_REFUSALS.templateUnavailable);
  const { templateId, from, to } = parsed.data;

  const template = await db
    .select({ teamId: templates.teamId, contentTypeId: templates.contentTypeId })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!template) return refusal(404, REQUEST_REFUSALS.templateUnavailable);
  if (!can(viewer, "template.view", { teamId: template.teamId }).ok) return refusal(403, REQUEST_REFUSALS.templateUnavailable);

  const [rows, family, rules] = await Promise.all([
    db
      .select({
        id: versions.id,
        number: versions.number,
        round: versions.round,
        state: versions.state,
        name: versions.name,
        body: versions.body,
        channels: versions.channels,
        channelFields: versions.channelFields,
        smsFooter: versions.smsFooter,
        variables: versions.variables,
      })
      .from(versions)
      .where(and(eq(versions.templateId, templateId), inArray(versions.id, [from, to]))),
    loadFamily(db, template.contentTypeId),
    loadMessageRules(db, template.contentTypeId),
  ]);

  const pick = (id: string): CompareVersion | undefined => {
    const row = rows.find((r) => r.id === id);
    if (!row) return undefined;
    const draft = row.state === "draft";
    return {
      ...row,
      number: draft ? null : row.number,
      round: draft ? null : row.round,
      smsFooter: smsFooterOf(row, rules.smsFooter),
    };
  };
  const older = pick(from);
  const newer = pick(to);
  if (!older || !newer) return refusal(404, REQUEST_REFUSALS.versionUnavailable);
  return { ok: true, family, from: older, to: newer };
}
