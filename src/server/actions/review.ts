"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { OUTPUT_KEYS, type OutputKey } from "@/domain/review-outputs";
import type { ActionResult } from "@/domain/review-types";
import { services } from "@/server/services";
import type { Changed } from "@/server/services/types";
import { serverAction } from "./kit";

// The review lifecycle: submit, request changes, approve, sunset, and the two-person revoke. A version is
// named by its number and, to decide it, its round (domain/rounds.ts): approve and request changes act on
// exactly the round the approver was shown; sunset and revoke act on the number's head, its released row.
//
// Every action runs behind the service interfaces (`ReviewService` in src/server/services/review.ts, which says
// what each command promises and its refusals in order): it parses its input and calls `services().review`,
// which checks the permission, reads its own clock, asks the domain transition, writes with a compare-and-set
// and writes the effects, or refuses. On `ok` the pages that show the version refresh, so the page the person
// is on re-renders in place. A refusal is the service's `{ ok: false, code, reason }`, answered as it is: a
// double click or a slower colleague finds the version already moved on, and the second action is refused with
// the domain's sentence and writes nothing.
//
// A "use server" file may export only async functions: the helpers below stay private.

/** The pages a lifecycle change shows on: the Library rows, the template workspace, the review queue and screens. */
function refreshAfter() {
  revalidatePath("/[team]/library", "page");
  revalidatePath("/[team]/templates/[templateId]", "layout");
  revalidatePath("/[team]/review", "layout");
  refresh();
}

const TemplateRef = z.object({ templateId: z.string().min(1).max(32) });
const VersionRef = TemplateRef.extend({
  versionNumber: z.number().int().positive(),
});
/** A decision names the round it decides: the one on the approver's screen, never whichever is newest. */
const RoundRef = VersionRef.extend({ round: z.number().int().positive() });

// ── Submit for review ─────────────────────────────────────────

const SubmitInput = TemplateRef.extend({
  note: z.string().nullish(),
  rev: z.number().int().nonnegative(),
});

/**
 * "Submit v2" (or "Submit v1, round 2" after a send-back): the template's open draft becomes its next round, In
 * review, with the optional note to reviewers (`ReviewService.submit`). `rev` is the draft's rev from the submit
 * summary the author saw (`getSubmitSummary`): a draft that has changed since is refused (`summary_stale`), so
 * submit freezes only what the dialog showed.
 *
 * Stays on the page (the workspace re-renders in place). A refusal (an undefined chip, no email subject,
 * already in review, a stale summary) writes nothing and comes back as the sentence to show. The client
 * flushes the pending autosave first.
 */
export async function submitVersion(input: {
  templateId: string;
  note?: string | null;
  rev: number;
}): Promise<ActionResult<{ number: number; round: number }>> {
  return serverAction(input, {
    input: SubmitInput,
    call: (ctx, { templateId, note, rev }) =>
      services().review.submit(ctx, { templateId, note, rev }),
    after: refreshAfter,
  });
}

// ── Request changes ───────────────────────────────────────────

const RequestChangesInput = RoundRef.extend({ reason: z.string() });

/**
 * In review → Changes requested, with the reason, on the round the approver was shown (`round`): the decision,
 * the author's new draft and the reason as a thread about the whole version (`ReviewService.requestChanges`).
 */
export async function requestChanges(input: {
  templateId: string;
  versionNumber: number;
  round: number;
  reason: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: RequestChangesInput,
    call: (ctx, { templateId, versionNumber, round, reason }) =>
      services().review.requestChanges(ctx, {
        templateId,
        versionNumber,
        round,
        reason,
      }),
    after: refreshAfter,
  });
}

// ── Approve ───────────────────────────────────────────────────

const ApproveInput = RoundRef.extend({
  sunsetPrevious: z.string().nullish(),
  sampleSetsSeen: z.array(z.string().max(64)).max(50),
  /** The outputs the approver had rendered on screen in Preview: keys only (decision 0037). */
  outputsViewed: z.array(z.enum(OUTPUT_KEYS)).max(OUTPUT_KEYS.length * 2),
});

/**
 * Approves the stage the round on the approver's screen (`round`) waits on; at the last stage it goes live,
 * superseding the Active version with the sunset day picked for it (`sunsetPrevious`, YYYY-MM-DD), if any
 * (`ReviewService.approve`). The approver must have viewed every output of the round (`outputsViewed`, decision
 * 0037).
 */
export async function approveVersion(input: {
  templateId: string;
  versionNumber: number;
  round: number;
  sunsetPrevious?: string | null;
  sampleSetsSeen: string[];
  outputsViewed: readonly OutputKey[];
}): Promise<
  ActionResult<{ wentLive: boolean; number: number; round: number }>
> {
  return serverAction(input, {
    input: ApproveInput,
    call: (ctx, input) =>
      services().review.approve(ctx, {
        templateId: input.templateId,
        versionNumber: input.versionNumber,
        round: input.round,
        sunsetPrevious: input.sunsetPrevious,
        sampleSetsSeen: input.sampleSetsSeen,
        outputsViewed: input.outputsViewed,
      }),
    after: refreshAfter,
  });
}

// ── Sunset ────────────────────────────────────────────────────

const SunsetInput = VersionRef.extend({ sunsetAt: z.string() });

/**
 * "Set sunset" on the Versions tab: the day (YYYY-MM-DD, `sunsetAt`) a Superseded version stops rendering,
 * at 00:00 in the business time zone (decision 0017). The service decides and writes it
 * (`ReviewService.setSunset`, which lists its refusals); the pages refresh only when it wrote something, so a
 * double click with the same day changes nothing on screen either.
 */
export async function setSunset(input: {
  templateId: string;
  versionNumber: number;
  sunsetAt: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: SunsetInput,
    call: (ctx, { templateId, versionNumber, sunsetAt }) =>
      services().review.setSunset(ctx, {
        templateId,
        versionNumber,
        sunsetDay: sunsetAt,
      }),
    after: ({ changed }) => {
      if (changed) refreshAfter();
    },
  }).then(withoutChanged);
}

/** The action answers `{ ok: true }`: whether the service wrote is the kit's business (`after`), not the page's. */
function withoutChanged(result: ActionResult<Changed>): ActionResult {
  return result.ok ? { ok: true } : result;
}

// ── Revoke (two people) ───────────────────────────────────────

const StartRevokeInput = VersionRef.extend({ reason: z.string() });

/** One approver starts a revoke with a reason. Nothing stops rendering until another approver confirms. */
export async function startRevoke(input: {
  templateId: string;
  versionNumber: number;
  reason: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: StartRevokeInput,
    call: (ctx, { templateId, versionNumber, reason }) =>
      services().review.startRevoke(ctx, {
        templateId,
        versionNumber,
        reason,
      }),
    after: refreshAfter,
  });
}

/** A different approver confirms the revoke: the version is Revoked and its renders fail at once. */
export async function confirmRevoke(input: {
  templateId: string;
  versionNumber: number;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: VersionRef,
    call: (ctx, { templateId, versionNumber }) =>
      services().review.confirmRevoke(ctx, { templateId, versionNumber }),
    after: refreshAfter,
  });
}

/**
 * Withdraws a pending revoke: the starter (a mistake), or another approver declining to confirm. The version
 * keeps rendering.
 */
export async function cancelRevoke(input: {
  templateId: string;
  versionNumber: number;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: VersionRef,
    call: (ctx, { templateId, versionNumber }) =>
      services().review.cancelRevoke(ctx, { templateId, versionNumber }),
    after: refreshAfter,
  });
}
