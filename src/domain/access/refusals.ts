// The refusal table of team access: a code to branch on, and the one-line wording the UI shows where
// the person tried. The table is whole and in one place, with its codes and sentences, so
// `src/domain/refusals.test.ts` can check that no code is used twice.

import { formatLongDate } from "../dates";
import { refusal } from "../refusals";
import { ACCESS_REASON_MAX, DECISION_NOTE_MAX, INACTIVITY_FLAG_DAYS } from "../access-types";
import type { TeamRole } from "../types";
import { ROLE_LABEL } from "./roles";

/** Refusals: a code to branch on, and the one-line wording the UI shows where the person tried. */
export const ACCESS_REFUSALS = {
  giveReason: refusal("request_reason_missing", "Add a reason."),
  reasonTooLong: refusal("request_reason_too_long", `Keep the reason under ${ACCESS_REASON_MAX} characters.`),
  pickRole: refusal("pick_requestable_role", "Pick Viewer, Author or Approver."),
  /** Approving an Auditor's request: no team role can be given to an Auditor. */
  auditorRequester: refusal("requester_is_auditor", (person: string) => `${person} is an Auditor and can't hold team roles.`),
  hasRole: refusal("has_role", (role: TeamRole, team: string) => `You already have ${ROLE_LABEL[role]} access to ${team}.`),
  pending: refusal("request_pending", (team: string) => `You already asked for access to ${team}.`),
  decided: refusal("request_decided", "This request was already decided."),
  denyNote: refusal("deny_note_missing", "Add a note to explain the decision."),
  noteTooLong: refusal("decision_note_too_long", `Keep the note under ${DECISION_NOTE_MAX} characters.`),
  pickRoles: refusal("no_roles", "Pick at least one role."),
  lastAdmin: refusal("last_admin", (team: string) => `${team} needs at least one Team Admin.`),
  notActive: refusal("membership_not_active", "This member's access isn't active."),
  alreadyActive: refusal("membership_already_active", "This member's access is already active."),
  notFlagged: refusal("not_inactive", `This member signed in within ${INACTIVITY_FLAG_DAYS} days.`),
  reviewNotStarted: refusal("recert_not_started", (startsAt: Date) => `This review starts on ${formatLongDate(startsAt)}.`),
  reviewClosed: refusal("recert_closed", (closedAt: Date) => `This review closed on ${formatLongDate(closedAt)}.`),
  notInReview: refusal("not_in_recert", "This person isn't part of this review."),
  alreadyReviewed: refusal("already_recertified", "This member was already reviewed."),
  noLongerMember: refusal("no_longer_member", "This person is no longer a member."),
  reviewOpen: refusal("recert_open", "A review is already open."),
  nobodyToReview: refusal("nobody_to_recertify", "There's nobody to review."),
} as const;
