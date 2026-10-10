import { DEFAULT_SMS_MAX_PARTS } from "@/domain/platform-config";
import type { Channel } from "@/domain/types";
import type { SeedCtx } from "./context";
import { REQUIRED_SECTIONS } from "./content";

export const CONTENT_TYPE_ID = "ct_disclosure";
export const CHANNELS_ALL: Channel[] = ["pdf", "web", "email"];

/** The Disclosure chain's one stage, which every seeded version records (`versions.stages`) and was decided at. */
export const TEAM_STAGE = { id: "stage_disclosure_0", name: "Team approver" } as const;

/**
 * The Alert content type: messages, rendered to Push and SMS from their own short fields, never from a
 * body (decision 0033). No required sections: an alert has no document. Every SMS ends with its footer,
 * the brand and the opt-out that CTIA asks of a US sender, and may take 3 parts with the long sample
 * values.
 */
export const ALERT_CONTENT_TYPE_ID = "ct_alert";
export const ALERT_CHANNELS: Channel[] = ["push", "sms"];
export const ALERT_SMS_FOOTER = "Coral Offers: Reply STOP to opt out, HELP for help.";
/** The Alert chain's one stage. */
export const ALERT_STAGE = { id: "stage_alert_0", name: "Team approver" } as const;

/**
 * The seeded content types as a seeded template names its own (`SeedTemplate.contentType`): the row it
 * belongs to, the chain stage its versions go through, the channels it allows and the required sections
 * every version's body has, in order.
 */
export const SEED_CONTENT_TYPES = {
  disclosure: {
    id: CONTENT_TYPE_ID,
    stage: TEAM_STAGE,
    channels: CHANNELS_ALL,
    requiredSections: REQUIRED_SECTIONS.map((s) => s.key) as string[],
  },
  alert: { id: ALERT_CONTENT_TYPE_ID, stage: ALERT_STAGE, channels: ALERT_CHANNELS, requiredSections: [] as string[] },
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
      requiredSections: REQUIRED_SECTIONS.map((s) => ({ key: s.key, title: s.title })),
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

  const configEvents = [
    { daysAgo: 430, area: "content_types", summary: "Created content type Disclosure with 3 required sections" },
    { daysAgo: 430, area: "approval_chains", summary: "Set Disclosure approval chain: Team approver" },
    { daysAgo: 428, area: "channel_rules", summary: "Allowed pdf, web and email for Disclosure" },
    { daysAgo: 60, area: "content_types", summary: "Created content type Alert with an SMS footer and a 3-part budget" },
    { daysAgo: 60, area: "approval_chains", summary: "Set Alert approval chain: Team approver" },
    { daysAgo: 60, area: "channel_rules", summary: "Allowed push and sms for Alert" },
  ];
  for (const e of configEvents) {
    ctx.sink.auditEvents.push({
      id: ctx.id("ae"),
      at: ctx.at(e.daysAgo),
      actorId: "riley",
      action: "platform.config_changed",
      details: { area: e.area, summary: e.summary },
    });
  }
}
