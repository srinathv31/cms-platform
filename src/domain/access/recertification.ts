// Quarterly recertification: each member (Team Admins aside) is kept or removed by the deadline. Removing
// ends access at once. Anyone still unconfirmed when the deadline arrives lapses AT the deadline
// (now >= dueAt), and the review closes (`sweepAccess` applies that).

import { DAY_MS, formatLongDate } from "../dates";
import { REASONS } from "../permissions";
import { refuse } from "../refusals";
import {
  RECERT_WINDOW_DAYS,
  type AccessEffect,
  type MembershipChange,
  type MembershipFacts,
  type Named,
  type Ok,
  type RecertDecision,
  type RecertFacts,
  type RecertItemFacts,
  type RecertPhase,
  type RecertProgress,
  type Refused,
} from "../access-types";
import { losesLastAdmin } from "./members";
import { ACCESS_REFUSALS } from "./refusals";
import { sortRoles } from "./roles";

/**
 * upcoming: before startsAt. open: from startsAt until the deadline. closed: completed, or the
 * deadline has arrived (now >= dueAt) even if the sweep hasn't written it yet.
 */
export function recertPhase(
  r: Pick<RecertFacts, "startsAt" | "dueAt" | "completedAt">,
  now: Date,
): RecertPhase {
  if (r.completedAt) return "closed";
  if (now.getTime() >= r.dueAt.getTime()) return "closed";
  if (now.getTime() < r.startsAt.getTime()) return "upcoming";
  return "open";
}

/**
 * Who a review covers: the team's active members, Team Admins aside (nobody recertifies themselves,
 * and the team's admins are reviewed by the platform, outside this prototype). Sorted by user id.
 */
export function recertSubjects(
  memberships: readonly MembershipFacts[],
  teamId: string,
): string[] {
  return memberships
    .filter(
      (m) =>
        m.teamId === teamId &&
        m.status === "active" &&
        !m.roles.includes("team_admin"),
    )
    .map((m) => m.userId)
    .sort();
}

/**
 * Progress: "4 of 6 confirmed" counts decided items (kept or removed). An undecided item whose person
 * no longer has a membership on the team (removed on the Members page) counts as removed.
 */
export function recertProgress(
  r: Pick<RecertFacts, "items" | "teamId">,
  memberships: readonly MembershipFacts[],
): RecertProgress {
  const members = new Set(
    memberships.filter((m) => m.teamId === r.teamId).map((m) => m.userId),
  );
  let kept = 0;
  let removed = 0;
  for (const item of r.items) {
    if (item.decision === "keep") kept += 1;
    else if (item.decision === "remove" || !members.has(item.userId))
      removed += 1;
  }
  const total = r.items.length;
  const decided = kept + removed;
  return {
    total,
    decided,
    kept,
    removed,
    pending: total - decided,
    label: `${decided} of ${total} confirmed`,
  };
}

/** "Q1 2027": the calendar quarter (UTC) of the deadline. */
export function quarterLabel(dueAt: Date): string {
  return `Q${Math.floor(dueAt.getUTCMonth() / 3) + 1} ${dueAt.getUTCFullYear()}`;
}

export interface NewRecert {
  teamId: string;
  label: string;
  startsAt: Date;
  dueAt: Date;
  items: RecertItemFacts[];
}

/** When a review started at `now` is due: RECERT_WINDOW_DAYS later. */
export function recertDueAt(now: Date): Date {
  return new Date(now.getTime() + RECERT_WINDOW_DAYS * DAY_MS);
}

