// The sweep: what the clock did since last time. Applies every deadline the demo clock has reached
// (a review's deadline, 90 days flagged, 120 days suspended), backdated to the instant each was reached.

import { formatLongDate } from "../dates";
import {
  INACTIVITY_FLAG_DAYS,
  INACTIVITY_SUSPEND_DAYS,
  type AccessEffect,
  type MembershipChange,
  type MembershipFacts,
  type MembershipSet,
  type Named,
  type RecertFacts,
  type SweepInput,
  type SweepResult,
} from "../access-types";
import { inactivityAnchor, inactivity, flaggedFor, suspensionHeld, type Inactivity } from "./inactivity";
import { recertProgress } from "./recertification";
import { sortRoles } from "./roles";

type Boundary =
  | { kind: "lapse"; at: Date; recert: RecertFacts }
  | { kind: "auto_suspend"; at: Date; daysInactive: number };

/** One active membership's view of the sweep: its clock and what would end it, earliest first. */
interface SweepPlan {
  m: MembershipFacts;
  idle: Inactivity;
  boundaries: Boundary[];
  /** The team's last active Team Admin: nothing the clock crossed ends their access (see below). */
  held: boolean;
}

/**
 * Applies every deadline the demo clock has reached, backdated to the instant each was reached:
 *   - an open review whose deadline arrived (now >= dueAt): unconfirmed active members lapse at
 *     dueAt (a current Team Admin never does), and the review closes at dueAt;
 *   - an active member at 120 days (now >= anchor + 120d) is suspended at that instant;
 *   - an active member at 90 days who isn't flagged yet is flagged at anchor + 90d (Team Admins are
 *     told, unless the same sweep also ended the membership).
 * When several boundaries hit one membership, the earliest wins (a tie goes to the review); the
 * others no longer apply because the membership is no longer active.
 *
 * A team always keeps an active Team Admin: when the clock would end the access of every active
 * Team Admin a team has, the one whose access would end last is kept (`access.kept_last_admin`, at
 * the boundary) and the Platform Admins are told. They stay flagged on the Inactivity page, where a
 * Team Admin added later can suspend them.
 *
 * Idempotent: applying the result and sweeping again at the same `now` changes nothing. Effects come
 * out in time order.
 */
