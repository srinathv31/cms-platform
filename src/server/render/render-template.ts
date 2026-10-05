import "server-only";
import { and, eq } from "drizzle-orm";
import { can } from "@/domain/permissions";
import {
  BAD_REQUEST_MESSAGES,
  badRequest,
  channelNotAllowed,
  channelNotEnabled,
  checkVersion,
  consumerRequired,
  previewForbidden,
  renderFailed,
  resolveDocument,
  resolveInlineField,
  templateNotFound,
  unknownConsumer,
  validateValues,
  versionNotFound,
} from "@/domain/render";
import type { EmailRender, RenderDoc, RenderError, ResolveContext } from "@/domain/render/types";
import type { Channel, Viewer } from "@/domain/types";
import { now } from "@/server/clock";
import { db as appDb, type Db } from "@/server/db/client";
import { consumers, contentTypes, templates, versions } from "@/server/db/schema/ucomp";
import { renderEmail } from "./channels/email";
import { renderPdf } from "./channels/pdf";
import { renderWeb } from "./channels/web";
import { writeRenderLog } from "./log";
import { checkDocument } from "./schema-check";

// The render pipeline behind POST /api/v1/templates/{templateId}/render. The editor preview, the
// review screen and the simulator all come through here, so an approver sees what a customer gets.
//
//   1 template (+ content type)  → 404 template_not_found
//   2 version, or the open draft → 404 version_not_found          (nothing is logged before here)
//   3 preview: viewer sees the team → 403 preview_forbidden; consumer: registered → 403 unknown_consumer
//   4 version rules (consumers only) → 409 / 410
//   5 channel: content type allows it → 422 channel_not_allowed; version has it → 422 channel_not_enabled
//   6 values → 422 missing_variables / invalid_values
//   7 the body fits the editor schema, 8 resolve, 9 the channel adapter → 500 render_failed
//  10 one render_log row, ok or error. Never values.

export interface RenderInput {
  templateId: string;
  version: number | "draft";
  channel: Channel;
  values: Readonly<Record<string, unknown>>;
  /** Carried for the route; the pipeline's output is the same either way. */
  encoding?: "base64";
  preview: boolean;
  /** The X-Consumer-Id header; ignored (and logged as null) on previews. */
  consumerId: string | null;
  correlationId: string;
  /** The persona, for previews. */
  viewer: Viewer | null;
}

export type RenderBody = Uint8Array | string | EmailRender;

export type RenderResult =
  | {
      ok: true;
      channel: Channel;
      /** null for the open draft. */
      versionNumber: number | null;
      /** The Active version's number when the rendered one is Superseded. */
      newerVersion: number | null;
      /** "UC-4F7K2Q-v2.pdf", "UC-4F7K2Q-draft.html". */
      filename: string;
      /** pdf: bytes; web: the HTML document; email: subject, preheader, html and text. */
      body: RenderBody;
    }
  | { ok: false; error: RenderError };

const EXTENSION: Readonly<Record<Channel, string>> = { pdf: "pdf", web: "html", email: "json" };

const fail = (error: RenderError): RenderResult => ({ ok: false, error });

export function renderFilename(templateId: string, versionNumber: number | null, channel: Channel): string {
  return `${templateId}-${versionNumber === null ? "draft" : `v${versionNumber}`}.${EXTENSION[channel]}`;
}

/** Renders with the app database and the demo clock. Request time only (the clock awaits connection()). */
export async function renderTemplate(input: RenderInput): Promise<RenderResult> {
  return runRender(appDb, input, await now());
}

type TemplateRow = {
  id: string;
  name: string;
  teamId: string;
  contentTypeName: string;
  allowedChannels: Channel[];
};
type VersionRow = typeof versions.$inferSelect;

/**
 * The pipeline against a given database and time. `renderTemplate` supplies the real ones; the
 * tests run this against a temporary, seeded database.
 */
export async function runRender(db: Db, input: RenderInput, at: Date): Promise<RenderResult> {
  const started = performance.now();

  // The route checks both first; repeated here so no caller can skip them. Not logged.
  if (input.version === "draft" && !input.preview) return fail(badRequest(BAD_REQUEST_MESSAGES.version));
  if (!input.preview && !input.consumerId) return fail(consumerRequired());

  // 1. The template, with its content type.
  const [template] = await db
    .select({
      id: templates.id,
      name: templates.name,
      teamId: templates.teamId,
      contentTypeName: contentTypes.name,
      allowedChannels: contentTypes.allowedChannels,
    })
    .from(templates)
    .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
    .where(eq(templates.id, input.templateId))
    .limit(1);
  if (!template) return fail(templateNotFound(input.templateId));

  // 2. The version by number, or the open draft.
  const version = await db.query.versions.findFirst({
    where: and(
      eq(versions.templateId, template.id),
      input.version === "draft" ? eq(versions.state, "draft") : eq(versions.number, input.version),
    ),
  });
  if (!version) return fail(versionNotFound(template.id, input.version));

  // 3–9, then 10: every request that got this far is logged, whatever the outcome.
  const result = await renderVersion(db, input, template, version, at);
  await writeRenderLog(
    db,
    {
      templateId: template.id,
      versionId: version.id,
      versionNumber: version.number,
      consumerId: input.preview ? null : input.consumerId,
      channel: input.channel,
      isPreview: input.preview,
      correlationId: input.correlationId,
      outcome: result.ok ? "ok" : "error",
      errorCode: result.ok ? null : result.error.code,
      durationMs: performance.now() - started,
    },
    at,
  );
  return result;
}

