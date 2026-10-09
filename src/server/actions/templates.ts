"use server";

import { RedirectType, redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { teams, templates, versions } from "@/server/db/schema/ucomp";
import { now } from "@/server/clock";
import { inTransaction, writeEffects } from "@/server/effects";
import { submitVersion } from "@/server/actions/review";
import { getViewer } from "@/server/viewer";
import { newId } from "@/server/ids";
import { draftRow } from "@/server/templates/create";
import { assertCan } from "@/domain/permissions";
import { editLatest, planDraftStart, type VersionSnapshot } from "@/domain/lifecycle";

// Template editing. Every action checks permissions first, writes in one transaction, refreshes
// what it changed, and redirects last. New template (`createTemplate`) is in `create-template.ts`,
// so the routes that only edit don't load the starters. Submitting moved to `actions/review.ts`
// (`submitDraft` here is its Phase 3 name).
//
// A "use server" file may export only async functions: the helpers below stay private.

// ── Shared helpers ────────────────────────────────────────────

/** The library lists, and the workspace of one template, may now read differently. */
function refreshLists(templateId?: string) {
  revalidatePath("/[team]/library", "page");
  if (templateId) revalidatePath("/[team]/templates/[templateId]", "layout");
}

// ── Edit a template ───────────────────────────────────────────

const StartDraftInput = z.object({ templateId: z.string().min(1).max(32) });

/**
 * "Edit" on a template whose latest version is Active, or Revoked (the corrected draft after a revoke).
 * Opens the template's draft: the one already open if there is one (a template has at most one),
 * otherwise a new draft copied from that latest version (`planDraftStart`, `editLatest`).
 */
export async function startDraft(input: { templateId: string }): Promise<void> {
  const viewer = await getViewer();

  // As in createTemplate (create-template.ts), the template is read only to learn its team for the
  // permission check.
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

  // A write that met another one used to fail with SQLITE_BUSY (and poison its connection), so the
  // action answered 500 and Edit seemed to do nothing. Writes now take turns (src/lib/serialized-writes.ts);
  // `inTransaction` still retries a lock held by another process past the busy timeout. The retry
  // re-reads, so it sees a draft another press made meanwhile.
  const outcome = await inTransaction(db, async (tx) => {
    const list = await tx
      .select({ id: versions.id, state: versions.state, number: versions.number })
      .from(versions)
      .where(eq(versions.templateId, found.id));
    const plan = planDraftStart(list);
    if (plan.kind === "open") return { opened: true as const };
    if (plan.kind === "blocked") throw new Error(plan.reason);

    const latest = await tx.query.versions.findFirst({
      where: and(eq(versions.id, plan.from), inArray(versions.state, ["active", "revoked"])),
    });
    if (!latest) throw new Error("The latest version changed. Try again.");

    const snapshot: VersionSnapshot = {
      id: latest.id,
      number: latest.number,
      state: latest.state,
      body: latest.body,
      emailSubject: latest.emailSubject,
      emailPreheader: latest.emailPreheader,
      channels: latest.channels,
      variables: latest.variables,
      sampleSets: latest.sampleSets,
    };
    const { changes, effects } = editLatest({ from: snapshot, createdBy: viewer.userId, now: at });
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
  }).catch(async (error: unknown) => {
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
export async function submitDraft(input: { templateId: string; note?: string | null; rev: number }): Promise<SubmitDraftResult> {
  return submitVersion(input);
}
