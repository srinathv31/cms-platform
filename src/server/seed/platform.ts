import type { Channel } from "@/domain/types";
import type { SeedCtx } from "./context";
import { REQUIRED_SECTIONS } from "./content";

export const CONTENT_TYPE_ID = "ct_disclosure";
export const CHANNELS_ALL: Channel[] = ["pdf", "web", "email"];

export const CONSUMER_IDS = ["coral", "deposits-online"] as const;
export type ConsumerId = (typeof CONSUMER_IDS)[number];

export function seedPlatform(ctx: SeedCtx) {
  ctx.sink.contentTypes.push({
    id: CONTENT_TYPE_ID,
    key: "disclosure",
    name: "Disclosure",
    requiredSections: REQUIRED_SECTIONS.map((s) => ({ key: s.key, title: s.title })),
    allowedChannels: CHANNELS_ALL,
  });

  // Release 1 has a single stage. The chain is configuration, so Riley can grow it live.
  ctx.sink.approvalStages.push({
    id: "stage_disclosure_0",
    contentTypeId: CONTENT_TYPE_ID,
    position: 0,
    name: "Team approver",
    approverRule: { kind: "team_role", role: "approver" },
  });

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
