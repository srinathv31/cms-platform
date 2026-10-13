import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ApproverFacts } from "@/domain/access-types";
import {
  approvedThisRound,
  currentStageOf,
  stageRecipients,
} from "@/domain/approval-chain";
import { saveApprovalChain } from "@/domain/platform-config/approval-chains";
import { setChannelRule } from "@/domain/platform-config/channels";
import { PLATFORM_REFUSALS } from "@/domain/platform-config/refusals";
import { updateRequiredSections } from "@/domain/platform-config/sections";
import { createTeam } from "@/domain/platform-config/teams";
import { setBusinessZone } from "@/domain/platform-config/time-zone";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { asNumbered, reviewLink } from "@/domain/rounds";
import type { ApproverRule, Channel, Viewer } from "@/domain/types";
import {
  approvalStages,
  contentTypes,
  membershipRoles,
  memberships,
  settings,
  teams,
  templates,
  users,
  versions,
} from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import { notMoved } from "../not-moved";
import type { PlatformService } from "../platform";
import type { Changed } from "../types";
import { applyMembershipChange, writeAccessEffects } from "./access-effects";
import {
  BUSINESS_ZONE_KEY,
  countPendingSunsets,
  readBusinessZone,
} from "./business-zone";
import { loadDecisions } from "./chain";
import { check, refuse, runCommand, type LocalDeps } from "./command";
import { writeEffects } from "./effects";
import type { Tx } from "./transaction";

// Platform settings on this app's own database (src/server/services/platform.ts says what each command promises).
// Each runs on the command kit (./command.ts): `authorize` checks `platform.manage` (a cross-team permission: no
// team); the one transaction reads the facts, asks the domain (src/domain/platform-config), and writes its answer
// with its audit rows and notifications (./access-effects.ts), all dated by the backend's clock. A setting saved as
// it already is answers `changed: false` and writes nothing.

/** Platform Admin only. */
function manage({ ctx }: { ctx: { viewer: Viewer } }) {
  check(ctx.viewer, "platform.manage", { teamId: null });
}

const actorOf = (viewer: Viewer) => ({ id: viewer.userId, name: viewer.name });

const unchanged: ActionResult<Changed> = { ok: true, changed: false };
const changed: ActionResult<Changed> = { ok: true, changed: true };

async function contentTypeRow(tx: Tx, id: string) {
  const row = await tx.query.contentTypes.findFirst({
    where: eq(contentTypes.id, id),
  });
  if (!row) refuse(REQUEST_REFUSALS.contentTypeGone);
  return row;
}

/** Active versions of the content type's templates that render to the channel. */
async function activeUsing(
  tx: Tx,
  contentTypeId: string,
  channel: Channel,
): Promise<number> {
  const rows = await tx
    .select({ channels: versions.channels })
    .from(versions)
    .innerJoin(templates, eq(templates.id, versions.templateId))
    .where(
      and(
        eq(templates.contentTypeId, contentTypeId),
        eq(versions.state, "active"),
      ),
    );
  return rows.filter((r) => r.channels.includes(channel)).length;
}

/** Everyone, with what the domain's validateChain checks: their platform role and whether they hold an active team role. */
async function approverFacts(tx: Tx): Promise<ApproverFacts[]> {
  const people = await tx
    .select({
      id: users.id,
      name: users.name,
      platformRole: users.platformRole,
    })
    .from(users);
  const active = await tx
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(
      membershipRoles,
      eq(membershipRoles.membershipId, memberships.id),
    )
    .where(eq(memberships.status, "active"));
  const withRole = new Set(active.map((a) => a.userId));
  return people.map((p) => ({ ...p, activeTeamRole: withRole.has(p.id) }));
}

const sameRule = (a: ApproverRule, b: ApproverRule) =>
  a.kind === "user"
    ? b.kind === "user" && a.userId === b.userId
    : b.kind === "team_role" && a.role === b.role;

