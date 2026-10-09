import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { typeLabel } from "@/domain/contract";
import { contractDiff } from "@/domain/golive/contract-diff";
import { contractJsonSchema, exampleOf } from "@/domain/golive/json-schema";
import { CONSUMER_ERRORS, integrationSamples, renderPathOf, RESPONSE_FORMATS } from "@/domain/golive/samples";
import type { IntegrationPanelData } from "@/domain/golive-types";
import { CHANNELS } from "@/domain/types";
import { db } from "@/server/db/client";
import { consumers, contentTypes, renderLog, teams, templates, versions } from "@/server/db/schema/ucomp";

// The integration panel (the sheet behind the template's "Share" ring): what a consumer needs to
// call the render API for the Active version. No viewer here: the action that calls it checks
// `integration.view` first.

/** The consumer the samples name: the template's latest non-preview renderer, else the first registered one. */
async function sampleConsumer(templateId: string): Promise<string> {
  const [recent] = await db
    .select({ id: renderLog.consumerId })
    .from(renderLog)
    .innerJoin(consumers, eq(consumers.id, renderLog.consumerId))
    .where(and(eq(renderLog.templateId, templateId), eq(renderLog.isPreview, false), isNotNull(renderLog.consumerId)))
    .orderBy(desc(renderLog.at))
    .limit(1);
  if (recent?.id) return recent.id;
  const [first] = await db.select({ id: consumers.id }).from(consumers).orderBy(asc(consumers.id)).limit(1);
  return first?.id ?? "coral";
}

/**
 * The panel's data, or null when the template doesn't exist or has no Active version. Everything in it
 * is what consumers get from `/api/v1`, the name included: the Active version's, not an open draft's.
 */
export async function getIntegrationPanel(templateId: string, origin: string): Promise<IntegrationPanelData | null> {
  const [row] = await db
    .select({
      id: templates.id,
      teamSlug: teams.slug,
      teamName: teams.name,
      allowedChannels: contentTypes.allowedChannels,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
    .where(eq(templates.id, templateId))
    .limit(1);
  if (!row) return null;
  const { allowedChannels, ...found } = row;

  const all = await db.select().from(versions).where(eq(versions.templateId, found.id));
  const active = all.find((v) => v.state === "active" && v.number !== null);
  if (!active) return null;
  const activeNumber = active.number!;
  const template = { ...found, name: active.name };

  // What the render route accepts: turned on for the version and still allowed by the content type
  // (Channel rules can turn a channel off after the version went Active).
  const channels = CHANNELS.filter((c) => active.channels.includes(c) && allowedChannels.includes(c));
  const consumerId = await sampleConsumer(template.id);
  const path = renderPathOf(template.id);
  const base = origin.replace(/\/+$/, "");
  const jsonSchema = contractJsonSchema({
    templateId: template.id,
    templateName: template.name,
    versionNumber: activeNumber,
    variables: active.variables,
  });

  const older = all
    .filter((v) => (v.state === "superseded" || v.state === "revoked") && v.number !== null && v.number < activeNumber)
    .sort((a, b) => b.number! - a.number!);

  return {
    template,
    active: { number: activeNumber, activatedAt: (active.activatedAt ?? active.createdAt).toISOString(), channels },
    contract: active.variables.map((v) => ({
      key: v.key,
      label: v.label,
      type: v.type,
      typeLabel: typeLabel(v.type),
      required: v.required,
      example: exampleOf(v),
    })),
    jsonSchema,
    jsonSchemaText: JSON.stringify(jsonSchema, null, 2),
    endpoint: { method: "POST", path, url: `${base}${path}` },
    samples: channels.map((channel) => ({
      channel,
      ...integrationSamples({
        origin: base,
        templateId: template.id,
        versionNumber: activeNumber,
        channel,
        variables: active.variables,
        consumerId,
      }),
    })),
    responses: [...RESPONSE_FORMATS],
    errors: [...CONSUMER_ERRORS],
    since: older.map((v) => {
      const diff = contractDiff({ number: v.number!, variables: v.variables }, { number: activeNumber, variables: active.variables });
      return {
        number: v.number!,
        state: v.state,
        sunsetAt: v.sunsetAt?.toISOString() ?? null,
        diff: { breaking: diff.breaking, items: diff.items },
      };
    }),
  };
}
