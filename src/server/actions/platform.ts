"use server";

import { refresh, revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ApproverFacts } from "@/domain/access-types";
import { approvedThisRound, currentStageOf, stageRecipients } from "@/domain/approval-chain";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import {
  PLATFORM_REFUSALS,
  createTeam as createTeamRule,
  saveApprovalChain as saveApprovalChainRule,
  setBusinessZone as setBusinessZoneRule,
  setChannelRule as setChannelRuleRule,
  updateRequiredSections,
} from "@/domain/platform-config";
import { CHANNELS, type ApproverRule, type Channel, type RequiredSection, type Viewer } from "@/domain/types";
import { applyMembershipChange, writeAccessEffects } from "@/server/access-effects";
import { BUSINESS_ZONE_KEY, countPendingSunsets, readBusinessZone } from "@/server/business-zone";
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
import { writeEffects, type Tx } from "@/server/effects";
import { newId } from "@/server/ids";
import { loadDecisions } from "@/server/queries/review-shared";
import { check, refuse, serverAction, type ActionContext } from "./kit";

// Platform settings (Platform Admin, `platform.manage`): teams, content types, channel rules, approval
// chains and the business time zone (contract: `PlatformActions` in domain/access-types.ts). Every action
// runs the server action kit (kit.ts): it checks the permission (`manage`), reads the facts and writes
// the domain's answer (domain/platform-config.ts) in ONE transaction with its audit rows and
// notifications, then refreshes every page (the switcher, the sidebar and the settings modal all read
// this configuration).
//
// A "use server" file may export only async functions: the helpers below stay private.

/** Platform Admin only (a cross-team permission: no team). */
function manage({ viewer }: ActionContext<unknown>) {
  check(viewer, "platform.manage", { teamId: null });
}

function refreshAll() {
  revalidatePath("/", "layout");
  refresh();
}

const actorOf = (viewer: Viewer) => ({ id: viewer.userId, name: viewer.name });

async function contentTypeRow(tx: Tx, id: string) {
  const row = await tx.query.contentTypes.findFirst({ where: eq(contentTypes.id, id) });
  if (!row) refuse(REQUEST_REFUSALS.contentTypeGone);
  return row;
}

// ── Teams ─────────────────────────────────────────────────────

const CreateTeamInput = z.object({
  name: z.string().max(500),
  description: z.string().max(2000),
  icon: z.string().max(64),
  adminUserId: z.string().min(1).max(64),
});

/** Creates a team (its slug from the name) with its first Team Admin, who is told. */
export async function createTeam(input: {
  name: string;
  description: string;
  icon: string;
  adminUserId: string;
}): Promise<ActionResult<{ slug: string }>> {
  return serverAction(input, {
    input: CreateTeamInput,
    authorize: manage,
    transaction: async (tx, { viewer, input, now: at }) => {
      const admin = await tx.query.users.findFirst({ where: eq(users.id, input.adminUserId) });
      if (!admin) refuse(PLATFORM_REFUSALS.pickPerson);
      // The Auditor is read-only everywhere: they can't be a team's first Team Admin.
      if (admin.platformRole === "auditor") refuse(PLATFORM_REFUSALS.auditorCantBeAdmin(admin.name));
      const existing = await tx.select({ slug: teams.slug, name: teams.name }).from(teams);
      const outcome = createTeamRule({
        name: input.name,
        description: input.description,
        icon: input.icon,
        admin: { id: admin.id, name: admin.name },
        actor: actorOf(viewer),
        now: at,
        existing,
      });
      if (!outcome.ok) refuse(outcome);

      await tx.insert(teams).values(outcome.team);
      await applyMembershipChange(tx, outcome.membership);
      await writeAccessEffects(tx, outcome.effects, { now: at, actorId: viewer.userId });
      return { ok: true, slug: outcome.team.slug };
    },
    after: refreshAll,
  });
}

// ── Content types ─────────────────────────────────────────────

const SectionsInput = z.object({
  contentTypeId: z.string().min(1).max(64),
  requiredSections: z.array(z.object({ key: z.string().max(64), title: z.string().max(500) })).max(30),
});

/**
 * Replaces a content type's required sections (in order; existing ones by key). Only templates
 * created afterwards take the new sections: existing documents keep the headings they carry.
 */
