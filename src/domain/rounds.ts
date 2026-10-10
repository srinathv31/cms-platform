// Version numbers and review rounds: the one place that numbers a submission, orders a template's rows,
// labels a version for people, and links to its review screen. Pure TypeScript.
//
// The version number counts releases. Each submission to review is a round of the version it will
// become: the first submission after a release is round 1 of the next number, and resubmitting after a
// send-back is the next round of the same number. Every round is its own row (frozen, audited, and what
// threads anchor to), so one number has its sent-back rounds and at most one row in review or released.
// Consumers never see rounds: they pin numbers, and a number means its released row.
//
// A label shows the round only once the number has been sent back, which the row's own facts say: an
// unreleased round shows it when it was sent back or isn't the first; a released row is "vN", plus the
// round it was approved on in the review history.
//
//   versionLabel({ number: 2, round: 1, state: "in_review" })                      "v2"
//   versionLabel({ number: 2, round: 1, state: "changes_requested" })              "v2 · Round 1"
//   versionLabel({ number: 2, round: 2, state: "in_review" }, { style: "sentence" }) "v2, round 2"
//   versionLabel({ number: 2, round: 3, state: "active" })                         "v2"
//   versionLabel({ number: 2, round: 3, state: "active" }, { history: true })      "v2 · Round 3"

import { plural } from "./plural";
import type { NotificationLink } from "./review-types";
import type { VersionState } from "./types";

// ── Shapes ────────────────────────────────────────────────────

/** A round of a version: its number and which submission of that number it is. */
export interface RoundRef {
  number: number;
  round: number;
}

/** Any row of a template's versions, the open draft included (no number and no round while a draft). */
export interface RoundRow {
  number: number | null;
  round: number | null;
  state: VersionState;
}

/** A submitted row: one round of a number, in the state it is in now. */
export interface NumberedRound extends RoundRef {
  state: VersionState;
}

/**
 * "chrome" for a label that stands alone (headings, meta lines, table cells, select options, queue rows):
 * "v2 · Round 2". "sentence" inside a phrase (dialog titles, buttons, toasts, notifications, audit and
 * activity sentences): "v2, round 2".
 */
export type LabelStyle = "chrome" | "sentence";

// ── Released ──────────────────────────────────────────────────

/** The states a version reaches only once approved: its text was released, and consumers can see it. */
export type ReleasedState = "active" | "superseded" | "revoked";

export const RELEASED_STATES: ReadonlySet<VersionState> = new Set<ReleasedState>(["active", "superseded", "revoked"]);

export function isReleased(state: VersionState): state is ReleasedState {
  return RELEASED_STATES.has(state);
}

// ── Numbering and order ───────────────────────────────────────

/** Ascending by number, then round; rows with neither (the open draft) last. */
export function compareRounds(a: Pick<RoundRow, "number" | "round">, b: Pick<RoundRow, "number" | "round">): number {
  if (a.number === null || b.number === null) return (a.number === null ? 1 : 0) - (b.number === null ? 1 : 0);
  return a.number - b.number || (a.round ?? 0) - (b.round ?? 0);
}

/**
 * The round the next submission becomes, given the template's rows. After a release (or with none yet),
 * round 1 of the next number: the highest released number, or 0, plus one. While that number has rounds
 * that weren't released (sent back, or one in review), the next round of it. A revoked version was
 * released, so it counts. The draft started from the Active version after a send-back was abandoned still
 * continues the number sent back: v1 Active and v2 round 1 sent back make the next submission v2 round 2.
 *
 * A database numbered before rounds can hold sent-back rows above every released number (v1 sent back,
 * then v2): the next submission continues the highest of them, so the order stays the submission order.
 */
export function nextRound(rows: readonly RoundRow[]): RoundRef {
  let released = 0;
  let top = 0;
  for (const row of rows) {
    if (row.number === null) continue;
    top = Math.max(top, row.number);
    if (isReleased(row.state)) released = Math.max(released, row.number);
  }
  const number = top > released ? top : released + 1;
  const round = rows.reduce((max, row) => (row.number === number ? Math.max(max, row.round ?? 0) : max), 0) + 1;
  return { number, round };
}

/** The row a number stands for: its released row, else its highest round. Undefined when it has no rows. */
export function headOf<T extends RoundRow>(rows: readonly T[], number: number): T | undefined {
  let head: T | undefined;
  for (const row of rows) {
    if (row.number !== number) continue;
    if (isReleased(row.state)) return row;
    if (head === undefined || (row.round ?? 0) > (head.round ?? 0)) head = row;
  }
  return head;
}

