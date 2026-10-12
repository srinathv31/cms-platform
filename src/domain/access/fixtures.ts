import { DAY_MS } from "../dates";
import { sweepAccess } from "./sweep";
import type {
  AccessAuditEffect,
  AccessEffect,
  AccessNotificationEffect,
  MembershipFacts,
  RecertFacts,
  SweepInput,
  SweepResult,
} from "../access-types";
import type { TeamRole } from "../types";

/** The reset moment: Monday, February 1, 2027, noon UTC. */
const BASE = Date.UTC(2027, 1, 1, 12);
export const at = (days: number, ms = 0) => new Date(BASE + days * DAY_MS + ms);
/** n days before BASE. */
export const ago = (days: number) => at(-days);

export const CORAL = { id: "coral-offers", name: "Coral Offers" };
export const DEPOSITS = { id: "deposits", name: "Deposits" };
export const PEOPLE = {
  alex: { id: "alex", name: "Alex Kim" },
  jordan: { id: "jordan", name: "Jordan Ellis" },
  maya: { id: "maya", name: "Maya Chen" },
  sam: { id: "sam", name: "Sam Ortiz" },
  devon: { id: "devon", name: "Devon Lin" },
  morgan: { id: "morgan", name: "Morgan Lee" },
  naomi: { id: "naomi", name: "Naomi Reyes" },
};

export function membership(
  userId: string,
  roles: TeamRole[],
  opts: Partial<MembershipFacts> & { activeDaysAgo?: number } = {},
): MembershipFacts {
  const { activeDaysAgo = 1, ...rest } = opts;
  return {
    id: `m_${userId}_${rest.teamId ?? CORAL.id}`,
    userId,
    teamId: CORAL.id,
    status: "active",
    statusReason: null,
    statusChangedAt: null,
    roles,
    addedAt: ago(300),
    lastActiveAt: ago(activeDaysAgo),
    inactivityFlaggedAt: null,
    inactivityKeptAt: null,
    ...rest,
  };
}

export function recert(
  opts: Partial<RecertFacts> & { users?: string[] } = {},
): RecertFacts {
  const { users = ["jordan", "maya", "sam", "devon"], ...rest } = opts;
  return {
    id: "rc_1",
    teamId: CORAL.id,
    label: "Q1 2027",
    startsAt: ago(4),
    dueAt: at(30),
    completedAt: null,
    items: users.map((userId) => ({
      userId,
      decision: null,
      decidedBy: null,
      decidedAt: null,
    })),
    ...rest,
  };
}

/** Coral Offers as seeded: Alex admin + approver; Devon 95 days without a sign-in. */
export function coral(): MembershipFacts[] {
  return [
    membership("alex", ["team_admin", "approver"]),
    membership("jordan", ["approver"]),
    membership("maya", ["author"]),
    membership("sam", ["viewer"], { activeDaysAgo: 1.25 }),
    membership("devon", ["viewer"], {
      activeDaysAgo: 95,
      inactivityFlaggedAt: ago(5),
    }),
  ];
}

export const audits = (effects: AccessEffect[]) =>
  effects.filter((e): e is AccessAuditEffect => e.kind === "audit");
export const notes = (effects: AccessEffect[]) =>
  effects.filter(
    (e): e is AccessNotificationEffect => e.kind === "notification",
  );

export function sweepAt(
  now: Date,
  memberships: MembershipFacts[],
  recerts: RecertFacts[] = [],
): SweepResult {
  const input: SweepInput = {
    now,
    memberships,
    recerts,
    teams: [CORAL, DEPOSITS],
    people: Object.values(PEOPLE),
  };
  return sweepAccess(input);
}

export function statusOf(result: SweepResult, membershipId: string) {
  const change = result.membershipChanges.find(
    (c) => c.kind === "update" && c.membershipId === membershipId,
  );
  return change?.kind === "update" ? change.set : undefined;
}