export async function updateContentType(input: {
  contentTypeId: string;
  requiredSections: RequiredSection[];
}): Promise<ActionResult> {
  let wrote = false;
  return serverAction(input, {
    input: SectionsInput,
    authorize: manage,
    transaction: async (tx, { viewer, input, now: at }) => {
      const type = await contentTypeRow(tx, input.contentTypeId);
      const outcome = updateRequiredSections({
        contentType: type,
        next: input.requiredSections,
        actor: actorOf(viewer),
        now: at,
      });
      if (!outcome.ok) refuse(outcome);
      if (outcome.effects.length === 0) return { ok: true };

      await tx.update(contentTypes).set({ requiredSections: outcome.requiredSections }).where(eq(contentTypes.id, type.id));
      await writeAccessEffects(tx, outcome.effects, { now: at, actorId: viewer.userId });
      wrote = true;
      return { ok: true };
    },
    after: () => {
      if (wrote) refreshAll();
    },
  });
}

// ── Channel rules ─────────────────────────────────────────────

const ChannelInput = z.object({
  contentTypeId: z.string().min(1).max(64),
  channel: z.enum(CHANNELS),
  allowed: z.boolean(),
});

/** Active versions of the content type's templates that render to the channel. */
async function activeUsing(tx: Tx, contentTypeId: string, channel: Channel): Promise<number> {
  const rows = await tx
    .select({ channels: versions.channels })
    .from(versions)
    .innerJoin(templates, eq(templates.id, versions.templateId))
    .where(and(eq(templates.contentTypeId, contentTypeId), eq(versions.state, "active")));
  return rows.filter((r) => r.channels.includes(channel)).length;
}

/**
 * Turns a channel on or off for a content type. Off takes effect at once: the render API refuses the
 * channel for the type's templates, Active versions included (the confirm named how many).
 */
export async function setChannelRule(input: {
  contentTypeId: string;
  channel: Channel;
  allowed: boolean;
}): Promise<ActionResult> {
  let wrote = false;
  return serverAction(input, {
    input: ChannelInput,
    authorize: manage,
    transaction: async (tx, { viewer, input, now: at }) => {
      const type = await contentTypeRow(tx, input.contentTypeId);
      const outcome = setChannelRuleRule({
        contentType: type,
        channel: input.channel,
        allowed: input.allowed,
        activeUsing: await activeUsing(tx, type.id, input.channel),
        actor: actorOf(viewer),
        now: at,
      });
      if (!outcome.ok) refuse(outcome);
      if (outcome.effects.length === 0) return { ok: true };

      await tx.update(contentTypes).set({ allowedChannels: outcome.allowedChannels }).where(eq(contentTypes.id, type.id));
      await writeAccessEffects(tx, outcome.effects, { now: at, actorId: viewer.userId });
      wrote = true;
      return { ok: true };
    },
    after: () => {
      if (wrote) refreshAll();
    },
  });
}

// ── Approval chains ───────────────────────────────────────────

// Only the Approver role decides, so it is the only role a stage may name (domain validateChain).
const RuleInput: z.ZodType<ApproverRule> = z.union([
  z.object({ kind: z.literal("team_role"), role: z.literal("approver") }),
  z.object({ kind: z.literal("user"), userId: z.string().min(1).max(64) }),
]);

const ChainInput = z.object({
  contentTypeId: z.string().min(1).max(64),
  stages: z
    .array(z.object({ id: z.string().min(1).max(64).optional(), name: z.string().max(500), rule: RuleInput }))
    .max(20),
});

const sameRule = (a: ApproverRule, b: ApproverRule) =>
  a.kind === "user" ? b.kind === "user" && a.userId === b.userId : b.kind === "team_role" && a.role === b.role;

/** Everyone, with what the domain's validateChain checks: their platform role and whether they hold an active team role. */
async function approverFacts(tx: Tx): Promise<ApproverFacts[]> {
  const people = await tx.select({ id: users.id, name: users.name, platformRole: users.platformRole }).from(users);
  const active = await tx
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .where(eq(memberships.status, "active"));
  const withRole = new Set(active.map((a) => a.userId));
  return people.map((p) => ({ ...p, activeTeamRole: withRole.has(p.id) }));
}

/**
 * Saves the whole chain, in order. Every stage must pass the domain's `validateChain`, which the chain
 * editor also runs as the admin edits: the Approver role or a person who can approve, never one person
 * on two stages, and never the admin naming themselves (a stage another admin named them on stays
 * theirs). Every named person is checked, including people named before who have since lost access.
 * Existing stages keep their id. Versions in review go through the stages they recorded at submit, so
 * nothing about them is rewritten; a new rule on a stage reaches them because each stage's rule is read
 * by id when a version reaches it. Removing a stage an in-review version still needs is refused.
 */
