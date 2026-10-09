"use server";

import { refresh, revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ApproverFacts } from "@/domain/access-types";
import { stageRecipients } from "@/domain/approval-chain";
import { PermissionError, assertCan } from "@/domain/permissions";
import {
  createTeam as createTeamRule,
  saveApprovalChain as saveApprovalChainRule,
  setChannelRule as setChannelRuleRule,
  updateRequiredSections,
} from "@/domain/platform-config";
import { CHANNELS, type ApproverRule, type Channel, type RequiredSection, type Viewer } from "@/domain/types";
import { applyMembershipChange, writeAccessEffects } from "@/server/access-effects";
import { now } from "@/server/clock";
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
import { inTransaction, writeEffects, type Tx } from "@/server/effects";
import { newId } from "@/server/ids";
import { getViewer } from "@/server/viewer";

// Platform settings (Platform Admin, `platform.manage`): teams, content types, channel rules and
// approval chains (contract: `PlatformActions` in domain/access-types.ts). Every action checks the
// permission first, reads the facts and writes the domain's answer (domain/platform-config.ts) in ONE
// transaction with its audit rows and notifications, then refreshes every page (the switcher, the
// sidebar and the settings modal all read this configuration).
//
// A "use server" file may export only async functions: the helpers below stay private.

const REASONS = {
  noContentType: "This content type no longer exists.",
  noPerson: "Pick a person.",
  invalid: "Check the form and try again.",
} as const;

/** A refusal raised inside a transaction: it rolls the transaction back and becomes the answer. */
class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "Refusal";
  }
}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

/** Platform Admin only (a cross-team permission: no team). */
function checkManage(viewer: Viewer): { ok: false; reason: string } | null {
  try {
    assertCan(viewer, "platform.manage", { teamId: null });
    return null;
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, reason: error.reason };
    throw error;
  }
}

async function transact<T extends object>(run: (tx: Tx) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await inTransaction(db, run);
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.reason };
    throw error;
  }
}

function refreshAll() {
  revalidatePath("/", "layout");
  refresh();
}

const actorOf = (viewer: Viewer) => ({ id: viewer.userId, name: viewer.name });

async function contentTypeRow(tx: Tx, id: string) {
  const row = await tx.query.contentTypes.findFirst({ where: eq(contentTypes.id, id) });
  if (!row) refuse(REASONS.noContentType);
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
  const viewer = await getViewer();
  const refused = checkManage(viewer);
  if (refused) return refused;
  const parsed = CreateTeamInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: REASONS.invalid };

  const at = await now();
  const result = await transact<{ slug: string }>(async (tx) => {
    const admin = await tx.query.users.findFirst({ where: eq(users.id, parsed.data.adminUserId) });
    if (!admin) refuse(REASONS.noPerson);
    // The Auditor is read-only everywhere: they can't be a team's first Team Admin.
    if (admin.platformRole === "auditor") refuse(`${admin.name} is an Auditor and can't be a Team Admin.`);
    const existing = await tx.select({ slug: teams.slug, name: teams.name }).from(teams);
    const outcome = createTeamRule({
      name: parsed.data.name,
      description: parsed.data.description,
      icon: parsed.data.icon,
      admin: { id: admin.id, name: admin.name },
      actor: actorOf(viewer),
      now: at,
      existing,
    });
    if (!outcome.ok) refuse(outcome.reason);

    await tx.insert(teams).values(outcome.team);
    await applyMembershipChange(tx, outcome.membership);
    await writeAccessEffects(tx, outcome.effects, { now: at, actorId: viewer.userId });
    return { ok: true, slug: outcome.team.slug };
  });

  if (result.ok) refreshAll();
  return result;
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
  const viewer = await getViewer();
  const refused = checkManage(viewer);
  if (refused) return refused;
  const parsed = SectionsInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: REASONS.invalid };

  const at = await now();
  let wrote = false;
  const result = await transact(async (tx) => {
    const type = await contentTypeRow(tx, parsed.data.contentTypeId);
    const outcome = updateRequiredSections({
      contentType: type,
      next: parsed.data.requiredSections,
      actor: actorOf(viewer),
      now: at,
    });
    if (!outcome.ok) refuse(outcome.reason);
    if (outcome.effects.length === 0) return { ok: true };

    await tx.update(contentTypes).set({ requiredSections: outcome.requiredSections }).where(eq(contentTypes.id, type.id));
    await writeAccessEffects(tx, outcome.effects, { now: at, actorId: viewer.userId });
    wrote = true;
    return { ok: true };
  });

  if (result.ok && wrote) refreshAll();
  return result;
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
  const viewer = await getViewer();
  const refused = checkManage(viewer);
  if (refused) return refused;
  const parsed = ChannelInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: REASONS.invalid };

  const at = await now();
  let wrote = false;
  const result = await transact(async (tx) => {
    const type = await contentTypeRow(tx, parsed.data.contentTypeId);
    const outcome = setChannelRuleRule({
      contentType: type,
      channel: parsed.data.channel,
      allowed: parsed.data.allowed,
      activeUsing: await activeUsing(tx, type.id, parsed.data.channel),
      actor: actorOf(viewer),
      now: at,
    });
    if (!outcome.ok) refuse(outcome.reason);
    if (outcome.effects.length === 0) return { ok: true };

    await tx.update(contentTypes).set({ allowedChannels: outcome.allowedChannels }).where(eq(contentTypes.id, type.id));
    await writeAccessEffects(tx, outcome.effects, { now: at, actorId: viewer.userId });
    wrote = true;
    return { ok: true };
  });

  if (result.ok && wrote) refreshAll();
  return result;
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
 * editor also runs as the admin edits: the Approver role or a person who can approve, never the admin
 * saving it, never one person on two stages. Every named person is checked, including people named
 * before who have since lost access. Existing stages keep their id; versions in review keep waiting on
 * the same stage wherever it moves (their currentStage is remapped, compare-and-set). Removing a stage
 * a version waits on is refused.
 */
