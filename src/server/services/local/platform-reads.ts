import "server-only";
import { asc, eq } from "drizzle-orm";
import type { ApproverFacts } from "@/domain/access-types";
import { versionsNeeding } from "@/domain/approval-chain";
import { can, REASONS } from "@/domain/permissions";
import { approverProblem } from "@/domain/platform-config/approval-chains";
import { channelRuleRefusal } from "@/domain/platform-config/channels";
import { sectionsRefusal } from "@/domain/platform-config/sections";
import { cannotBeFirstTeamAdmin } from "@/domain/platform-config/teams";
import { refuse, type Refusal } from "@/domain/refusals";
import { CHANNELS, type Channel, type PermissionResult } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  approvalStages,
  contentTypes,
  membershipRoles,
  memberships,
  teams,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import { refusal } from "../results";
import type { PlatformService } from "../platform";
import type { RequestContext } from "../types";
import { countPendingSunsets, readBusinessZone } from "./business-zone";
import type { LocalDeps } from "./command";
import { byName, loadUsers, nameOf, peopleOf, titleOf } from "./users";

// Platform settings on this app's own database, the reads (src/server/services/platform.ts says what each
// promises): the configuration as stored, and what the admin may do on it, decided by the domain
// (src/domain/platform-config/). Nothing here is worded.

/** A rule's refusal as a read answers it decided: refused with its code and sentence, or allowed. */
const decided = (problem: Refusal | null): PermissionResult =>
  problem ? refuse(problem) : { ok: true };

/** Every section is the Platform Admin's: anyone else is refused (the BFF turns it into Not found). */
const mayManage = (ctx: RequestContext) =>
  can(ctx.viewer, "platform.manage", { teamId: null });
const refused = () => refusal(403, REASONS.generic);

/** Active memberships with their roles: per team who is in it and who is a Team Admin. */
async function activeMembers() {
  return db
    .select({
      teamId: memberships.teamId,
      userId: memberships.userId,
      role: membershipRoles.role,
      teamName: teams.name,
    })
    .from(memberships)
    .innerJoin(
      membershipRoles,
      eq(membershipRoles.membershipId, memberships.id),
    )
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(eq(memberships.status, "active"));
}

export function localPlatformReads(
  deps: LocalDeps,
): Pick<
  PlatformService,
  "teams" | "contentTypes" | "channelRules" | "approvalChains" | "businessZone"
