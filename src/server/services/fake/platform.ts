import type { ApproverFacts } from "@/domain/access-types";
import {
  approvedThisRound,
  currentStageOf,
  stageRecipients,
  type RecordedDecision,
} from "@/domain/approval-chain";
import { sunsetPassed } from "@/domain/lifecycle/sunset";
import { saveApprovalChain } from "@/domain/platform-config/approval-chains";
import { setChannelRule } from "@/domain/platform-config/channels";
import { PLATFORM_REFUSALS } from "@/domain/platform-config/refusals";
import { updateRequiredSections } from "@/domain/platform-config/sections";
import { createTeam } from "@/domain/platform-config/teams";
import { setBusinessZone } from "@/domain/platform-config/time-zone";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { asNumbered, reviewLink } from "@/domain/rounds";
import type { ApproverRule, Viewer } from "@/domain/types";
import { newId } from "@/server/ids";
import { notMoved } from "../not-moved";
import type { PlatformService } from "../platform";
import { check, refuse } from "../refuse";
import type { Changed } from "../types";
import { applyFakeMembershipChange, fakeCommand } from "./access";
import { writeFakeAccessEffects } from "./access-effects";
import { writeFakeEffects } from "./effects";
import type { FakeDeps } from "./index";
import { businessZone, putSetting } from "./settings";
import type { FakeState } from "./state";
import type { FakeTx } from "./store";
import { templateById } from "./version-rows";

// Platform settings in memory: the twin of services/local/platform.ts, the same steps in the same order and the same
// domain rules (src/domain/platform-config), over the fake's arrays.

const actorOf = (viewer: Viewer) => ({ id: viewer.userId, name: viewer.name });

const unchanged: ActionResult<Changed> = { ok: true, changed: false };
const changed: ActionResult<Changed> = { ok: true, changed: true };

/** Platform Admin only. */
const manage = (viewer: Viewer) =>
  check(viewer, "platform.manage", { teamId: null });

function contentTypeRow(state: FakeState, id: string) {
  return (
    state.contentTypes.find((t) => t.id === id) ??
    refuse(REQUEST_REFUSALS.contentTypeGone)
  );
}

/** Everyone, with their platform role and whether they hold an active team role (the local `approverFacts`). */
function approverFacts(state: FakeState): ApproverFacts[] {
  const withRole = new Set(
    state.memberships
      .filter(
        (m) =>
          m.status === "active" &&
          state.membershipRoles.some((r) => r.membershipId === m.id),
      )
      .map((m) => m.userId),
  );
  return state.users.map((u) => ({
    id: u.id,
    name: u.name,
    platformRole: u.platformRole,
    activeTeamRole: withRole.has(u.id),
  }));
}

/** Each version's decisions (the local `loadDecisions`). */
function decisionsOf(state: FakeState, versionId: string): RecordedDecision[] {
  return state.approvals
    .filter((a) => a.versionId === versionId)
    .map(({ stageId, actorId, decision }) => ({ stageId, actorId, decision }));
}

const sameRule = (a: ApproverRule, b: ApproverRule) =>
  a.kind === "user"
    ? b.kind === "user" && a.userId === b.userId
    : b.kind === "team_role" && a.role === b.role;

