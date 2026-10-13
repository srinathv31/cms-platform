import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { BUSINESS_ZONES, zoneLabel } from "@/domain/business-zone";
import { ALL_TEAMS_SPACE } from "@/domain/permissions";
import { ruleLabel } from "@/domain/platform-config/approval-chains";
import { TEAM_ICONS } from "@/domain/platform-config/limits";
import { zoneChangeConsequences } from "@/domain/platform-config/time-zone";
import { CHANNELS, contentTypeFamily, type PlatformRole } from "@/domain/types";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type {
  ApprovalChainsFacts,
  BusinessZoneFacts,
  ChannelRulesFacts,
  ContentTypesFacts,
  TeamsFacts,
} from "@/server/services/platform";
import type {
  ApprovalChainsSection,
  BusinessZoneSection,
  ChannelRulesSection,
  ContentTypesSection,
  TeamsSection,
} from "@/server/queries/access-models";
import { peopleById, personOf } from "@/domain/people";

// The Platform group of the settings modal (Platform Admin): Teams, Content types, Channel rules,
// Approval chains and Time zone. The facts and the decisions come from the platform service
// (`services().platform`, decision 0070): the configuration as stored and what the admin may do on it (`can`,
// decided). These read models word and lay them out (a stage's rule label, "All teams", the time zones'
// labels and what a change of zone leaves in place); they decide nothing. Read models: queries/access-models.ts.
// The consequences the UI shows before a change is committed come from the pure functions in
// domain/platform-config/, fed by these models:
//   - a new team: `validateNewTeam({ name, description, icon, existing: section.teams })` as the
//     admin types, and `newTeamConsequences(name, admin)`;
//   - a content type's sections: `describeSectionsChange({ contentTypeName, current, next })`, the
//     strip's lines and the reason Save waits, and `removeSectionRefusal(count)`;
//   - a channel turned off: `channelOffConsequences(row.name, channel, row.activeUsing[channel])`;
//     whether a switch may flip at all comes decided, `row.can.toggle[channel]`;
//   - a chain edit: `describeChainChange({ contentTypeName, current: chain.stages, next, people,
//     waiting })`, the "Now / After" cards and the lines under them, and `validateChain({ stages,
//     current: chain.stages, actorId: viewerId, people: approvers })`, the reason at each stage that
//     can't be saved;
//   - a new business time zone: `describeZoneChange({ current: section.zone, next })` as the admin
//     picks, then the read model's `consequences` (what stays put, `zoneChangeConsequences`).

/** A section's facts, or Not found: the Platform group isn't there for anyone but a Platform Admin (decision 0052). */
function orNotFound<T>(facts: ({ ok: true } & T) | { ok: false }): T {
  if (!facts.ok) notFound();
  return facts;
}

// ── Teams ─────────────────────────────────────────────────────

export const getTeamsSection = cache(async (): Promise<TeamsSection> => {
  const ctx = await requireRequestContext();
  return teamsSection(orNotFound(await services().platform.teams(ctx)));
});

/** The Teams section from the service's facts. */
export function teamsSection(facts: TeamsFacts): TeamsSection {
  const people = peopleById(facts.people);
  return {
    teams: facts.teams.map(({ adminIds, ...team }) => ({
      ...team,
      admins: adminIds.map((id) => personOf(people, id)),
    })),
    people: facts.firstAdminCandidates.map((c) => ({
      ...personOf(people, c.id),
      title: c.title,
    })),
    icons: TEAM_ICONS,
  };
}

// ── Content types ─────────────────────────────────────────────

export const getContentTypesSection = cache(
  async (): Promise<ContentTypesSection> => {
    const ctx = await requireRequestContext();
    return contentTypesSection(
      orNotFound(await services().platform.contentTypes(ctx)),
    );
  },
);

/** The Content types section from the service's facts. */
export function contentTypesSection(
  facts: ContentTypesFacts,
): ContentTypesSection {
  return {
    types: facts.types.map((t) => ({
      ...t,
      family: contentTypeFamily(t.allowedChannels),
    })),
  };
}

// ── Channel rules ─────────────────────────────────────────────

export const getChannelRulesSection = cache(
  async (): Promise<ChannelRulesSection> => {
    const ctx = await requireRequestContext();
    return channelRulesSection(
      orNotFound(await services().platform.channelRules(ctx)),
    );
  },
);

/** The Channel rules section from the service's facts. */
export function channelRulesSection(
  facts: ChannelRulesFacts,
): ChannelRulesSection {
  return { channels: CHANNELS, rows: facts.rows };
}

// ── Approval chains ───────────────────────────────────────────

export const getApprovalChainsSection = cache(
  async (): Promise<ApprovalChainsSection> => {
    const ctx = await requireRequestContext();
    return approvalChainsSection(
      orNotFound(await services().platform.approvalChains(ctx)),
      ctx.viewer.userId,
    );
  },
);

/** The Approval chains section from the service's facts: each stage's rule in words, and who a stage may name. */
export function approvalChainsSection(
  facts: ApprovalChainsFacts,
  viewerId: string,
): ApprovalChainsSection {
  const people = peopleById(facts.people);
  const platformRoleOf = new Map<string, PlatformRole | null>(
    facts.approvers.map((a) => [a.id, a.platformRole]),
  );
  return {
    chains: facts.chains.map((chain) => ({
      ...chain,
      stages: chain.stages.map((s) => ({
        ...s,
        ruleLabel: ruleLabel(s.rule, facts.approvers),
      })),
    })),
    // Beside a name: the teams whose templates the person sees today ("All teams" for a platform role).
    people: facts.choices.map((c) => ({
      ...personOf(people, c.id),
      title: c.title,
      teams: platformRoleOf.get(c.id) ? [ALL_TEAMS_SPACE.name] : c.teamNames,
    })),
    approvers: facts.approvers,
    viewerId,
  };
}

// ── Business time zone ────────────────────────────────────────

export const getBusinessZoneSection = cache(
  async (): Promise<BusinessZoneSection> => {
    const ctx = await requireRequestContext();
    return businessZoneSection(
      orNotFound(await services().platform.businessZone(ctx)),
    );
  },
);

/** The Time zone section from the service's facts. */
export function businessZoneSection(
  facts: BusinessZoneFacts,
): BusinessZoneSection {
  return {
    zone: facts.zone,
    zones: BUSINESS_ZONES.map((z) => ({ id: z.id, label: zoneLabel(z.id) })),
    can: facts.can,
    consequences: zoneChangeConsequences(facts.pendingSunsets),
  };
}
