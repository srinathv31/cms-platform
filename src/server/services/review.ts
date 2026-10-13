// The review lifecycle behind the seam: the transitions in src/domain/lifecycle, each run against the
// version's current state with a compare-and-set, its effects (audit rows, notifications, consumer notices)
// written with it or not at all. A version is named by its template and number, and a decision by its round
// as well: approve and request changes act on exactly the round the approver was shown; sunset and revoke on
// the number's head (its released row).
//
// Every command checks the permission first, and answers a version that doesn't exist exactly as one the
// viewer may not act on (`generic`), then `version_gone`. A refusal writes nothing.
//
// `setSunset` runs behind the seam (local and fake). The others are typed here and still run in
// src/server/actions/review.ts until they move.

import type { OutputKey } from "@/domain/review-outputs";
import type { SubmitSummary } from "@/domain/submit-types";
import type {
  ReviewQueue,
  ReviewScreenData,
} from "@/server/queries/review-models";
import type {
  ActionResult,
  Changed,
  ReadResult,
  RequestContext,
} from "./types";

/** A released version: the number's head. */
export interface VersionRef {
  templateId: string;
  versionNumber: number;
}

/** One round of a number, the one on the approver's screen. */
export interface RoundRef extends VersionRef {
  round: number;
}

export interface ReviewService {
  /**
   * Sets, or moves, the day a Superseded version stops rendering: 00:00 on `sunsetDay` (YYYY-MM-DD) in the
   * business time zone, which must come after today there (decision 0017). Consumers still rendering the
   * template get a `sunset_scheduled` notice; the version's submitter is notified unless they set it. The
   * day it already has answers `{ ok: true, changed: false }` and writes nothing (a double click). Once
   * the sunset has passed, any day is refused (`sunset_passed`, decision 0002).
   *
   * Refuses, in this order: `generic` (no `version.setSunset` on the template's team, or no such
   * version), `version_gone`, `invalid_date`, then the transition's `sunset_not_superseded`,
   * `sunset_passed`, `sunset_after_today`.
   */
  setSunset(
    ctx: RequestContext,
    input: VersionRef & { sunsetDay: string },
  ): Promise<ActionResult<Changed>>;

  /** Submit the open draft as the next round (`rev` from the submit summary the author saw). */
  submit(
    ctx: RequestContext,
    input: { templateId: string; note?: string | null; rev: number },
  ): Promise<ActionResult<{ number: number; round: number }>>;

  /** Send the round back with a reason; opens (or joins) the draft the next round is written in. */
  requestChanges(
    ctx: RequestContext,
    input: RoundRef & { reason: string },
  ): Promise<ActionResult>;

  /** Approve the round's current stage; at the last stage it goes live (`sunsetPrevious`: a YYYY-MM-DD day). */
  approve(
    ctx: RequestContext,
    input: RoundRef & {
      sunsetPrevious?: string | null;
      sampleSetsSeen: string[];
      outputsViewed: readonly OutputKey[];
    },
  ): Promise<
    ActionResult<{ wentLive: boolean; number: number; round: number }>
  >;

  /** One approver starts a revoke; nothing stops rendering until another confirms. */
  startRevoke(
    ctx: RequestContext,
    input: VersionRef & { reason: string },
  ): Promise<ActionResult>;

  /** A different approver confirms: the version is Revoked and its renders fail at once. */
  confirmRevoke(ctx: RequestContext, input: VersionRef): Promise<ActionResult>;

  /** Withdraw a pending revoke. */
  cancelRevoke(ctx: RequestContext, input: VersionRef): Promise<ActionResult>;

  /** The review queue of a space (`teamId` null: All teams). */
  queue(
    ctx: RequestContext,
    input: { teamId: string | null },
  ): Promise<ReadResult<{ queue: ReviewQueue }>>;

  /** How many rounds wait on the viewer in a space: the sidebar badge. */
  badgeCount(
    ctx: RequestContext,
    input: { teamId: string | null },
  ): Promise<ReadResult<{ count: number }>>;

  /** The review screen of one round (the number's head without `round`). */
  screen(
    ctx: RequestContext,
    input: {
      teamId: string | null;
      templateId: string;
      versionNumber: number;
      round: number | null;
    },
  ): Promise<ReadResult<{ screen: ReviewScreenData }>>;

  /** What submit would freeze, with the draft's `rev` (the submit dialog). */
  submitSummary(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<{ summary: SubmitSummary }>>;
}