export function localPlatform(deps: LocalDeps): PlatformService {
  return {
    createTeam: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: manage,
        transaction: async (
          tx,
          { ctx, input, now },
        ): Promise<ActionResult<{ teamId: string; slug: string }>> => {
          const admin = await tx.query.users.findFirst({
            where: eq(users.id, input.adminUserId),
          });
          if (!admin) refuse(PLATFORM_REFUSALS.pickPerson);
          const outcome = createTeam({
            id: newId("t"),
            name: input.name,
            description: input.description,
            icon: input.icon,
            admin: {
              id: admin.id,
              name: admin.name,
              platformRole: admin.platformRole,
            },
            actor: actorOf(ctx.viewer),
            now,
            existing: await tx
              .select({ slug: teams.slug, name: teams.name })
              .from(teams),
          });
          if (!outcome.ok) refuse(outcome);
          await tx.insert(teams).values(outcome.team);
          await applyMembershipChange(tx, outcome.membership);
          await writeAccessEffects(tx, outcome.effects, {
            now,
            actorId: ctx.viewer.userId,
          });
          return { ok: true, teamId: outcome.team.id, slug: outcome.team.slug };
        },
      }),

    updateContentType: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: manage,
        transaction: async (tx, { ctx, input, now }) => {
          const type = await contentTypeRow(tx, input.contentTypeId);
          const outcome = updateRequiredSections({
            contentType: type,
            next: input.requiredSections,
            actor: actorOf(ctx.viewer),
            now,
          });
          if (!outcome.ok) refuse(outcome);
          if (outcome.effects.length === 0) return unchanged;
          await tx
            .update(contentTypes)
            .set({ requiredSections: outcome.requiredSections })
            .where(eq(contentTypes.id, type.id));
          await writeAccessEffects(tx, outcome.effects, {
            now,
            actorId: ctx.viewer.userId,
          });
          return changed;
        },
      }),

    setChannelRule: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: manage,
        transaction: async (tx, { ctx, input, now }) => {
          const type = await contentTypeRow(tx, input.contentTypeId);
          const outcome = setChannelRule({
            contentType: type,
            channel: input.channel,
            allowed: input.allowed,
            activeUsing: await activeUsing(tx, type.id, input.channel),
            // To name, in a refusal, the content types a channel of the other family goes on.
            contentTypes: await tx
              .select({
                name: contentTypes.name,
                allowedChannels: contentTypes.allowedChannels,
              })
              .from(contentTypes),
            actor: actorOf(ctx.viewer),
            now,
          });
          if (!outcome.ok) refuse(outcome);
          if (outcome.effects.length === 0) return unchanged;
          await tx
            .update(contentTypes)
            .set({ allowedChannels: outcome.allowedChannels })
            .where(eq(contentTypes.id, type.id));
          await writeAccessEffects(tx, outcome.effects, {
            now,
            actorId: ctx.viewer.userId,
          });
          return changed;
        },
      }),

    saveApprovalChain: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: manage,
        transaction: async (tx, { ctx, input, now }) => {
          const type = await contentTypeRow(tx, input.contentTypeId);
          const current = await tx
            .select({
              id: approvalStages.id,
              position: approvalStages.position,
              name: approvalStages.name,
              rule: approvalStages.approverRule,
            })
            .from(approvalStages)
            .where(eq(approvalStages.contentTypeId, type.id))
            .orderBy(asc(approvalStages.position));
          const inReview = await tx
            .select({
              versionId: versions.id,
              stages: versions.stages,
              currentStage: versions.currentStage,
              number: versions.number,
              round: versions.round,
              state: versions.state,
              writers: versions.writers,
              templateId: templates.id,
              templateName: versions.name,
              teamId: templates.teamId,
            })
            .from(versions)
            .innerJoin(templates, eq(templates.id, versions.templateId))
            .where(
              and(
                eq(templates.contentTypeId, type.id),
                eq(versions.state, "in_review"),
              ),
            );

          const outcome = saveApprovalChain({
            contentType: { id: type.id, name: type.name },
            current,
            next: input.stages,
            inReview: inReview.map(({ versionId, stages, currentStage }) => ({
              versionId,
              stages,
              currentStage,
            })),
            people: await approverFacts(tx),
            actor: actorOf(ctx.viewer),
            now,
          });
          if (!outcome.ok) refuse(outcome);
          if (outcome.effects.length === 0) return unchanged;

          const keep = new Set(
            outcome.stages.flatMap((s) => (s.id ? [s.id] : [])),
          );
          const removed = current
            .filter((s) => !keep.has(s.id))
            .map((s) => s.id);
          if (removed.length)
            await tx
              .delete(approvalStages)
              .where(inArray(approvalStages.id, removed));
          for (const stage of outcome.stages) {
            const row = {
              position: stage.position,
              name: stage.name,
              approverRule: stage.rule,
            };
            if (stage.id)
              await tx
                .update(approvalStages)
                .set(row)
                .where(eq(approvalStages.id, stage.id));
            else
              await tx
                .insert(approvalStages)
                .values({ id: newId("stage"), contentTypeId: type.id, ...row });
          }
          // A stage that now names someone else (same stage, new rule): whoever it names now is told about the
          // versions already waiting on it, as if those had just arrived, unless they approved a stage of that
          // version already and so can't take this one. The version's own name for the stage, as its stepper
          // shows it.
          const decisions = await loadDecisions(
            tx,
            inReview.map((v) => v.versionId),
          );
          for (const v of inReview) {
            const before = currentStageOf(v, current);
            const after =
              before && outcome.stages.find((s) => s.id === before.id);
            if (
              !before ||
              !after ||
              sameRule(before.rule, after.rule) ||
              v.number === null
            )
              continue;
            const asked = stageRecipients(
              { ...before, rule: after.rule },
              v.writers,
              approvedThisRound(decisions.get(v.versionId) ?? []),
            );
            if (!asked) continue;
            const round = asNumbered(v);
            await writeEffects(
              tx,
              [
                {
                  kind: "notification",
                  notification: "review_requested",
                  to: asked,
                  facts: {
                    actorName: ctx.viewer.name,
                    templateName: v.templateName,
                    number: round.number,
                    round: round.round,
                    stage: before.name,
                  },
                  link: reviewLink(v.templateId, round),
                },
              ],
              {
                at: now,
                actorId: ctx.viewer.userId,
                teamId: v.teamId,
                templateId: v.templateId,
                versionId: v.versionId,
              },
            );
          }
          await writeAccessEffects(tx, outcome.effects, {
            now,
            actorId: ctx.viewer.userId,
          });
          return changed;
        },
      }),

    setBusinessZone: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: manage,
        transaction: async (tx, { ctx, input, now }) => {
          const outcome = setBusinessZone({
            current: await readBusinessZone(tx),
            next: input.zone,
            pendingSunsets: await countPendingSunsets(tx, now),
            actor: actorOf(ctx.viewer),
            now,
          });
          if (!outcome.ok) refuse(outcome);
          if (outcome.effects.length === 0) return unchanged;
          await tx
            .insert(settings)
            .values({ key: BUSINESS_ZONE_KEY, value: outcome.zone })
            .onConflictDoUpdate({
              target: settings.key,
              set: { value: outcome.zone },
            });
          await writeAccessEffects(tx, outcome.effects, {
            now,
            actorId: ctx.viewer.userId,
          });
          return changed;
        },
      }),

    teams: notMoved("platform.teams"),
    contentTypes: notMoved("platform.contentTypes"),
    channelRules: notMoved("platform.channelRules"),
    approvalChains: notMoved("platform.approvalChains"),
    businessZone: notMoved("platform.businessZone"),
  };
}
