import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { typeLabel } from "@/domain/contract";
import { contractDiff } from "@/domain/golive/contract-diff";
import { contractJsonSchema, exampleOf } from "@/domain/golive/json-schema";
import {
  CONSUMER_ERRORS,
  integrationSamples,
  renderPathOf,
  RESPONSE_FORMATS,
} from "@/domain/golive/samples";
import type { IntegrationPanelData } from "@/domain/golive-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { refusal, type ReadResult } from "@/server/api/reads";
import type { RequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type { IntegrationFacts } from "@/server/services/templates";

// The integration panel (the sheet behind the template's "Share" ring): what a consumer needs to
// call the render API for the Active version. `loadIntegrationPanel` serves
// GET /api/templates/[templateId]/integration, which the panel calls when it opens and on hover or
// focus of the ring, as a prefetch. The backend answers the facts (`services().templates.integration`, which
// checks `integration.view`); `integrationPanel` words them: the endpoint, the curl and fetch examples, the
// schema, the responses and errors, and what changed since each older version.

const Input = z.object({ templateId: z.string().trim().min(1).max(64) });

/** "https://ucomp.example": the origin the page was requested on (behind a proxy, its forwarded host). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    h.get("host") ||
    "localhost:3000";
  const forwarded = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwarded ||
    (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** The panel for someone who may see the integration details; read-only, so nothing is refreshed or audited. */
export async function loadIntegrationPanel(
  ctx: RequestContext,
  input: { templateId: string },
): Promise<ReadResult<{ panel: IntegrationPanelData }>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return refusal(400, REQUEST_REFUSALS.templateGone);
  const facts = await services().templates.integration(ctx, {
    templateId: parsed.data.templateId,
  });
  if (!facts.ok) return facts;
  return { ok: true, panel: integrationPanel(facts, await requestOrigin()) };
}

/**
 * The panel from the backend's facts, for a consumer calling `origin`. Everything in it is what consumers get
 * from `/api/v1`, the name included: the Active version's, not an open draft's.
 */
export function integrationPanel(
  facts: IntegrationFacts,
  origin: string,
): IntegrationPanelData {
  const { template, active } = facts;
  const base = origin.replace(/\/+$/, "");
  const path = renderPathOf(template.id);
  const jsonSchema = contractJsonSchema({
    templateId: template.id,
    templateName: template.name,
    versionNumber: active.number,
    variables: active.variables,
  });

  return {
    template,
    active: {
      number: active.number,
      activatedAt: active.activatedAt,
      channels: active.channels,
    },
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
    samples: active.channels.map((channel) => ({
      channel,
      ...integrationSamples({
        origin: base,
        templateId: template.id,
        versionNumber: active.number,
        channel,
        variables: active.variables,
        consumerId: facts.sampleConsumerId,
      }),
    })),
    responses: [...RESPONSE_FORMATS],
    errors: [...CONSUMER_ERRORS],
    since: facts.older.map((v) => {
      const diff = contractDiff(
        { number: v.number, variables: v.variables },
        { number: active.number, variables: active.variables },
      );
      return {
        number: v.number,
        state: v.state,
        sunsetDay: v.sunsetDay,
        sunsetPassed: v.sunsetPassed,
        diff: { breaking: diff.breaking, items: diff.items },
      };
    }),
  };
}
