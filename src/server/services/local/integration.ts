import "server-only";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { sunsetDay } from "@/domain/business-zone";
import { copilotUnavailable } from "@/domain/copilot";
import { sunsetPassed } from "@/domain/lifecycle/sunset";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { contentTypeFamily } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  consumers,
  contentTypes,
  renderLog,
  teams,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import { refusal } from "../results";
import type { TemplateService } from "../templates";
import { readBusinessZone } from "./business-zone";
import type { LocalDeps } from "./command";
import { published } from "./consumer-api";

// The SHARE panel's facts and the Copilot prompt's, on this app's own database (src/server/services/
// templates.ts says what each read promises). The BFF words both: the examples, the schema and the prompt.

/** The consumer the examples name: the template's latest non-preview renderer, else the first registered one. */
async function sampleConsumer(templateId: string): Promise<string> {
  const [recent] = await db
    .select({ id: renderLog.consumerId })
    .from(renderLog)
    .innerJoin(consumers, eq(consumers.id, renderLog.consumerId))
    .where(
      and(
        eq(renderLog.templateId, templateId),
        eq(renderLog.isPreview, false),
        isNotNull(renderLog.consumerId),
      ),
    )
    // Renders at one instant: the later write first (decision 0063; `rowid` is this database's `seq`).
    .orderBy(desc(renderLog.at), desc(sql`${renderLog}.rowid`))
    .limit(1);
  if (recent?.id) return recent.id;
  const [first] = await db
    .select({ id: consumers.id })
    .from(consumers)
    .orderBy(asc(consumers.id))
    .limit(1);
  return first?.id ?? "coral";
}

export function localIntegration(
  deps: LocalDeps,
): Pick<TemplateService, "integration" | "copilotPrompt"> {
  return {
    async integration(ctx, { templateId }) {
      const [template] = await db
        .select({
          id: templates.id,
          teamId: templates.teamId,
          teamSlug: teams.slug,
          teamName: teams.name,
          allowedChannels: contentTypes.allowedChannels,
        })
        .from(templates)
        .innerJoin(teams, eq(teams.id, templates.teamId))
        .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
        .where(eq(templates.id, templateId))
        .limit(1);
      if (!template) return refusal(404, REQUEST_REFUSALS.templateGone);

      const permitted = can(ctx.viewer, "integration.view", {
        teamId: template.teamId,
      });
      if (!permitted.ok) return refusal(403, permitted);

      const asOf = await deps.clock();
      const [all, zone] = await Promise.all([
        db
          .select({
            number: versions.number,
            state: versions.state,
            name: versions.name,
            channels: versions.channels,
            variables: versions.variables,
            createdAt: versions.createdAt,
            activatedAt: versions.activatedAt,
            sunsetAt: versions.sunsetAt,
          })
          .from(versions)
          .where(eq(versions.templateId, template.id)),
        readBusinessZone(db),
      ]);
      const active = all.find((v) => v.state === "active" && v.number !== null);
      if (!active) return refusal(409, REQUEST_REFUSALS.noActiveVersion);
      const activeNumber = active.number!;

      return {
        ok: true,
        asOf: asOf.toISOString(),
        template: {
          id: template.id,
          teamSlug: template.teamSlug,
          teamName: template.teamName,
          name: active.name,
        },
        active: {
          number: activeNumber,
          activatedAt: (active.activatedAt ?? active.createdAt).toISOString(),
          channels: published(active.channels, template.allowedChannels),
          variables: active.variables,
        },
        sampleConsumerId: await sampleConsumer(template.id),
        older: all
          .filter(
            (v) =>
              (v.state === "superseded" || v.state === "revoked") &&
              v.number !== null &&
              v.number < activeNumber,
          )
          .sort((a, b) => b.number! - a.number!)
          .map((v) => ({
            number: v.number!,
            state: v.state,
            sunsetDay: v.sunsetAt ? sunsetDay(v.sunsetAt, zone) : null,
            sunsetPassed: sunsetPassed(v, asOf),
            variables: v.variables,
          })),
      };
    },

    async copilotPrompt(ctx, { templateId }) {
      const [template] = await db
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
        .where(eq(templates.id, templateId))
        .limit(1);
      if (!template) return refusal(404, REQUEST_REFUSALS.templateUnavailable);

      const allowed = can(ctx.viewer, "draft.edit", {
        teamId: template.teamId,
      });
      if (!allowed.ok) return refusal(403, allowed);

      const [draft] = await db
        .select({
          name: versions.name,
          body: versions.body,
          channels: versions.channels,
          variables: versions.variables,
        })
        .from(versions)
        .where(
          and(
            eq(versions.templateId, template.id),
            eq(versions.state, "draft"),
          ),
        )
        .limit(1);
      if (!draft) return refusal(409, REQUEST_REFUSALS.noDraftToWrite);
      // The content type's family, never the draft's channels: a draft can't change what kind of template it is.
      if (copilotUnavailable(contentTypeFamily(template.allowedChannels)))
        return refusal(409, REQUEST_REFUSALS.copilotDocumentsOnly);

      return {
        ok: true,
        templateName: draft.name,
        teamName: template.teamName,
        contentTypeName: template.contentTypeName,
        channels: draft.channels,
        requiredSections: template.requiredSections,
        variables: draft.variables,
        body: draft.body,
      };
    },
  };
}
