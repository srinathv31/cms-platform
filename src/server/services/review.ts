// The review lifecycle behind the seam: the transitions in src/domain/lifecycle, each run against the
// version's current state with a compare-and-set, its effects (audit rows, notifications, consumer notices)
// written with it or not at all, all dated by the backend's clock. A version is named by its template and
// number, and a decision by its round as well: approve and request changes act on exactly the round the
// approver was shown; sunset and revoke on the number's head (its released row).
//
// Every command checks the permission first, and answers a version that doesn't exist exactly as one the
// viewer may not act on (`generic`), then `version_gone`. Someone else changing the version between the
// command's read and its write is `version_changed`. A refusal writes nothing.
//
// The commands and `submitSummary` run behind the seam (local and fake). The queue, its badge and the review
// screen are typed here and still run in src/server/queries/review.ts until they move.

import type { OutputKey } from "@/domain/review-outputs";
import type { SubmitFacts } from "@/domain/submit-types";
import type {
  ActionResult,
  Changed,
  ReadResult,
  RequestContext,
  Unsettled,
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
   * day it already has answers `{ ok: true, changed: false }` and writes nothing (a double click,
   * `sunsetUnchanged`). Once the sunset has passed, any day is refused (`sunset_passed`, decision 0002).
   *
   * Refuses, in this order: `generic` (no `version.setSunset` on the template's team, or no such
   * version), `version_gone`, `invalid_date`, then the transition's `sunset_not_superseded`,
   * `sunset_passed`, `sunset_not_after_today`, and `version_changed` when the write loses its compare-and-set.
   */
  setSunset(
    ctx: RequestContext,
    input: VersionRef & { sunsetDay: string },
  ): Promise<ActionResult<Changed>>;

  /**
   * Submits the template's open draft as its next round, In review (`nextRound`: round 1 of the next number
   * after a release, or the next round of the number sent back), with the note to reviewers (trimmed; none when
   * blank). It freezes what the draft holds with the stages of the content type's chain, the content type's SMS
   * footer, its writers with the submitter among them, and its contract changes against `contractBaseline` (the
   * Active version, or after a revoke the newest Superseded one before its sunset; none when nothing renders).
   * The first stage's approvers who didn't write it are asked to review, and the open change requests that sent
   * the last round back are answered (`answerChangeRequests`). `rev` is the draft's rev from the summary the
   * author saw (`submitSummary`): a draft that has changed since is refused, so submit freezes only what the
   * dialog showed.
   *
   * Refuses, in this order: `generic` (no `version.submit` on the template's team, or no such template),
   * `template_gone`, `note_too_long`, `already_in_review` or `no_draft_to_submit` (no open draft), then the
   * transition's `summary_stale`, `no_channels`, `undefined_variables`, `field_missing`, the message rules
   * (`sms_characters`, `sms_too_many_parts`, `public_shortener`, `push_too_large`), and `version_changed` when
   * the write loses its compare-and-set.
   */
  submit(
    ctx: RequestContext,
    input: { templateId: string; note?: string | null; rev: number },
  ): Promise<ActionResult<{ number: number; round: number }>>;

  /**
   * Sends the round back with a reason (trimmed): the round becomes Changes requested, with the decision
   * recorded, the reason as an open thread about the whole version whose first comment is a `change_request`,
   * and the author's next draft, a copy of the round with the same block ids and its writers. When the template
   * already has an open draft, the author keeps working in it and it takes on the round's writers. The submitter
   * is notified.
   *
   * Refuses, in this order: the permission (`generic` without `version.decide` on the team, or for no such round;
   * `submitted_version` or `wrote_version` to someone who wrote it, maker-checker), `version_gone`,
   * `reason_too_long`, `waiting_on_stage` (the stage the round waits on names someone else), then the transition's
   * `not_in_review`, `stage_missing`, `reason_missing`, and `version_changed` when the write loses its
   * compare-and-set.
   */
  requestChanges(
    ctx: RequestContext,
    input: RoundRef & { reason: string },
  ): Promise<ActionResult>;

  /**
   * Approves the stage the round waits on. At an earlier stage of its own the round moves on to the next, whose
   * approvers are asked; at the last it goes live: the template's Active version, if there is one, becomes
   * Superseded first (one Active per template), with its sunset on `sunsetPrevious` (YYYY-MM-DD, 00:00 in the
   * business time zone) when one is given, and the round becomes Active. With nothing Active (a first version,
   * or after a revoke) nothing is superseded and the day is ignored once it parses. Consumers rendering the
   * template get a `new_version` notice (and `sunset_scheduled` for the version superseded with a sunset); the
   * submitter is notified. `outputsViewed` are the outputs the approver had on screen (decision 0037), and
   * `sampleSetsSeen` the sample sets: both are recorded with the decision.
   *
   * Refuses, in this order: the permission (as `requestChanges`), `version_gone`, `invalid_date`,
   * `waiting_on_stage`, then the transition's `not_in_review`, `approved_earlier_stage`, `stage_missing`,
   * `output_not_viewed`, `sunset_not_after_today`, and `version_changed` when either write (the Active
   * version's step down, or the round's) loses its compare-and-set.
   */
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

  /**
   * One approver starts a revoke of a released version (Active or Superseded) with a reason (trimmed). Nothing
   * stops rendering until a different approver confirms; the team's other approvers are asked to.
   *
   * Refuses, in this order: `generic` (no `version.revoke.start` on the team, or no such version),
   * `version_gone`, `reason_too_long`, then the transition's `already_revoked`, `not_revocable`,
   * `revoke_pending`, `reason_missing`, and `version_changed` when the write loses its compare-and-set.
   */
  startRevoke(
    ctx: RequestContext,
    input: VersionRef & { reason: string },
  ): Promise<ActionResult>;

  /**
   * A different approver confirms the pending revoke: the version is Revoked and its renders fail at once.
   * Consumers rendering the template get a `revoked` notice; the starter and the submitter are notified.
   *
   * Refuses, in this order: `generic` (no `version.revoke.confirm` on the team, or no such version), `own_revoke`
   * (the starter), `version_gone`, then the transition's `already_revoked`, `no_revoke_pending`, and
   * `version_changed` when the write loses its compare-and-set.
   */
  confirmRevoke(ctx: RequestContext, input: VersionRef): Promise<ActionResult>;

  /**
   * Withdraws a pending revoke: anyone who may start one, the starter included. The version keeps rendering.
   *
   * Refuses, in this order: `generic` (no `version.revoke.start` on the team, or no such version),
   * `version_gone`, then the transition's `already_revoked`, `no_revoke_pending`, and `version_changed` when the
   * write loses its compare-and-set.
   */
  cancelRevoke(ctx: RequestContext, input: VersionRef): Promise<ActionResult>;

  /** The review queue of a space (`teamId` null: All teams). */
  queue(
    ctx: RequestContext,
    input: { teamId: string | null },
  ): Promise<ReadResult<Unsettled<"P4a: the review queue's facts">>>;

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
  ): Promise<ReadResult<Unsettled<"P4a: the review screen's facts">>>;

  /**
   * What submitting the template's draft would freeze, read from the saved draft (`SubmitFacts`), with the
   * draft's `rev` for submit to send back and `asOf`, the instant the baseline was decided at. Refuses 404
   * `template_unavailable` for a template that doesn't exist or that the viewer may not see (the two read the
   * same, decision 0052), 403 for one they may see but not submit on, and 409 `already_in_review` or
   * `no_draft_to_submit` when there is no open draft.
   */
  submitSummary(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<SubmitFacts>>;
}
