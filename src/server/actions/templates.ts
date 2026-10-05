"use server";

import { RedirectType, redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { contentTypes, teams, templates, versions } from "@/server/db/schema/ucomp";
import { now } from "@/server/clock";
import { writeEffects } from "@/server/effects";
import { submitVersion } from "@/server/actions/review";
import { getViewer } from "@/server/viewer";
import { newId, newTemplateId } from "@/server/ids";
import { buildStarter, isStarterKey, type StarterKey } from "@/server/starters";
import { assertCan } from "@/domain/permissions";
import { conformToSections } from "@/domain/platform-config";
import { JUST_CREATED_COOKIE, JUST_CREATED_MAX_AGE } from "@/components/workspace/just-created";
import {
  DEFAULT_CHANNELS,
  createDraft,
  editActive,
  planDraftStart,
  type DraftFields,
  type StarterContent,
  type VersionSnapshot,
} from "@/domain/lifecycle";
import type { Channel, RequiredSection } from "@/domain/types";

// Template creation and editing. Every action checks permissions first, writes in one transaction,
// refreshes what it changed, and redirects last. Submitting moved to `actions/review.ts`
// (`submitDraft` here is its Phase 3 name).
//
// A "use server" file may export only async functions: the helpers below stay private.

// ── Shared helpers ────────────────────────────────────────────

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

  const starter = newTemplateStarter(buildStarter(starterKey, { scope: templateId, now: at }), contentType);
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

/**
 * A starter shaped to the content type as it is now (Platform settings): its required sections
 * (removed ones become ordinary headings, renamed ones take the new title, new ones are appended) and
 * only the channels the type allows. Existing templates are never reshaped.
 */
function newTemplateStarter(
  starter: StarterContent,
  type: { requiredSections: RequiredSection[]; allowedChannels: Channel[] },
): StarterContent {
  const wanted = starter.channels ?? DEFAULT_CHANNELS;
  const allowed = wanted.filter((c) => type.allowedChannels.includes(c));
  return {
    ...starter,
    body: conformToSections(starter.body, type.requiredSections, () => newId("b")),
    channels: allowed.length > 0 ? allowed : type.allowedChannels.slice(0, 1),
  };
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

/** What the Submit button needs: the new version's number, or the one-line reason it was refused. */
export type SubmitDraftResult = { ok: true; number: number } | { ok: false; reason: string };

/**
 * "Submit for review" from Phase 3. The submit now lives with the review actions (`submitVersion`,
 * which adds the note to reviewers and the notifications); this name stays for existing callers.
 */
export async function submitDraft(input: { templateId: string; note?: string | null }): Promise<SubmitDraftResult> {
  return submitVersion(input);
}
