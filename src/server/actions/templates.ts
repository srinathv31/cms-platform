"use server";

import { RedirectType, redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { teams, templates, versions } from "@/server/db/schema/ucomp";
import { writeEffects } from "@/server/effects";
import { submitVersion } from "@/server/actions/review";
import { newId } from "@/server/ids";
import { draftRow } from "@/server/templates/create";
import { editLatest, planDraftStart, type VersionSnapshot } from "@/domain/lifecycle";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { check, refuse, serverAction } from "./kit";

// Template editing, on the server action kit (kit.ts): the permission first, one transaction, a refresh
// of what changed, and the redirect last. New template (`createTemplate`) is in `create-template.ts`,
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
 * otherwise a new draft copied from that latest version (`planDraftStart`, `editLatest`), and then
 * redirects to the workspace. A refusal (a newer version in review, a viewer who can't edit) is the
 * answer instead, and nothing is written.
 */
export async function startDraft(input: { templateId: string }): Promise<ActionResult> {
  return serverAction(input, {
    input: StartDraftInput,
    // As in createTemplate (create-template.ts), the template is read only to learn its team for the
    // permission check.
    authorize: async ({ viewer, input }) => {
      const found = await db
        .select({ id: templates.id, teamId: templates.teamId, teamSlug: teams.slug })
        .from(templates)
        .innerJoin(teams, eq(teams.id, templates.teamId))
        .where(eq(templates.id, input.templateId))
        .limit(1)
        .then((rows) => rows[0]);
      check(viewer, "draft.edit", { teamId: found?.teamId ?? null });
      if (!found) refuse(REQUEST_REFUSALS.templateGone);
      return found;
    },
    // A write that meets another one takes its turn (src/lib/serialized-writes.ts), and `inTransaction`
    // retries a lock held by another process past the busy timeout. The retry re-reads, so it sees a
    // draft another press made meanwhile.
    transaction: async (tx, { viewer, found, now: at }) => {
      const list = await tx
        .select({ id: versions.id, state: versions.state, number: versions.number })
        .from(versions)
        .where(eq(versions.templateId, found.id));
      const plan = planDraftStart(list);
      if (plan.kind === "open") return { ok: true, opened: true };
      if (plan.kind === "blocked") refuse(plan);

      const latest = await tx.query.versions.findFirst({
        where: and(eq(versions.id, plan.from), inArray(versions.state, ["active", "revoked"])),
      });
      if (!latest) refuse(REQUEST_REFUSALS.latestChanged);

      const snapshot: VersionSnapshot = {
        id: latest.id,
        number: latest.number,
        state: latest.state,
        name: latest.name,
        body: latest.body,
        channelFields: latest.channelFields,
        channels: latest.channels,
        variables: latest.variables,
        sampleSets: latest.sampleSets,
      };
      const { changes, effects } = editLatest({ from: snapshot, createdBy: viewer.userId, now: at });
      const draftId = newId("v");

      // Two people pressing Edit at once: the partial unique index (one open draft per template) lets
      // one draft in. The other inserts nothing and simply opens it.
      const [inserted] = await tx
        .insert(versions)
        .values(draftRow(changes.draft, { id: draftId, templateId: found.id }))
        .onConflictDoNothing()
        .returning({ id: versions.id });
      if (!inserted) return { ok: true, opened: true };
      await writeEffects(tx, effects, {
        at,
        actorId: viewer.userId,
        teamId: found.teamId,
        templateId: found.id,
        versionId: draftId,
      });
      return { ok: true, opened: false };
    },
    after: ({ opened }, { found }) => {
      if (!opened) refreshLists(found.id);
      // Usually called from the workspace itself: replace, so Back doesn't land on the same page twice.
      redirect(`/${found.teamSlug}/templates/${found.id}` as Route, RedirectType.replace);
    },
  });
}

// ── Submit for review ─────────────────────────────────────────

/** What the Submit button needs: the new version's number, or the refusal (its code and one-line reason). */
export type SubmitDraftResult = ActionResult<{ number: number }>;

/**
 * "Submit for review" from Phase 3. The submit now lives with the review actions (`submitVersion`,
 * which adds the note to reviewers and the notifications); this name stays for existing callers.
 */
export async function submitDraft(input: { templateId: string; note?: string | null; rev: number }): Promise<SubmitDraftResult> {
  return submitVersion(input);
}