async function activeNumber(db: Db, templateId: string): Promise<number | null> {
  const [row] = await db
    .select({ number: versions.number })
    .from(versions)
    .where(and(eq(versions.templateId, templateId), eq(versions.state, "active")))
    .limit(1);
  return row?.number ?? null;
}

async function renderVersion(
  db: Db,
  input: RenderInput,
  template: TemplateRow,
  version: VersionRow,
  at: Date,
): Promise<RenderResult> {
  let newerVersion: number | null = null;

  if (input.preview) {
    // 3. The CMS's own preview: the persona must be able to see the template's team.
    if (!input.viewer || !can(input.viewer, "template.view", { teamId: template.teamId }).ok) {
      return fail(previewForbidden());
    }
    // 4 is skipped (any state previews), but a Superseded version still names its successor.
    if (version.state === "superseded") newerVersion = await activeNumber(db, template.id);
  } else {
    // 3. A registered consumer.
    const consumerId = input.consumerId ?? "";
    const consumer = await db.query.consumers.findFirst({ where: eq(consumers.id, consumerId) });
    if (!consumer) return fail(unknownConsumer(consumerId));

    // 4. Version rules. Consumers always pin a number, so `version.number` is set here.
    const check = checkVersion({
      version: {
        number: version.number ?? 0,
        state: version.state,
        sunsetAt: version.sunsetAt,
        revokedAt: version.revoke?.confirmedAt ? new Date(version.revoke.confirmedAt) : null,
      },
      activeNumber: await activeNumber(db, template.id),
      now: at,
    });
    if (!check.ok) return fail(check.error);
    newerVersion = check.newerVersion;
  }

  // 5. The channel: allowed by the content type, then turned on for this version.
  if (!template.allowedChannels.includes(input.channel)) {
    return fail(channelNotAllowed(template.contentTypeName, input.channel));
  }
  if (!version.channels.includes(input.channel)) {
    return fail(channelNotEnabled(version.number, input.channel, version.channels));
  }

  // 6. Values, canonicalized.
  const validated = validateValues(version.variables, input.values);
  if (!validated.ok) return fail(validated.error);

  // 7–9. Anything that throws from here on is our failure, not the caller's.
  try {
    const ctx: ResolveContext = { variables: version.variables, values: validated.values };
    checkDocument(version.body);
    const doc: RenderDoc = {
      templateId: template.id,
      templateName: template.name,
      versionNumber: version.number,
      blocks: resolveDocument(version.body, ctx),
    };
    const body = await runAdapter(input.channel, doc, version, ctx);
    return {
      ok: true,
      channel: input.channel,
      versionNumber: version.number,
      newerVersion,
      filename: renderFilename(template.id, version.number, input.channel),
      body,
    };
  } catch (error) {
    reportFailure(template.id, version.number, input.channel, input.correlationId, error);
    return fail(renderFailed(input.channel));
  }
}

async function runAdapter(channel: Channel, doc: RenderDoc, version: VersionRow, ctx: ResolveContext): Promise<RenderBody> {
  switch (channel) {
    case "pdf":
      return renderPdf(doc);
    case "web":
      return renderWeb(doc);
    case "email": {
      if (version.emailSubject) checkDocument(version.emailSubject);
      if (version.emailPreheader) checkDocument(version.emailPreheader);
      return renderEmail(doc, {
        subject: resolveInlineField(version.emailSubject, ctx),
        preheader: resolveInlineField(version.emailPreheader, ctx),
      });
    }
  }
}

/**
 * Server log for a failed render. The error's message line is left out: an adapter or the
 * resolver could quote document text, and with it a customer's value.
 */
function reportFailure(templateId: string, version: number | null, channel: Channel, correlationId: string, error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const frames = error instanceof Error ? (error.stack ?? "").split("\n").slice(1, 6).join("\n") : "";
  console.error(
    `[render] ${templateId} ${version === null ? "draft" : `v${version}`} ${channel} failed (${name}), correlation ${correlationId}\n${frames}`,
  );
}
