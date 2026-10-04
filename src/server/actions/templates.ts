"use server";

import { RedirectType, redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { auditEvents, contentTypes, teams, templates, versions } from "@/server/db/schema/ucomp";
import { now } from "@/server/clock";
import { getViewer } from "@/server/viewer";
import { newId, newTemplateId } from "@/server/ids";
import { buildStarter, isStarterKey, type StarterKey } from "@/server/starters";
import { assertCan } from "@/domain/permissions";
import {
  createDraft,
  editActive,
  planDraftStart,
  type DraftFields,
  type LifecycleEffect,
  type VersionSnapshot,
} from "@/domain/lifecycle";

// Template creation and editing. Every action checks permissions first, writes in one transaction,
// refreshes what it changed, and redirects last.
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
 * Creates a template and its first draft from a starter, then opens it in the workspace with
 * `?created=1` (the header selects the name so the author can rename it at once).
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

  refreshLists();
  redirect(`/${team.slug}/templates/${templateId}?created=1`);
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