> {
  return {
    async teams(ctx) {
      if (!mayManage(ctx).ok) return refused();
      const [teamRows, members, templateRows, all] = await Promise.all([
        db.select().from(teams).orderBy(asc(teams.name), asc(teams.id)),
        activeMembers(),
        db.select({ teamId: templates.teamId }).from(templates),
        loadUsers(),
      ]);
      const facts = teamRows.map((t) => {
        const here = members.filter((m) => m.teamId === t.id);
        return {
          id: t.id,
          slug: t.slug,
          name: t.name,
          description: t.description,
          icon: t.icon,
          adminIds: [
            ...new Set(
              here.filter((m) => m.role === "team_admin").map((m) => m.userId),
            ),
          ].sort(byName(all)),
          members: new Set(here.map((m) => m.userId)).size,
          templates: templateRows.filter((r) => r.teamId === t.id).length,
          createdAt: t.createdAt.toISOString(),
          appName: t.appName,
          smsSender: t.smsSender,
        };
      });
      // The first Team Admin: whoever the domain lets be one (not an Auditor).
      const candidates = [...all.values()]
        .filter((u) => !cannotBeFirstTeamAdmin(u))
        .map((u) => u.id)
        .sort(byName(all));
      return {
        ok: true,
        teams: facts,
        firstAdminCandidates: candidates.map((id) => ({
          id,
          title: titleOf(all, id),
        })),
        people: peopleOf(all, [
          ...facts.flatMap((t) => t.adminIds),
          ...candidates,
        ]),
      };
    },

    async contentTypes(ctx) {
      if (!mayManage(ctx).ok) return refused();
      const [types, templateRows] = await Promise.all([
        db.select().from(contentTypes).orderBy(asc(contentTypes.name)),
        db.select({ contentTypeId: templates.contentTypeId }).from(templates),
      ]);
      return {
        ok: true,
        types: types.map((t) => ({
          id: t.id,
          key: t.key,
          name: t.name,
          allowedChannels: CHANNELS.filter((c) =>
            t.allowedChannels.includes(c),
          ),
          requiredSections: t.requiredSections,
          smsFooter: t.smsFooter,
          smsMaxParts: t.smsMaxParts,
          templates: templateRows.filter((r) => r.contentTypeId === t.id)
            .length,
          can: { editSections: decided(sectionsRefusal(t)) },
        })),
      };
    },

    async channelRules(ctx) {
      if (!mayManage(ctx).ok) return refused();
      const [types, active] = await Promise.all([
        db.select().from(contentTypes).orderBy(asc(contentTypes.name)),
        db
          .select({
            contentTypeId: templates.contentTypeId,
            channels: versions.channels,
          })
          .from(versions)
          .innerJoin(templates, eq(templates.id, versions.templateId))
          .where(eq(versions.state, "active")),
      ]);
      const perChannel = <T>(fn: (channel: Channel) => T) =>
        Object.fromEntries(CHANNELS.map((c) => [c, fn(c)])) as Record<
          Channel,
          T
        >;
      return {
        ok: true,
        rows: types.map((t) => {
          const mine = active.filter((v) => v.contentTypeId === t.id);
          return {
            contentTypeId: t.id,
            name: t.name,
            allowed: perChannel((c) => t.allowedChannels.includes(c)),
            activeUsing: perChannel(
              (c) => mine.filter((v) => v.channels.includes(c)).length,
            ),
            can: {
              // The last channel on can't go off, and a channel of the other family can't go on.
              toggle: perChannel((c) =>
                decided(
                  channelRuleRefusal(
                    t,
                    c,
                    !t.allowedChannels.includes(c),
                    types,
                  ),
                ),
              ),
            },
          };
        }),
      };
    },

    async approvalChains(ctx) {
      if (!mayManage(ctx).ok) return refused();
      const [types, stageRows, inReview, members, all] = await Promise.all([
        db
          .select({ id: contentTypes.id, name: contentTypes.name })
          .from(contentTypes)
          .orderBy(asc(contentTypes.name)),
        db.select().from(approvalStages).orderBy(asc(approvalStages.position)),
        db
          .select({
            contentTypeId: templates.contentTypeId,
            stages: versions.stages,
            currentStage: versions.currentStage,
          })
          .from(versions)
          .innerJoin(templates, eq(templates.id, versions.templateId))
          .where(eq(versions.state, "in_review")),
        activeMembers(),
        loadUsers(),
      ]);

      const chains = types.map((type) => {
        const chain = stageRows
          .filter((s) => s.contentTypeId === type.id)
          .map((s, index) => ({
            id: s.id,
            position: index,
            name: s.name,
            rule: s.approverRule,
          }));
        // Per stage, the versions in review that still need it, in the stages they recorded at submit.
        const needing = versionsNeeding(
          inReview.filter((v) => v.contentTypeId === type.id),
          chain,
        );
        return {
          contentTypeId: type.id,
          name: type.name,
          stages: chain.map((s) => ({ ...s, waiting: needing[s.id] ?? 0 })),
        };
      });

      // What validateChain checks about each person; `members` holds only active memberships with a role.
      const userIds = [...all.keys()];
      const facts = new Map<string, ApproverFacts>(
        userIds.map((id) => [
          id,
          {
            id,
            name: nameOf(all, id),
            platformRole: all.get(id)!.platformRole,
            activeTeamRole: members.some((m) => m.userId === id),
          },
        ]),
      );
      // Someone a stage may name: whoever the domain's approverProblem allows (an active team role, not an
      // Auditor, not the admin choosing). Beside the name: the teams whose templates they see today.
      const choices = userIds
        .filter((id) => !approverProblem(facts.get(id)!, ctx.viewer.userId))
        .sort(byName(all))
        .map((id) => ({
          id,
          title: titleOf(all, id),
          teamNames: [
            ...new Set(
              members.filter((m) => m.userId === id).map((m) => m.teamName),
            ),
          ].sort(),
        }));
      // The editor validates every stage, so it needs the facts for the people stages name now as well.
      const named = stageRows.flatMap((s) =>
        s.approverRule.kind === "user" ? [s.approverRule.userId] : [],
      );
      const relevant = new Set([...choices.map((c) => c.id), ...named]);
      return {
        ok: true,
        chains,
        choices,
        approvers: [...facts.values()].filter((f) => relevant.has(f.id)),
        people: peopleOf(all, relevant),
      };
    },

    async businessZone(ctx) {
      const allowed = mayManage(ctx);
      if (!allowed.ok) return refused();
      const now = await deps.clock();
      const [zone, pendingSunsets] = await Promise.all([
        readBusinessZone(db),
        countPendingSunsets(db, now),
      ]);
      return {
        ok: true,
        asOf: now.toISOString(),
        zone,
        pendingSunsets,
        can: { change: allowed },
      };
    },
  };
}