export async function saveApprovalChain(input: {
  contentTypeId: string;
  stages: { id?: string; name: string; rule: ApproverRule }[];
}): Promise<ActionResult> {
  const viewer = await getViewer();
  const refused = checkManage(viewer);
  if (refused) return refused;
  const parsed = ChainInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: REASONS.invalid };

  const at = await now();
  let wrote = false;
  const result = await transact(async (tx) => {
    const type = await contentTypeRow(tx, parsed.data.contentTypeId);
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
        currentStage: versions.currentStage,
        number: versions.number,
        writers: versions.writers,
        templateId: templates.id,
        templateName: templates.name,
        teamId: templates.teamId,
      })
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .where(and(eq(templates.contentTypeId, type.id), eq(versions.state, "in_review")));
    const people = await approverFacts(tx);

    const outcome = saveApprovalChainRule({
      contentType: { id: type.id, name: type.name },
      current,
      next: parsed.data.stages,
      inReview: inReview.map(({ versionId, currentStage }) => ({ versionId, currentStage })),
      people,
      actor: actorOf(viewer),
      now: at,
    });
    if (!outcome.ok) refuse(outcome.reason);
    if (outcome.effects.length === 0) return { ok: true };

    const keep = new Set(outcome.stages.flatMap((s) => (s.id ? [s.id] : [])));
    const removed = current.filter((s) => !keep.has(s.id)).map((s) => s.id);
    if (removed.length) await tx.delete(approvalStages).where(inArray(approvalStages.id, removed));
    for (const stage of outcome.stages) {
      const row = { position: stage.position, name: stage.name, approverRule: stage.rule };
      if (stage.id) await tx.update(approvalStages).set(row).where(eq(approvalStages.id, stage.id));
      else await tx.insert(approvalStages).values({ id: newId("stage"), contentTypeId: type.id, ...row });
    }
    for (const move of outcome.moves) {
      const [moved] = await tx
        .update(versions)
        .set({ currentStage: move.to })
        .where(and(eq(versions.id, move.versionId), eq(versions.state, "in_review"), eq(versions.currentStage, move.from)))
        .returning({ id: versions.id });
      if (!moved) refuse("A version moved on while you were editing. Try again.");
    }
    // A stage that now names someone else (same stage, new rule): whoever it names now is told
    // about the versions already waiting on it, as if those had just arrived.
    for (const v of inReview) {
      const before = current[Math.min(Math.max(v.currentStage, 0), current.length - 1)];
      const after = before && outcome.stages.find((s) => s.id === before.id);
      if (!before || !after || sameRule(before.rule, after.rule) || v.number === null) continue;
      await writeEffects(
        tx,
        [
          {
            kind: "notification",
            notification: "review_requested",
            to: stageRecipients(after, v.writers),
            title: `${v.templateName} v${v.number} is waiting on ${after.name}.`,
            link: { to: "review", templateId: v.templateId, versionNumber: v.number },
          },
        ],
        { at, actorId: viewer.userId, teamId: v.teamId, templateId: v.templateId, versionId: v.versionId },
      );
    }
    await writeAccessEffects(tx, outcome.effects, { now: at, actorId: viewer.userId });
    wrote = true;
    return { ok: true };
  });

  if (result.ok && wrote) refreshAll();
  return result;
}