export async function saveApprovalChain(input: {
  contentTypeId: string;
  stages: { id?: string; name: string; rule: ApproverRule }[];
}): Promise<ActionResult> {
  let wrote = false;
  return serverAction(input, {
    input: ChainInput,
    authorize: manage,
    transaction: async (tx, { viewer, input, now: at }) => {
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
          writers: versions.writers,
          templateId: templates.id,
          templateName: versions.name,
          teamId: templates.teamId,
        })
        .from(versions)
        .innerJoin(templates, eq(templates.id, versions.templateId))
        .where(and(eq(templates.contentTypeId, type.id), eq(versions.state, "in_review")));
      const people = await approverFacts(tx);

      const outcome = saveApprovalChainRule({
        contentType: { id: type.id, name: type.name },
        current,
        next: input.stages,
        inReview: inReview.map(({ versionId, stages, currentStage }) => ({ versionId, stages, currentStage })),
        people,
        actor: actorOf(viewer),
        now: at,
      });
      if (!outcome.ok) refuse(outcome);
      if (outcome.effects.length === 0) return { ok: true };

      const keep = new Set(outcome.stages.flatMap((s) => (s.id ? [s.id] : [])));
      const removed = current.filter((s) => !keep.has(s.id)).map((s) => s.id);
      if (removed.length) await tx.delete(approvalStages).where(inArray(approvalStages.id, removed));
      for (const stage of outcome.stages) {
        const row = { position: stage.position, name: stage.name, approverRule: stage.rule };
        if (stage.id) await tx.update(approvalStages).set(row).where(eq(approvalStages.id, stage.id));
        else await tx.insert(approvalStages).values({ id: newId("stage"), contentTypeId: type.id, ...row });
      }
      // A stage that now names someone else (same stage, new rule): whoever it names now is told
      // about the versions already waiting on it, as if those had just arrived, unless they approved a
      // stage of that version already and so can't take this one. The version's own name for the
      // stage, as its stepper shows it.
      const decisions = await loadDecisions(tx, inReview.map((v) => v.versionId));
      for (const v of inReview) {
        const before = currentStageOf(v, current);
        const after = before && outcome.stages.find((s) => s.id === before.id);
        if (!before || !after || sameRule(before.rule, after.rule) || v.number === null) continue;
        const asked = stageRecipients({ ...before, rule: after.rule }, v.writers, approvedThisRound(decisions.get(v.versionId) ?? []));
        if (!asked) continue;
        await writeEffects(
          tx,
          [
            {
              kind: "notification",
              notification: "review_requested",
              to: asked,
              title: `${v.templateName} v${v.number} is waiting on ${before.name}.`,
              link: { to: "review", templateId: v.templateId, versionNumber: v.number },
            },
          ],
          { at, actorId: viewer.userId, teamId: v.teamId, templateId: v.templateId, versionId: v.versionId },
        );
      }
      await writeAccessEffects(tx, outcome.effects, { now: at, actorId: viewer.userId });
      wrote = true;
      return { ok: true };
    },
    after: () => {
      if (wrote) refreshAll();
    },
  });
}

// ── Business time zone ────────────────────────────────────────

const ZoneInput = z.object({ zone: z.string().min(1).max(64) });

/**
 * Sets the business time zone sunset dates are read in (decision 0017): one of `BUSINESS_ZONES`. Only
 * dates picked afterwards follow it; every sunset already set keeps its instant, since its consumers
 * have been told when it ends. The same zone again writes nothing.
 */
export async function setBusinessZone(input: { zone: string }): Promise<ActionResult> {
  let wrote = false;
  return serverAction(input, {
    input: ZoneInput,
    authorize: manage,
    transaction: async (tx, { viewer, input, now: at }) => {
      const outcome = setBusinessZoneRule({
        current: await readBusinessZone(tx),
        next: input.zone,
        pendingSunsets: await countPendingSunsets(tx, at),
        actor: actorOf(viewer),
        now: at,
      });
      if (!outcome.ok) refuse(outcome);
      if (outcome.effects.length === 0) return { ok: true };

      await tx
        .insert(settings)
        .values({ key: BUSINESS_ZONE_KEY, value: outcome.zone })
        .onConflictDoUpdate({ target: settings.key, set: { value: outcome.zone } });
      await writeAccessEffects(tx, outcome.effects, { now: at, actorId: viewer.userId });
      wrote = true;
      return { ok: true };
    },
    after: () => {
      if (wrote) refreshAll();
    },
  });
}
