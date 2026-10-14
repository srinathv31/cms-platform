"use server";

import { RedirectType, redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/domain/review-types";
import { services } from "@/server/services";
import { serverAction } from "./kit";

// Template editing, on the server action kit (kit.ts): the backend does the work (`templates.startDraft`), and the
// BFF refreshes what changed and redirects last. New template (`createTemplate`) is in `create-template.ts`, so
// the routes that only edit don't load the starters. Submitting is `submitVersion` in `actions/review.ts`.
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
 * otherwise a new draft copied from that latest version, and then redirects to the workspace. A refusal (a
 * newer version in review, a viewer who can't edit) is the answer instead, and nothing is written.
 */
export async function startDraft(input: {
  templateId: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: StartDraftInput,
    call: (ctx, { templateId }) =>
      services().templates.startDraft(ctx, { templateId }),
    after: ({ changed, teamSlug }, { input }) => {
      if (changed) refreshLists(input.templateId);
      // Usually called from the workspace itself: replace, so Back doesn't land on the same page twice.
      redirect(
        `/${teamSlug}/templates/${input.templateId}` as Route,
        RedirectType.replace,
      );
    },
  });
}
