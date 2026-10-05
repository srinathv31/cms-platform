import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import type {
  ApprovalChainsSection,
  ApprovalChainView,
  ChannelRulesSection,
  ContentTypesSection,
  TeamsSection,
} from "@/domain/access-types";
import { can } from "@/domain/permissions";
import { ruleLabel, TEAM_ICONS } from "@/domain/platform-config";
import { CHANNELS, TEAM_ROLES, type Channel } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  approvalStages,
  contentTypes,
  membershipRoles,
  memberships,
  teams,
  templates,
  users,
  versions,
} from "@/server/db/schema/ucomp";
import { getViewer } from "@/server/viewer";
import { getPeople, iso, personOf } from "./review-shared";

// The Platform group of the settings modal (Platform Admin): Teams, Content types, Channel rules and
// Approval chains. Read models: domain/access-types.ts. The consequences the UI shows before a change
// is committed come from the pure functions in domain/platform-config.ts, fed by these models:
//   - a channel turned off: `channelOffConsequences(row.name, channel, row.activeUsing[channel])`;
//   - a chain edit: `describeChainChange({ contentTypeName, current: chain.stages, next, people,
//     waiting })`, the "Now / After" cards and the lines under them.

/** Platform Admin only; anyone else gets a 404 (the Platform group isn't shown to them). */
async function requireManage() {
  const viewer = await getViewer();
  if (!can(viewer, "platform.manage", { teamId: null }).ok) notFound();
  return viewer;
}

/** Active members per team and each team's active Team Admins. */
async function activeMembers() {
  return db
    .select({ teamId: memberships.teamId, userId: memberships.userId, role: membershipRoles.role })
    .from(memberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .where(eq(memberships.status, "active"));
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

// ── Teams ─────────────────────────────────────────────────────

export const getTeamsSection = cache(async (): Promise<TeamsSection> => {
  await requireManage();
  const [teamRows, members, templateRows, userRows, people] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.name)),
    activeMembers(),
    db.select({ teamId: templates.teamId }).from(templates),
    db.select({ id: users.id, name: users.name, title: users.title }).from(users),
    getPeople(),
  ]);

  return {
    teams: teamRows.map((t) => {
      const here = members.filter((m) => m.teamId === t.id);
      const admins = [...new Set(here.filter((m) => m.role === "team_admin").map((m) => m.userId))]
        .map((id) => personOf(people, id))
        .sort(byName);
      return {
        id: t.id,
        slug: t.slug,
        name: t.name,
        description: t.description,
        icon: t.icon,
        admins,
        members: new Set(here.map((m) => m.userId)).size,
        templates: templateRows.filter((r) => r.teamId === t.id).length,
        createdAt: iso(t.createdAt),
      };
    }),
    people: userRows.map((u) => ({ ...personOf(people, u.id), title: u.title })).sort(byName),
    icons: TEAM_ICONS,
  };
});

// ── Content types ─────────────────────────────────────────────

export const getContentTypesSection = cache(async (): Promise<ContentTypesSection> => {
  await requireManage();
  const [types, templateRows] = await Promise.all([
    db.select().from(contentTypes).orderBy(asc(contentTypes.name)),
    db.select({ contentTypeId: templates.contentTypeId }).from(templates),
  ]);
  return {
    types: types.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      requiredSections: t.requiredSections,
      allowedChannels: CHANNELS.filter((c) => t.allowedChannels.includes(c)),
      templates: templateRows.filter((r) => r.contentTypeId === t.id).length,
    })),
  };
});

// ── Channel rules ─────────────────────────────────────────────

export const getChannelRulesSection = cache(async (): Promise<ChannelRulesSection> => {
  await requireManage();
  const [types, active] = await Promise.all([
    db.select().from(contentTypes).orderBy(asc(contentTypes.name)),
    db
      .select({ contentTypeId: templates.contentTypeId, channels: versions.channels })
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .where(eq(versions.state, "active")),
  ]);
  const perChannel = <T>(fn: (channel: Channel) => T) =>
    Object.fromEntries(CHANNELS.map((c) => [c, fn(c)])) as Record<Channel, T>;

  return {
    channels: CHANNELS,
    rows: types.map((t) => {
      const mine = active.filter((v) => v.contentTypeId === t.id);
      return {
        contentTypeId: t.id,
        name: t.name,
        allowed: perChannel((c) => t.allowedChannels.includes(c)),
        activeUsing: perChannel((c) => mine.filter((v) => v.channels.includes(c)).length),
      };
    }),
  };
});

// ── Approval chains ───────────────────────────────────────────

export const getApprovalChainsSection = cache(async (): Promise<ApprovalChainsSection> => {
  await requireManage();
  const [types, stageRows, inReview, members, userRows, people] = await Promise.all([
    db.select({ id: contentTypes.id, name: contentTypes.name }).from(contentTypes).orderBy(asc(contentTypes.name)),
    db.select().from(approvalStages).orderBy(asc(approvalStages.position)),
    db
      .select({ contentTypeId: templates.contentTypeId, currentStage: versions.currentStage })
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .where(eq(versions.state, "in_review")),
    db
      .select({ userId: memberships.userId, teamName: teams.name })
      .from(memberships)
      .innerJoin(teams, eq(teams.id, memberships.teamId))
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .where(eq(memberships.status, "active")),
    db.select({ id: users.id, name: users.name, title: users.title, platformRole: users.platformRole }).from(users),
    getPeople(),
  ]);
  const named = userRows.map((u) => ({ id: u.id, name: u.name }));

  const chains: ApprovalChainView[] = types.map((type) => {
    const stages = stageRows.filter((s) => s.contentTypeId === type.id);
    const waiting = inReview.filter((v) => v.contentTypeId === type.id);
    // A stage index past the end reads as the last stage, as on the review screen.
    const at = (currentStage: number) => Math.min(Math.max(currentStage, 0), stages.length - 1);
    return {
      contentTypeId: type.id,
      name: type.name,
      stages: stages.map((s, index) => ({
        id: s.id,
        position: index,
        name: s.name,
        rule: s.approverRule,
        ruleLabel: ruleLabel(s.approverRule, named),
        waiting: waiting.filter((v) => at(v.currentStage) === index).length,
      })),
    };
  });

  // Someone a stage may name: anyone with active access (a team, or a platform role) — a person with
  // none could never act on the stage — except an Auditor, who is read-only. Beside the name: the
  // teams whose templates they see today.
  const choices = userRows.flatMap((u) => {
    if (u.platformRole === "auditor") return [];
    const teamNames = [...new Set(members.filter((m) => m.userId === u.id).map((m) => m.teamName))].sort();
    const seen = u.platformRole ? ["All teams"] : teamNames;
    return seen.length ? [{ ...personOf(people, u.id), title: u.title, teams: seen }] : [];
  });

  return { chains, people: choices.sort(byName), roles: TEAM_ROLES };
});
