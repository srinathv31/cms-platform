"use server";

import { RedirectType, redirect } from "next/navigation";
import type { Route } from "next";
import { refresh, revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { auditEvents, contentTypes, teams, templates, versions } from "@/server/db/schema/ucomp";
import { now } from "@/server/clock";
import { getViewer } from "@/server/viewer";
import { newId, newTemplateId } from "@/server/ids";
import { buildStarter, isStarterKey, type StarterKey } from "@/server/starters";
import { assertCan } from "@/domain/permissions";
import { JUST_CREATED_COOKIE, JUST_CREATED_MAX_AGE } from "@/components/workspace/just-created";
import {
  createDraft,
  editActive,
  planDraftStart,
  submit,
  type DraftFields,
  type LifecycleEffect,
  type VersionSnapshot,
} from "@/domain/lifecycle";

// Template creation, editing and submitting. Every action checks permissions first, writes in one
// transaction, refreshes what it changed, and redirects last (submitDraft stays on the page).
//
// A "use server" file may export only async functions: the helpers below stay private.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Shared helpers ────────────────────────────────────────────

/** Writes the audit events a lifecycle transition asked for, inside the caller's transaction. */
async function writeEffects(
  tx: Tx,
  effects: readonly LifecycleEffect[],
  ctx: { at: Date; actorId: string; teamId: string; templateId: string; versionId: string },
) {
  for (const effect of effects) {
    await tx.insert(auditEvents).values({
      id: newId("ae"),
      at: ctx.at,
      actorId: ctx.actorId,
      teamId: ctx.teamId,
      templateId: ctx.templateId,
      // The creation event is about the template; the rest belong to the version.
      versionId: effect.action === "template.created" ? null : ctx.versionId,
      action: effect.action,
      details: effect.details,
      sessionKey: null,
    });
  }
}

function draftRow(draft: DraftFields, ids: { id: string; templateId: string }) {
  return {
    id: ids.id,
    templateId: ids.templateId,
    number: draft.number,
    state: draft.state,
    basedOnVersionId: draft.basedOnVersionId,
    body: draft.body,
    emailSubject: draft.emailSubject,
    emailPreheader: draft.emailPreheader,
    channels: draft.channels,
    variables: draft.variables,
    sampleSets: draft.sampleSets,
    contractChanges: draft.contractChanges,
    currentStage: draft.currentStage,
    rev: draft.rev,
    createdBy: draft.createdBy,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

/** The library lists, and the workspace of one template, may now read differently. */
function refreshLists(templateId?: string) {
  revalidatePath("/[team]/library", "page");
  if (templateId) revalidatePath("/[team]/templates/[templateId]", "layout");
}

// ── New template ──────────────────────────────────────────────

const CreateTemplateInput = z.object({
  teamSlug: z.string().min(1).max(64),
  starterKey: z.string(),
});

/**
 * Creates a template and its first draft from a starter, then opens it in the workspace. The name
 * field selects the name on arrival so the author can rename it at once: it learns the template is
 * new from a one-shot cookie (`just-created.ts`), so the redirect goes to the template's own address
 * and the address bar never needs tidying (one history entry; Back returns to the Library).
 * Blank starts as "Untitled template"; an example keeps its own name.
 */
export async function createTemplate(input: { teamSlug: string; starterKey: StarterKey }): Promise<void> {
  const viewer = await getViewer();

  // The team is looked up only to know which team the permission is checked on. An unknown team
  // has no id, so the check fails the same way as a team the viewer can't write to.
  const parsed = CreateTemplateInput.safeParse(input);
  const team = parsed.success
    ? await db.query.teams.findFirst({ where: eq(teams.slug, parsed.data.teamSlug) })
    : undefined;
  assertCan(viewer, "template.create", { teamId: team?.id ?? null });

  if (!parsed.success || !team) throw new Error("Unknown team");
  if (!isStarterKey(parsed.data.starterKey)) throw new Error("Unknown starter");
  const starterKey = parsed.data.starterKey;

  const at = await now();
  const contentType = await db.query.contentTypes.findFirst({ where: eq(contentTypes.key, "disclosure") });
  if (!contentType) throw new Error("The Disclosure content type is missing");

  // A collision on 6 Crockford characters is one in a billion; check anyway rather than fail the author.
  let templateId = newTemplateId();
  for (let i = 0; i < 4 && (await db.query.templates.findFirst({ where: eq(templates.id, templateId) })); i++) {
    templateId = newTemplateId();
  }

  const starter = buildStarter(starterKey, { scope: templateId, now: at });
  const { changes, effects } = createDraft({ starter, createdBy: viewer.userId, now: at });
  const versionId = newId("v");

  await db.transaction(async (tx) => {
    await tx.insert(templates).values({
      id: templateId,
      teamId: team.id,
      contentTypeId: contentType.id,
      name: changes.template.name,
      createdBy: changes.template.createdBy,
      createdAt: changes.template.createdAt,
      starterKey: changes.template.starterKey,
    });
    await tx.insert(versions).values(draftRow(changes.draft, { id: versionId, templateId }));
    await writeEffects(tx, effects, {
      at,
      actorId: viewer.userId,
      teamId: team.id,
      templateId,
      versionId,
    });
  });

  (await cookies()).set(JUST_CREATED_COOKIE, templateId, {
    path: "/",
    sameSite: "lax",
    maxAge: JUST_CREATED_MAX_AGE,
  });
  refreshLists();
  redirect(`/${team.slug}/templates/${templateId}`);
}

// ── Edit an Active template ───────────────────────────────────

const StartDraftInput = z.object({ templateId: z.string().min(1).max(32) });

/**
 * "Edit" on an Active template. Opens the template's draft: the one already open if there is
 * one (a template has at most one), otherwise a new draft copied from the Active version.
 */
export async function startDraft(input: { templateId: string }): Promise<void> {
  const viewer = await getViewer();

  // As in createTemplate, the template is read only to learn its team for the permission check.
  const parsed = StartDraftInput.safeParse(input);
  const found = parsed.success
    ? await db
        .select({ id: templates.id, teamId: templates.teamId, teamSlug: teams.slug })
        .from(templates)
        .innerJoin(teams, eq(teams.id, templates.teamId))
        .where(eq(templates.id, parsed.data.templateId))
        .limit(1)
        .then((rows) => rows[0])
    : undefined;
  assertCan(viewer, "draft.edit", { teamId: found?.teamId ?? null });
  if (!found) throw new Error("Template not found");

  const workspace = `/${found.teamSlug}/templates/${found.id}` as Route;
  const at = await now();

  const outcome = await db
    .transaction(async (tx) => {
      const list = await tx
        .select({ id: versions.id, state: versions.state, number: versions.number })
        .from(versions)
        .where(eq(versions.templateId, found.id));
      const plan = planDraftStart(list);
      if (plan.kind === "open") return { opened: true as const };
      if (plan.kind === "blocked") throw new Error(plan.reason);

      const active = await tx.query.versions.findFirst({
        where: and(eq(versions.id, plan.from), eq(versions.state, "active")),
      });
      if (!active) throw new Error("The Active version changed. Try again.");

      const snapshot: VersionSnapshot = {
        id: active.id,
        number: active.number,
        state: active.state,
        body: active.body,
        emailSubject: active.emailSubject,
        emailPreheader: active.emailPreheader,
        channels: active.channels,
        variables: active.variables,
        sampleSets: active.sampleSets,
      };
      const { changes, effects } = editActive({ active: snapshot, createdBy: viewer.userId, now: at });
      const draftId = newId("v");

      await tx.insert(versions).values(draftRow(changes.draft, { id: draftId, templateId: found.id }));
      await writeEffects(tx, effects, {
        at,
        actorId: viewer.userId,
        teamId: found.teamId,
        templateId: found.id,
        versionId: draftId,
      });
      return { opened: false as const };
    })
    .catch(async (error: unknown) => {
      // Two people pressing Edit at once: the partial unique index lets one draft in. The other
      // simply opens it.
      const open = await db.query.versions.findFirst({
        where: and(eq(versions.templateId, found.id), eq(versions.state, "draft")),
      });
      if (open) return { opened: true as const };
      throw error;
    });

  if (!outcome.opened) refreshLists(found.id);
  // Usually called from the workspace itself: replace, so Back doesn't land on the same page twice.
  redirect(workspace, RedirectType.replace);
}

// ── Submit for review ─────────────────────────────────────────

const SubmitDraftInput = z.object({ templateId: z.string().min(1).max(32) });

/** What the Submit button needs: the new version's number, or the one-line reason it was refused. */
export type SubmitDraftResult = { ok: true; number: number } | { ok: false; reason: string };

/**
 * "Submit for review": the template's open draft becomes its next version, In review (the minimal
 * Submit of Phase 3; the dialog with the contract diff comes with the review phase). The draft, the
 * highest version number and the Active version's variables are read inside the transaction that
 * writes the result, so the number and the contract changes can't go stale.
 *
 * Stays on the page: the workspace re-renders in place (header, document, buttons). A refusal
 * (an undefined chip, no email subject, already in review) writes nothing and comes back as a reason.
 * The client flushes the pending autosave first (`session.flush()`).
 */
export async function submitDraft(input: { templateId: string }): Promise<SubmitDraftResult> {
  const viewer = await getViewer();

  // As in startDraft, the template is read only to learn its team for the permission check.
  const parsed = SubmitDraftInput.safeParse(input);
  const found = parsed.success
    ? await db
        .select({ id: templates.id, teamId: templates.teamId })
        .from(templates)
        .where(eq(templates.id, parsed.data.templateId))
        .limit(1)
        .then((rows) => rows[0])
    : undefined;
  assertCan(viewer, "version.submit", { teamId: found?.teamId ?? null });
  if (!found) throw new Error("Template not found");

  const at = await now();

  const result = await db.transaction(async (tx): Promise<SubmitDraftResult> => {
    const list = await tx
      .select({ id: versions.id, number: versions.number, state: versions.state })
      .from(versions)
      .where(eq(versions.templateId, found.id));

    const open = list.find((v) => v.state === "draft");
    if (!open) {
      return {
        ok: false,
        reason: list.some((v) => v.state === "in_review")
          ? "This version is already in review."
          : "There is no draft to submit.",
      };
    }
    const draft = await tx.query.versions.findFirst({ where: eq(versions.id, open.id) });
    if (!draft) return { ok: false, reason: "There is no draft to submit." };

    const activeId = list.find((v) => v.state === "active")?.id;
    const baseline = activeId
      ? await tx
          .select({ variables: versions.variables })
          .from(versions)
          .where(eq(versions.id, activeId))
          .then((rows) => rows[0]?.variables ?? null)
      : null;

    const outcome = submit({
      draft: {
        state: draft.state,
        variables: draft.variables,
        body: draft.body,
        emailSubject: draft.emailSubject,
        emailPreheader: draft.emailPreheader,
        channels: draft.channels,
      },
      highestNumber: list.reduce((max, v) => Math.max(max, v.number ?? 0), 0),
      baseline,
      now: at,
      submittedBy: viewer.userId,
    });
    if (!outcome.ok) return { ok: false, reason: outcome.reason };
    const { changes, effects } = outcome;

    // The rev and state in the WHERE make this a compare-and-set; the rev bump makes a save that was
    // still in flight (its `rev` is now behind) fail rather than land on a frozen version.
    const [saved] = await tx
      .update(versions)
      .set({
        state: changes.state,
        number: changes.number,
        submittedBy: changes.submittedBy,
        submittedAt: changes.submittedAt,
        currentStage: changes.currentStage,
        contractChanges: changes.contractChanges,
        rev: sql`${versions.rev} + 1`,
        updatedAt: at,
      })
      .where(and(eq(versions.id, draft.id), eq(versions.rev, draft.rev), eq(versions.state, "draft")))
      .returning({ id: versions.id });
    if (!saved) return { ok: false, reason: "This draft changed. Try again." };

    await writeEffects(tx, effects, {
      at,
      actorId: viewer.userId,
      teamId: found.teamId,
      templateId: found.id,
      versionId: draft.id,
    });
    return { ok: true, number: changes.number };
  });

  if (result.ok) {
    refreshLists(found.id);
    refresh();
  }
  return result;
}