/**
 * The row a round's work went on to, which its review screen links to: its number's head, when that is
 * another row. A round sent back and then resubmitted is a record, and the head is where the number is
 * now: a later round (in review, or sent back again) or the released row. A round that is its number's
 * head has none: it is in review, it was released, or it was sent back and the author hasn't resubmitted
 * (their draft has no number yet).
 */
export function replacedBy<T extends RoundRow>(rows: readonly T[], shown: RoundRef): T | null {
  const head = headOf(rows, shown.number);
  return head !== undefined && head.round !== shown.round ? head : null;
}

/** Every round of a number, newest first. */
export function roundsOf<T extends RoundRow>(rows: readonly T[], number: number): T[] {
  return rows.filter((row) => row.number === number).sort((a, b) => (b.round ?? 0) - (a.round ?? 0));
}

/** A row known to be submitted, as a `NumberedRound`. A row without a number or a round is a bug. */
export function asNumbered(row: RoundRow): NumberedRound {
  if (row.number === null || row.round === null) {
    throw new Error(`A ${row.state} version without a number and a round can't be labelled.`);
  }
  return { number: row.number, round: row.round, state: row.state };
}

// ── Labels ────────────────────────────────────────────────────

/**
 * Whether a label names the round. An unreleased round does once its number was sent back: it was sent
 * back itself, or it isn't the first round. A released row is the version consumers know, so only the
 * review history (`history`) names the round it was approved on, and only when that wasn't the first.
 */
export function showsRound(v: NumberedRound, o: { history?: boolean } = {}): boolean {
  if (isReleased(v.state)) return o.history === true && v.round > 1;
  return v.state === "changes_requested" || v.round > 1;
}

/** "v2", or with the round: "v2 · Round 2" (chrome, the default) or "v2, round 2" (sentence). */
export function versionLabel(v: NumberedRound, o: { style?: LabelStyle; history?: boolean } = {}): string {
  if (!showsRound(v, o)) return `v${v.number}`;
  return o.style === "sentence" ? `v${v.number}, round ${v.round}` : `v${v.number} · ${roundLabel(v.round)}`;
}

/** "Round 2". */
export function roundLabel(round: number): string {
  return `Round ${round}`;
}

/** "Approved on round 3" for a released row that went through send-backs; null otherwise. */
export function approvedOnRound(v: NumberedRound): string | null {
  return isReleased(v.state) && v.round > 1 ? `Approved on round ${v.round}` : null;
}

/** "Review history (3 rounds)". */
export function reviewHistoryLabel(count: number): string {
  return `Review history (${plural(count, "round")})`;
}

/**
 * The review history's accessible name, which says whose history it is (two entries can both have two
 * rounds): "v2 review history (3 rounds)". It keeps the visible label's words.
 */
export function reviewHistoryName(number: number, count: number): string {
  return `v${number} ${reviewHistoryLabel(count).toLowerCase()}`;
}

// ── Review links ──────────────────────────────────────────────

/**
 * The round's review screen. The bare URL is the number's head (its released row, else its latest
 * round), so `?round=` is added exactly when the label shows the round: otherwise the bare URL is
 * already this row. (For a stage reviewer outside the team the head is closed to, the bare URL opens
 * the newest round they may open instead: `requireReviewVersion` on the server.)
 */
export function reviewPath(space: string, templateId: string, v: NumberedRound): string {
  const path = `/${space}/review/${templateId}/${v.number}`;
  return showsRound(v) ? `${path}?round=${v.round}` : path;
}

/** A notification's link to the round's review screen, naming the round when `reviewPath` would. */
export function reviewLink(templateId: string, v: NumberedRound): Extract<NotificationLink, { to: "review" }> {
  return showsRound(v)
    ? { to: "review", templateId, versionNumber: v.number, round: v.round }
    : { to: "review", templateId, versionNumber: v.number };
}

/**
 * The review screen's `?round=`: null when absent (the number's head), the round when it is a whole
 * number from 1, and "invalid" for anything else ("0", "x", a repeated parameter), which is a 404.
 */
export function parseRoundParam(raw: string | string[] | undefined): number | null | "invalid" {
  if (raw === undefined) return null;
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,8}$/.test(raw)) return "invalid";
  return Number(raw);
}