/** A Team Admin starts a review now, due in 30 days, covering the team's members (Team Admins aside). */
export function startRecert(input: {
  team: Named;
  actor: Named;
  now: Date;
  memberships: readonly MembershipFacts[];
  /** The team's recertifications that aren't closed (open or upcoming). */
  unfinished: readonly Pick<
    RecertFacts,
    "startsAt" | "dueAt" | "completedAt"
  >[];
}): Ok<{ recert: NewRecert; effects: AccessEffect[] }> | Refused {
  const { team, actor, now } = input;
  if (input.unfinished.some((r) => recertPhase(r, now) !== "closed"))
    return refuse(ACCESS_REFUSALS.reviewOpen);
  const subjects = recertSubjects(input.memberships, team.id);
  if (subjects.length === 0) return refuse(ACCESS_REFUSALS.nobodyToReview);
  const dueAt = recertDueAt(now);
  const label = quarterLabel(dueAt);
  return {
    ok: true,
    recert: {
      teamId: team.id,
      label,
      startsAt: now,
      dueAt,
      items: subjects.map((userId) => ({
        userId,
        decision: null,
        decidedBy: null,
        decidedAt: null,
      })),
    },
    effects: [
      {
        kind: "audit",
        action: "recert.started",
        teamId: team.id,
        details: {
          label,
          dueAt: dueAt.toISOString(),
          members: subjects.length,
        },
      },
      {
        kind: "notification",
        notification: "recert_due",
        to: { kind: "team_admins", teamId: team.id, exceptUserIds: [actor.id] },
        teamId: team.id,
        title: `${label} access review for ${team.name} is due ${formatLongDate(dueAt)}.`,
        body: `Confirm ${subjects.length} members.`,
        link: { to: "settings", teamId: team.id, section: "recertification" },
      },
    ],
  };
}

/**
 * Keep or Remove one member while the review is open. Remove ends their access at once. The review
 * closes early once every member is decided.
 */
export function decideRecertItem(input: {
  recert: RecertFacts;
  userId: string;
  member: Named;
  team: Named;
  actor: Named;
  decision: RecertDecision;
  now: Date;
  /** Every membership on the team (any status). */
  teamMemberships: readonly MembershipFacts[];
}):
  | Ok<{
      item: { decision: RecertDecision; decidedBy: string; decidedAt: Date };
      membership: MembershipChange | null;
      completedAt: Date | null;
      effects: AccessEffect[];
    }>
  | Refused {
  const { recert, userId, member, team, actor, decision, now } = input;
  if (actor.id === userId) return refuse(REASONS.ownAccess);
  const phase = recertPhase(recert, now);
  if (phase === "upcoming")
    return refuse(ACCESS_REFUSALS.reviewNotStarted(recert.startsAt));
  if (phase === "closed")
    return refuse(
      ACCESS_REFUSALS.reviewClosed(recert.completedAt ?? recert.dueAt),
    );
  const item = recert.items.find((i) => i.userId === userId);
  if (!item) return refuse(ACCESS_REFUSALS.notInReview);
  if (item.decision !== null) return refuse(ACCESS_REFUSALS.alreadyReviewed);
  const membership =
    input.teamMemberships.find(
      (m) => m.userId === userId && m.teamId === recert.teamId,
    ) ?? null;
  if (!membership) return refuse(ACCESS_REFUSALS.noLongerMember);
  if (
    decision === "remove" &&
    losesLastAdmin(input.teamMemberships, membership, null)
  ) {
    return refuse(ACCESS_REFUSALS.lastAdmin(team.name));
  }

  const decided = { decision, decidedBy: actor.id, decidedAt: now };
  const effects: AccessEffect[] = [
    {
      kind: "audit",
      action: decision === "keep" ? "recert.kept" : "recert.removed",
      teamId: team.id,
      details: {
        recertId: recert.id,
        label: recert.label,
        userId,
        userName: member.name,
        roles: sortRoles(membership.roles),
      },
    },
  ];
  let change: MembershipChange | null = null;
  if (decision === "remove") {
    change = { kind: "delete", membershipId: membership.id };
    effects.push({
      kind: "notification",
      notification: "access_removed",
      to: { kind: "user", userId },
      teamId: team.id,
      title: `Your access to ${team.name} was removed in the ${recert.label} access review.`,
      link: { to: "request-access" },
    });
  }

  // Close early when nobody is left to decide.
  const items = recert.items.map((i) =>
    i.userId === userId ? { ...i, ...decided } : i,
  );
  const remaining =
    decision === "remove"
      ? input.teamMemberships.filter((m) => m.id !== membership.id)
      : input.teamMemberships;
  const progress = recertProgress({ items, teamId: recert.teamId }, remaining);
  let completedAt: Date | null = null;
  if (progress.pending === 0) {
    completedAt = now;
    effects.push({
      kind: "audit",
      action: "recert.closed",
      teamId: team.id,
      details: {
        recertId: recert.id,
        label: recert.label,
        kept: progress.kept,
        removed: progress.removed,
        lapsed: 0,
      },
    });
  }
  return { ok: true, item: decided, membership: change, completedAt, effects };
}
