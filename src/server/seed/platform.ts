import type { PlatformArea } from "@/domain/access-types";
import { chainStageFacts } from "@/domain/platform-config/approval-chains";
import { configChanged } from "@/domain/platform-config/effects";
import { DEFAULT_SMS_MAX_PARTS } from "@/domain/platform-config/limits";
import type { Channel } from "@/domain/types";
import type { SeedCtx } from "./context";
import { REQUIRED_SECTIONS } from "./content";

export const CONTENT_TYPE_ID = "ct_disclosure";
export const CHANNELS_ALL: Channel[] = ["pdf", "web", "email"];

/** The Disclosure chain's one stage, which every seeded version records (`versions.stages`) and was decided at. */
export const TEAM_STAGE = {
  id: "stage_disclosure_0",
  name: "Team approver",
} as const;

/**
 * The Alert content type: messages, rendered to Push and SMS from their own short fields, never from a
 * body (decision 0034). No required sections: an alert has no document. Every SMS ends with its footer,
 * the brand and the opt-out that CTIA asks of a US sender, and may take 3 parts with the long sample
 * values.
 */
export const ALERT_CONTENT_TYPE_ID = "ct_alert";
export const ALERT_CHANNELS: Channel[] = ["push", "sms"];
export const ALERT_SMS_FOOTER = "Coral: Reply STOP to opt out, HELP for help.";
/** The Alert chain's one stage. */
export const ALERT_STAGE = {
  id: "stage_alert_0",
  name: "Team approver",
} as const;

/**
 * The seeded content types as a seeded template names its own (`SeedTemplate.contentType`): the row it
 * belongs to, the chain stage its versions go through, the channels it allows, the required sections
 * every version's body has, in order, and its SMS footer (which every submitted version froze at submit).
 */
export const SEED_CONTENT_TYPES = {
  disclosure: {
    id: CONTENT_TYPE_ID,
    stage: TEAM_STAGE,
    channels: CHANNELS_ALL,
    requiredSections: REQUIRED_SECTIONS.map((s) => s.key) as string[],
    smsFooter: null,
  },
  alert: {
    id: ALERT_CONTENT_TYPE_ID,
    stage: ALERT_STAGE,
    channels: ALERT_CHANNELS,
    requiredSections: [] as string[],
    smsFooter: ALERT_SMS_FOOTER,
  },
} as const;
export type SeedContentType = keyof typeof SEED_CONTENT_TYPES;

export const CONSUMER_IDS = ["coral", "deposits-online"] as const;
export type ConsumerId = (typeof CONSUMER_IDS)[number];

export function seedPlatform(ctx: SeedCtx) {
  ctx.sink.contentTypes.push(
    {
      id: CONTENT_TYPE_ID,
      key: "disclosure",
      name: "Disclosure",
      requiredSections: REQUIRED_SECTIONS.map((s) => ({
        key: s.key,
        title: s.title,
      })),
      allowedChannels: CHANNELS_ALL,
      smsFooter: null,
      smsMaxParts: DEFAULT_SMS_MAX_PARTS,
    },
    {
      id: ALERT_CONTENT_TYPE_ID,
      key: "alert",
      name: "Alert",
      requiredSections: [],
      allowedChannels: ALERT_CHANNELS,
      smsFooter: ALERT_SMS_FOOTER,
      smsMaxParts: DEFAULT_SMS_MAX_PARTS,
    },
  );

  // Release 1 has a single stage. The chain is configuration, so Riley can grow it live.
  ctx.sink.approvalStages.push(
    {
      id: TEAM_STAGE.id,
      contentTypeId: CONTENT_TYPE_ID,
      position: 0,
      name: TEAM_STAGE.name,
      approverRule: { kind: "team_role", role: "approver" },
    },
    {
      id: ALERT_STAGE.id,
      contentTypeId: ALERT_CONTENT_TYPE_ID,
      position: 0,
      name: ALERT_STAGE.name,
      approverRule: { kind: "team_role", role: "approver" },
    },
  );

  ctx.sink.consumers.push(
    {
      id: "coral",
      name: "Coral",
      description: "Offers platform",
      clientName: "coral-offers-svc",
    },
    {
      id: "deposits-online",
      name: "Deposits Online",
      description: "Digital banking",
      clientName: "deposits-online-web",
    },
  );

  // The platform's configuration story, in the facts the runtime writes when someone makes each change
  // (`platform.config_changed`, by area). A channel rule is one event per channel.
  const config = (
    daysAgo: number,
    area: PlatformArea,
    facts: Record<string, unknown>,
  ) =>
    ctx.sink.auditEvents.push({
      id: ctx.id("platform", "ae"),
      at: ctx.at(daysAgo),
      actorId: "riley",
      action: "platform.config_changed",
      details: platformConfigDetails(area, facts),
    });

  const disclosureTitles = REQUIRED_SECTIONS.map((s) => s.title);
  const chain = [
    chainStageFacts(
      { name: TEAM_STAGE.name, rule: { kind: "team_role", role: "approver" } },
      [],
    ),
  ];

  const contentTypes = [
    {
      daysAgo: 430,
      channelsDaysAgo: 428,
      id: CONTENT_TYPE_ID,
      name: "Disclosure",
      allowed: CHANNELS_ALL,
      sections: disclosureTitles,
    },
    {
      daysAgo: 60,
      channelsDaysAgo: 60,
      id: ALERT_CONTENT_TYPE_ID,
      name: "Alert",
      allowed: ALERT_CHANNELS,
      sections: [],
    },
  ];
  for (const type of contentTypes) {
    config(type.daysAgo, "content_types", {
      contentTypeId: type.id,
      contentTypeName: type.name,
      // An alert has no sections to add: its event records that the content type was created (nothing in the
      // app creates one yet, so only the seed writes `created`).
      ...(type.sections.length === 0 ? { created: true } : {}),
      added: type.sections,
      removed: [],
      renamed: [],
      reordered: false,
      sections: type.sections,
    });
    config(type.daysAgo, "approval_chains", {
      contentTypeId: type.id,
      contentTypeName: type.name,
      before: [],
      after: [TEAM_STAGE.name],
      stages: chain,
    });
    for (const channel of type.allowed) {
      config(type.channelsDaysAgo, "channel_rules", {
        contentTypeId: type.id,
        contentTypeName: type.name,
        channel,
        allowed: true,
        activeUsing: 0,
      });
    }
  }
}

/**
 * The `details` of a `platform.config_changed` row: the area and the area's facts, built by the function the
 * runtime builds them with.
 */
export function platformConfigDetails(
  area: PlatformArea,
  facts: Record<string, unknown>,
): Record<string, unknown> {
  const effect = configChanged(area, null, facts);
  if (effect.kind !== "audit") throw new Error("Seed: not an audit effect");
  return effect.details;
}