export function sweepAccess(input: SweepInput): SweepResult {
  const { now } = input;
  const t = now.getTime();
  const teamName = (id: string) => input.teams.find((x) => x.id === id)?.name ?? id;
  const personName = (id: string) => input.people.find((x) => x.id === id)?.name ?? id;

  const due = input.recerts
    .filter((r) => r.completedAt === null && r.dueAt.getTime() <= t)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id));

  // 1. What would end each active membership, earliest first; a tie goes to the review.
  const plans: SweepPlan[] = [...input.memberships]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((m) => m.status === "active")
    .map((m) => {
      const boundaries: Boundary[] = [];
      // A review never ends a current Team Admin (they're outside a review when it starts, too):
      // someone promoted while it ran stays on its list but doesn't lapse at the deadline.
      const reviewed = !m.roles.includes("team_admin");
      for (const r of due) {
        if (!reviewed || r.teamId !== m.teamId) continue;
        const item = r.items.find((i) => i.userId === m.userId);
        if (item && item.decision === null) boundaries.push({ kind: "lapse", at: r.dueAt, recert: r });
      }
      const idle = inactivity(m, now);
      if (idle.state === "suspend_due" && !suspensionHeld(m, idle)) {
        boundaries.push({ kind: "auto_suspend", at: idle.suspendAt, daysInactive: INACTIVITY_SUSPEND_DAYS });
      }
      boundaries.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === "lapse" ? -1 : 1));
      return { m, idle, boundaries, held: false };
    });

  // 2. The last Team Admin rule: if every active Team Admin of a team would go, keep the last to go.
  const admins = plans.filter((p) => p.m.roles.includes("team_admin"));
  for (const teamId of new Set(admins.map((p) => p.m.teamId))) {
    const here = admins.filter((p) => p.m.teamId === teamId);
    if (here.some((p) => p.boundaries.length === 0)) continue;
    const last = here.reduce((a, b) => {
      const d = a.boundaries[0]!.at.getTime() - b.boundaries[0]!.at.getTime();
      return d > 0 || (d === 0 && a.m.id > b.m.id) ? a : b;
    });
    last.held = true;
  }

  const membershipChanges: MembershipChange[] = [];
  const effects: AccessEffect[] = [];
  const lapsedByRecert = new Map<string, number>();

  for (const { m, idle, boundaries, held } of plans) {
    const team = { id: m.teamId, name: teamName(m.teamId) };
    const member = { id: m.userId, name: personName(m.userId) };
    const first = held ? undefined : boundaries[0];

    // The 90-day flag, if it came before whatever ended the membership.
    const set: MembershipSet = {};
    const flagged = idle.state !== "ok" && !flaggedFor(m, idle) && (!first || idle.flagAt.getTime() < first.at.getTime());
    if (flagged) {
      set.inactivityFlaggedAt = idle.flagAt;
      effects.push({
        kind: "audit",
        action: "access.flagged_inactive",
        teamId: team.id,
        actorId: null,
        at: idle.flagAt,
        details: {
          userId: member.id,
          userName: member.name,
          lastActiveAt: inactivityAnchor(m).toISOString(),
          suspendsAt: idle.suspendAt.toISOString(),
        },
      });
      if (!first) {
        effects.push({
          kind: "notification",
          notification: "inactivity_flagged",
          to: { kind: "team_admins", teamId: team.id, exceptUserIds: [member.id] },
          teamId: team.id,
          title: `${member.name} hasn't signed in for ${INACTIVITY_FLAG_DAYS} days.`,
          body: `Access to ${team.name} is suspended automatically on ${formatLongDate(idle.suspendAt)}.`,
          link: { to: "settings", teamId: team.id, section: "inactivity" },
          at: idle.flagAt,
        });
      }
    }

    if (held) {
      for (const b of boundaries) {
        if (b.kind === "auto_suspend") set.inactivityFlaggedAt = idle.suspendAt; // "held once" marker
        effects.push(...keptLastAdminEffects(b, team, member));
      }
    } else if (first?.kind === "lapse") {
      Object.assign(set, { status: "lapsed", statusReason: "recert_unconfirmed", statusChangedAt: first.at } satisfies MembershipSet);
      lapsedByRecert.set(first.recert.id, (lapsedByRecert.get(first.recert.id) ?? 0) + 1);
      const by = formatLongDate(first.at);
      effects.push(
        {
          kind: "audit",
          action: "access.lapsed",
          teamId: team.id,
          actorId: null,
          at: first.at,
          details: {
            userId: member.id,
            userName: member.name,
            recertId: first.recert.id,
            label: first.recert.label,
            dueAt: first.at.toISOString(),
            roles: sortRoles(m.roles),
          },
        },
        {
          kind: "notification",
          notification: "access_lapsed",
          to: { kind: "user", userId: member.id },
          teamId: team.id,
          title: `Your access to ${team.name} lapsed: it wasn't recertified by ${by}.`,
          link: { to: "request-access" },
          at: first.at,
        },
        {
          kind: "notification",
          notification: "access_lapsed",
          to: { kind: "team_admins", teamId: team.id, exceptUserIds: [member.id] },
          teamId: team.id,
          title: `${member.name}'s access to ${team.name} lapsed: not recertified by ${by}.`,
          link: { to: "settings", teamId: team.id, section: "recertification" },
          at: first.at,
        },
      );
    } else if (first?.kind === "auto_suspend") {
      Object.assign(set, { status: "suspended", statusReason: "inactivity_auto", statusChangedAt: first.at } satisfies MembershipSet);
      effects.push(
        {
          kind: "audit",
          action: "access.suspended",
          teamId: team.id,
          actorId: null,
          at: first.at,
          details: { userId: member.id, userName: member.name, reason: "inactivity_auto", daysInactive: first.daysInactive },
        },
        {
          kind: "notification",
          notification: "access_suspended",
          to: { kind: "user", userId: member.id },
          teamId: team.id,
          title: `Your access to ${team.name} was suspended after ${first.daysInactive} days without a sign-in.`,
          link: { to: "request-access" },
          at: first.at,
        },
        {
          kind: "notification",
          notification: "access_suspended",
          to: { kind: "team_admins", teamId: team.id, exceptUserIds: [member.id] },
          teamId: team.id,
          title: `${member.name}'s access to ${team.name} was suspended after ${first.daysInactive} days without a sign-in.`,
          link: { to: "settings", teamId: team.id, section: "inactivity" },
          at: first.at,
        },
      );
    }

    if (Object.keys(set).length > 0) membershipChanges.push({ kind: "update", membershipId: m.id, set });
  }

  const recertsClosed = due.map((r) => ({ id: r.id, completedAt: r.dueAt }));
  for (const r of due) {
    const members = input.memberships.filter((m) => m.teamId === r.teamId);
    const progress = recertProgress(r, members);
    effects.push({
      kind: "audit",
      action: "recert.closed",
      teamId: r.teamId,
      actorId: null,
      at: r.dueAt,
      details: {
        recertId: r.id,
        label: r.label,
        kept: progress.kept,
        removed: progress.removed,
        lapsed: lapsedByRecert.get(r.id) ?? 0,
      },
    });
  }

  // Time order; inside one instant, the order they were produced in (Array.prototype.sort is stable).
  effects.sort((a, b) => (a.at?.getTime() ?? t) - (b.at?.getTime() ?? t));
  return { membershipChanges, recertsClosed, effects };
}

/** The last Team Admin kept past a boundary: an audit row, and the Platform Admins are told. */
function keptLastAdminEffects(b: Boundary, team: Named, member: Named): AccessEffect[] {
  const details =
    b.kind === "lapse"
      ? { recertId: b.recert.id, label: b.recert.label, dueAt: b.at.toISOString() }
      : { daysInactive: b.daysInactive };
  const title =
    b.kind === "lapse"
      ? `${member.name} wasn't recertified by ${formatLongDate(b.at)}, but as the last Team Admin of ${team.name} their access stays on.`
      : `${member.name} hasn't signed in for ${b.daysInactive} days, but as the last Team Admin of ${team.name} their access stays on.`;
  return [
    {
      kind: "audit",
      action: "access.kept_last_admin",
      teamId: team.id,
      actorId: null,
      at: b.at,
      details: {
        userId: member.id,
        userName: member.name,
        teamName: team.name,
        reason: b.kind === "lapse" ? "recert_unconfirmed" : "inactivity_auto",
        ...details,
      },
    },
    {
      kind: "notification",
      notification: b.kind === "lapse" ? "recert_due" : "inactivity_flagged",
      to: { kind: "platform_admins" },
      teamId: team.id,
      title,
      link: { to: "platform", section: "teams" },
      at: b.at,
    },
  ];
}