export function fakePlatform(deps: FakeDeps): PlatformService {
  const accessEffects = (
    tx: FakeTx,
    effects: Parameters<typeof writeFakeAccessEffects>[1],
    now: Date,
    viewer: Viewer,
  ) => writeFakeAccessEffects(tx, effects, { now, actorId: viewer.userId });

  return {
    createTeam: (ctx, input) =>
      fakeCommand(
        deps,
        (tx, now): ActionResult<{ teamId: string; slug: string }> => {
          const { state } = tx;
          manage(ctx.viewer);
          const admin =
            state.users.find((u) => u.id === input.adminUserId) ??
            refuse(PLATFORM_REFUSALS.pickPerson);
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
            existing: state.teams.map((t) => ({ slug: t.slug, name: t.name })),
          });
          if (!outcome.ok) refuse(outcome);
          tx.insert("teams", {
            ...outcome.team,
            appName: null,
            smsSender: null,
          });
          applyFakeMembershipChange(tx, outcome.membership);
          accessEffects(tx, outcome.effects, now, ctx.viewer);
          return {
            ok: true,
            teamId: outcome.team.id,
            slug: outcome.team.slug,
          };
        },
      ),

    updateContentType: (ctx, input) =>
      fakeCommand(deps, (tx, now) => {
        manage(ctx.viewer);
        const type = contentTypeRow(tx.state, input.contentTypeId);
        const outcome = updateRequiredSections({
          contentType: type,
          next: input.requiredSections,
          actor: actorOf(ctx.viewer),
          now,
        });
        if (!outcome.ok) refuse(outcome);
        if (outcome.effects.length === 0) return unchanged;
        tx.update("contentTypes", type, {
          requiredSections: outcome.requiredSections,
        });
        accessEffects(tx, outcome.effects, now, ctx.viewer);
        return changed;
      }),

    setChannelRule: (ctx, input) =>
      fakeCommand(deps, (tx, now) => {
        const { state } = tx;
        manage(ctx.viewer);
        const type = contentTypeRow(state, input.contentTypeId);
        const outcome = setChannelRule({
          contentType: type,
          channel: input.channel,
          allowed: input.allowed,
          activeUsing: state.versions.filter(
            (v) =>
              v.state === "active" &&
              templateById(state, v.templateId)?.contentTypeId === type.id &&
              v.channels.includes(input.channel),
          ).length,
          contentTypes: state.contentTypes.map((t) => ({
            name: t.name,
            allowedChannels: t.allowedChannels,
          })),
          actor: actorOf(ctx.viewer),
          now,
        });
        if (!outcome.ok) refuse(outcome);
        if (outcome.effects.length === 0) return unchanged;
        tx.update("contentTypes", type, {
          allowedChannels: outcome.allowedChannels,
        });
        accessEffects(tx, outcome.effects, now, ctx.viewer);
        return changed;
      }),

    saveApprovalChain: (ctx, input) =>
      fakeCommand(deps, (tx, now) => {
        const { state } = tx;
        manage(ctx.viewer);
        const type = contentTypeRow(state, input.contentTypeId);
        const current = state.approvalStages
          .filter((s) => s.contentTypeId === type.id)
          .sort((a, b) => a.position - b.position)
          .map((s) => ({
            id: s.id,
            position: s.position,
            name: s.name,
            rule: s.approverRule,
          }));
        const inReview = state.versions.flatMap((v) => {
          const template = templateById(state, v.templateId);
          if (v.state !== "in_review" || template?.contentTypeId !== type.id)
            return [];
          return [
            {
              versionId: v.id,
              stages: v.stages,
              currentStage: v.currentStage,
              number: v.number,
              round: v.round,
              state: v.state,
              writers: v.writers,
              templateId: template.id,
              templateName: v.name,
              teamId: template.teamId,
            },
          ];
        });

        const outcome = saveApprovalChain({
          contentType: { id: type.id, name: type.name },
          current,
          next: input.stages,
          inReview: inReview.map(({ versionId, stages, currentStage }) => ({
            versionId,
            stages,
            currentStage,
          })),
          people: approverFacts(state),
          actor: actorOf(ctx.viewer),
          now,
        });
        if (!outcome.ok) refuse(outcome);
        if (outcome.effects.length === 0) return unchanged;

        const keep = new Set(
          outcome.stages.flatMap((s) => (s.id ? [s.id] : [])),
        );
        for (const row of state.approvalStages.filter(
          (s) => s.contentTypeId === type.id && !keep.has(s.id),
        ))
          tx.delete("approvalStages", row);
        for (const stage of outcome.stages) {
          const fields = {
            position: stage.position,
            name: stage.name,
            approverRule: stage.rule,
          };
          const row = stage.id
            ? state.approvalStages.find((s) => s.id === stage.id)
            : undefined;
          if (row) tx.update("approvalStages", row, fields);
          else
            tx.insert("approvalStages", {
              id: newId("stage"),
              contentTypeId: type.id,
              ...fields,
            });
        }
        // A waiting stage that now names someone else: they're told about the versions already waiting on it.
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
            approvedThisRound(decisionsOf(state, v.versionId)),
          );
          if (!asked) continue;
          const round = asNumbered(v);
          writeFakeEffects(
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
        accessEffects(tx, outcome.effects, now, ctx.viewer);
        return changed;
      }),

    setBusinessZone: (ctx, input) =>
      fakeCommand(deps, (tx, now) => {
        const { state } = tx;
        manage(ctx.viewer);
        const outcome = setBusinessZone({
          current: businessZone(state),
          next: input.zone,
          // Superseded versions whose sunset is set and hasn't passed (the local `countPendingSunsets`).
          pendingSunsets: state.versions
            .filter((v) => v.state === "superseded" && v.sunsetAt !== null)
            .filter((v) => !sunsetPassed(v, now)).length,
          actor: actorOf(ctx.viewer),
          now,
        });
        if (!outcome.ok) refuse(outcome);
        if (outcome.effects.length === 0) return unchanged;
        putSetting(tx, "business_zone", outcome.zone);
        accessEffects(tx, outcome.effects, now, ctx.viewer);
        return changed;
      }),

    teams: notMoved("platform.teams"),
    contentTypes: notMoved("platform.contentTypes"),
    channelRules: notMoved("platform.channelRules"),
    approvalChains: notMoved("platform.approvalChains"),
    businessZone: notMoved("platform.businessZone"),
  };
}
