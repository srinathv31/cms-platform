import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { currentStageOf } from "@/domain/approval-chain";
import { can, hasActiveTeamAccess } from "@/domain/permissions";
import {
  BAD_REQUEST_MESSAGES,
  badRequest,
  channelNotAllowed,
  channelNotEnabled,
  checkVersion,
  consumerRequired,
  previewForbidden,
  renderTarget,
  templateNotFound,
  unknownConsumer,
  versionNotFound,
} from "@/domain/render";
import type { PushPlatform } from "@/domain/messages/push";
import type { RenderError, RenderTarget } from "@/domain/render/types";
import type { Channel, Viewer } from "@/domain/types";
import { readBusinessZone } from "@/server/business-zone";
import { now } from "@/server/clock";
import { db as appDb, type Db } from "@/server/db/client";
import { approvalStages, approvals, consumers, contentTypes, templates, versions } from "@/server/db/schema/ucomp";
import { runEngine, type RenderBody } from "./engine";
import { writeRenderLog } from "./log";

// The render pipeline behind POST /api/v1/templates/{templateId}/render. The editor preview, the
// review screen and the simulator all come through here, so an approver sees what a customer gets.
//
//   0 the target: push needs a platform, no other channel takes one, push and SMS take no encoding
//     → 400 bad_request (not logged)
//   1 template (+ content type)  → 404 template_not_found
//   2 version, or the open draft → 404 version_not_found          (nothing is logged before here)
//   3 preview: viewer sees the team → 403 preview_forbidden; consumer: registered → 403 unknown_consumer
//   4 version rules (consumers only) → 409 / 410
//   5 channel: content type allows it → 422 channel_not_allowed; version has it → 422 channel_not_enabled
//   6–9 the engine (engine.ts): values → 422 missing_variables / invalid_values; the document check,
//     resolve and the channel adapter → 500 render_failed: "… Try again.", or a reason the caller
//     can act on (a stored document the check or the resolver refuses, or characters the PDF's
//     fonts can't draw; see `renderFailure`); a push or SMS over its limit → 422
//     push_payload_too_large / sms_too_long
//  10 one render_log row, ok or error. Never values: the channel and the error code only.

export interface RenderInput {
  templateId: string;
  version: number | "draft";
  channel: Channel;
  /** Required with push, refused with any other channel (`renderTarget`). */
  platform?: PushPlatform;
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

export type { RenderBody };

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
      /** pdf: bytes; web: the HTML document; email: subject, preheader, html and text; push and sms: their JSON. */
      body: RenderBody;
    }
  | { ok: false; error: RenderError };

const EXTENSION: Readonly<Record<Channel, string>> = { pdf: "pdf", web: "html", email: "json", push: "json", sms: "json" };

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
  teamId: string;
  contentTypeId: string;
  contentTypeName: string;
  allowedChannels: Channel[];
  smsFooter: string | null;
};
type VersionRow = typeof versions.$inferSelect;

/**
 * The pipeline against a given database and time. `renderTemplate` supplies the real ones; the
 * tests run this against a temporary, seeded database.
 */
export async function runRender(db: Db, input: RenderInput, at: Date): Promise<RenderResult> {
  const started = performance.now();

  // The route checks these first; repeated here so no caller can skip them. Not logged.
  if (input.version === "draft" && !input.preview) return fail(badRequest(BAD_REQUEST_MESSAGES.version));
  if (!input.preview && !input.consumerId) return fail(consumerRequired());
  const target = renderTarget(input.channel, input.platform, input.encoding);
  if (!target.ok) return fail(target.error);

  // 1. The template, with its content type.
  const [template] = await db
    .select({
      id: templates.id,
      teamId: templates.teamId,
      contentTypeId: templates.contentTypeId,
      contentTypeName: contentTypes.name,
      allowedChannels: contentTypes.allowedChannels,
      smsFooter: contentTypes.smsFooter,
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
  const result = await renderVersion(db, input, target.target, template, version, at);
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

/**
 * The viewer sees the template's team; or, as on the review screen (`requireReviewVersion`), the
 * stage this version waits on names them (a Legal reviewer outside the team), or they decided it AND
 * still have active access somewhere (the review screen gets that from `requireSpace`): a person
 * removed from every team, or lapsed, reads nothing they once approved.
 */
async function previewAllowed(db: Db, viewer: Viewer, template: TemplateRow, version: VersionRow): Promise<boolean> {
  if (can(viewer, "template.view", { teamId: template.teamId }).ok) return true;
  if (version.state === "in_review") {
    const chain = await db
      .select({ id: approvalStages.id, position: approvalStages.position, name: approvalStages.name, rule: approvalStages.approverRule })
      .from(approvalStages)
      .where(eq(approvalStages.contentTypeId, template.contentTypeId))
      .orderBy(asc(approvalStages.position));
    const rule = currentStageOf(version, chain)?.rule;
    const named = rule?.kind === "user" ? [rule.userId] : [];
    if (can(viewer, "template.view", { teamId: template.teamId, stageApproverIds: named }).ok) return true;
  }
  const [decided] = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.versionId, version.id), eq(approvals.actorId, viewer.userId)))
    .limit(1);
  return decided !== undefined && hasActiveTeamAccess(viewer);
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
  target: RenderTarget,
  template: TemplateRow,
  version: VersionRow,
  at: Date,
): Promise<RenderResult> {
  let newerVersion: number | null = null;

  if (input.preview) {
    // 3. The CMS's own preview: the persona must be able to see the template's team.
    if (!input.viewer || !(await previewAllowed(db, input.viewer, template, version))) {
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
      // A sunset's message names its day in the business time zone.
      zone: await readBusinessZone(db),
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

  // 6–9. The engine. The title is the rendered version's own name: a draft's rename never reaches
  // the Active version's output.
  const result = await runEngine(
    {
      templateId: template.id,
      templateName: version.name,
      versionNumber: version.number,
      variables: version.variables,
      values: input.values,
      body: version.body,
      channelFields: version.channelFields,
      smsFooter: template.smsFooter,
    },
    target,
    at,
  );
  if (!result.ok) {
    // Anything that throws from stage 7 on is our failure, not the caller's. A message over its limit
    // (push_payload_too_large, sms_too_long) is the values' doing, like invalid_values: not logged.
    if (result.error.code === "render_failed") reportFailure(template.id, version.number, input.channel, input.correlationId, result.cause);
    return fail(result.error);
  }
  return {
    ok: true,
    channel: input.channel,
    versionNumber: version.number,
    newerVersion,
    filename: renderFilename(template.id, version.number, input.channel),
    body: result.body,
  };
}

/**
 * Server log for a failed render. The error's message line is left out: an adapter or the
 * resolver could quote document text, and with it a customer's value (and an unrenderable
 * character may come from a value). The error's name says which failure it was.
 */
function reportFailure(templateId: string, version: number | null, channel: Channel, correlationId: string, error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const frames = error instanceof Error ? (error.stack ?? "").split("\n").slice(1, 6).join("\n") : "";
  console.error(
    `[render] ${templateId} ${version === null ? "draft" : `v${version}`} ${channel} failed (${name}), correlation ${correlationId}\n${frames}`,
  );
}
