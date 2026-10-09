import { describe, expect, it } from "vitest";
import {
  ACCESS_REFUSALS,
  DAY_MS,
  changeRoles,
  decideAccessRequest,
  decideRecertItem,
  describeRoleChange,
  firstName,
  heldAsLastAdmin,
  inactivity,
  inactivityAnchor,
  keepInactive,
  memberConsequences,
  membershipStatusLabel,
  quarterLabel,
  recertDueAt,
  recertFootnote,
  recertItemOutcome,
  recertPhase,
  recertProgress,
  recertRemoveConsequence,
  recertSubjects,
  reinstate,
  removeMember,
  requestAccess,
  requestConsequences,
  requestDecisionRefusal,
  rolesLabel,
  sortRoles,
  startRecert,
  startRecertConsequence,
  suspendInactive,
  sweepAccess,
  validateDecisionNote,
  validateRoles,
} from "./access";
import { REASONS } from "./permissions";
import type {
  AccessAuditEffect,
  AccessEffect,
  AccessNotificationEffect,
  AccessRequestFacts,
  MembershipFacts,
  RecertFacts,
  SweepInput,
  SweepResult,
} from "./access-types";
import type { TeamRole } from "./types";

// ── Fixtures ──────────────────────────────────────────────────

/** The reset moment: Monday, February 1, 2027, noon UTC. */
const BASE = Date.UTC(2027, 1, 1, 12);
const at = (days: number, ms = 0) => new Date(BASE + days * DAY_MS + ms);
/** n days before BASE. */
const ago = (days: number) => at(-days);

const CORAL = { id: "coral-offers", name: "Coral Offers" };
const DEPOSITS = { id: "deposits", name: "Deposits" };
const PEOPLE = {
  alex: { id: "alex", name: "Alex Kim" },
  jordan: { id: "jordan", name: "Jordan Ellis" },
  maya: { id: "maya", name: "Maya Chen" },
  sam: { id: "sam", name: "Sam Ortiz" },
  devon: { id: "devon", name: "Devon Lin" },
  morgan: { id: "morgan", name: "Morgan Lee" },
  naomi: { id: "naomi", name: "Naomi Reyes" },
};

function membership(
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

function request(opts: Partial<AccessRequestFacts> = {}): AccessRequestFacts {
  return {
    id: "ar_1",
    userId: "morgan",
    teamId: CORAL.id,
    role: "author",
    reason: "Drafting the spring promotions.",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: ago(1),
    ...opts,
  };
}

function recert(opts: Partial<RecertFacts> & { users?: string[] } = {}): RecertFacts {
  const { users = ["jordan", "maya", "sam", "devon"], ...rest } = opts;
  return {
    id: "rc_1",
    teamId: CORAL.id,
    label: "Q1 2027",
    startsAt: ago(4),
    dueAt: at(30),
    completedAt: null,
    items: users.map((userId) => ({ userId, decision: null, decidedBy: null, decidedAt: null })),
    ...rest,
  };
}

/** Coral Offers as seeded: Alex admin + approver; Devon 95 days without a sign-in. */
function coral(): MembershipFacts[] {
  return [
    membership("alex", ["team_admin", "approver"]),
    membership("jordan", ["approver"]),
    membership("maya", ["author"]),
    membership("sam", ["viewer"], { activeDaysAgo: 1.25 }),
    membership("devon", ["viewer"], { activeDaysAgo: 95, inactivityFlaggedAt: ago(5) }),
  ];
}

const audits = (effects: AccessEffect[]) => effects.filter((e): e is AccessAuditEffect => e.kind === "audit");
const notes = (effects: AccessEffect[]) =>
  effects.filter((e): e is AccessNotificationEffect => e.kind === "notification");

function sweepAt(now: Date, memberships: MembershipFacts[], recerts: RecertFacts[] = []): SweepResult {
  const input: SweepInput = {
    now,
    memberships,
    recerts,
    teams: [CORAL, DEPOSITS],
    people: Object.values(PEOPLE),
  };
  return sweepAccess(input);
}

/** What the server does with a sweep: write the changes back. */
function apply(result: SweepResult, memberships: MembershipFacts[], recerts: RecertFacts[]) {
  const nextMemberships = memberships.map((m) => {
    const change = result.membershipChanges.find((c) => c.kind === "update" && c.membershipId === m.id);
    return change?.kind === "update" ? { ...m, ...change.set } : m;
  });
  const nextRecerts = recerts.map((r) => {
    const closed = result.recertsClosed.find((c) => c.id === r.id);
    return closed ? { ...r, completedAt: closed.completedAt } : r;
  });
  return { memberships: nextMemberships, recerts: nextRecerts };
}

function statusOf(result: SweepResult, membershipId: string) {
  const change = result.membershipChanges.find((c) => c.kind === "update" && c.membershipId === membershipId);
  return change?.kind === "update" ? change.set : undefined;
}

// ── Roles ─────────────────────────────────────────────────────

describe("roles", () => {
  it("sorts least to most authority, without repeats", () => {
    expect(sortRoles(["team_admin", "author", "viewer", "author"])).toEqual(["viewer", "author", "team_admin"]);
  });

  it('labels a set of roles "Author & Approver"', () => {
    expect(rolesLabel(["approver", "author"])).toBe("Author & Approver");
  });

  it("labels each membership status in a few words", () => {
    expect(membershipStatusLabel("active", null)).toBe("Active");
    expect(membershipStatusLabel("lapsed", "recert_unconfirmed")).toBe("Lapsed: not recertified");
    expect(membershipStatusLabel("suspended", "inactivity")).toBe("Suspended: inactive");
    expect(membershipStatusLabel("suspended", "inactivity_auto")).toBe("Suspended automatically: inactive");
  });
});

// ── Inactivity ────────────────────────────────────────────────

describe("inactivity", () => {
  const m = (lastActiveAt: Date | null, extra: Partial<MembershipFacts> = {}) =>
    membership("devon", ["viewer"], { lastActiveAt, ...extra });

  it("runs from the latest of last sign-in, date added, and the last Keep", () => {
    expect(inactivityAnchor(m(ago(95))).getTime()).toBe(ago(95).getTime());
    expect(inactivityAnchor(m(null, { addedAt: ago(10) })).getTime()).toBe(ago(10).getTime());
    expect(inactivityAnchor(m(ago(95), { addedAt: ago(20) })).getTime()).toBe(ago(20).getTime());
    expect(inactivityAnchor(m(ago(95), { inactivityKeptAt: ago(3) })).getTime()).toBe(ago(3).getTime());
  });

  it("is ok one millisecond before 90 days", () => {
    const state = inactivity(m(ago(0)), at(90, -1));
    expect(state.state).toBe("ok");
    expect(state.daysInactive).toBe(89);
  });

  it("is flagged exactly at 90 days", () => {
    const state = inactivity(m(ago(0)), at(90));
    expect(state.state).toBe("flagged");
    expect(state.daysInactive).toBe(90);
    expect(state.flagAt.getTime()).toBe(at(90).getTime());
    expect(state.suspendAt.getTime()).toBe(at(120).getTime());
  });

  it("stays flagged until one millisecond before 120 days, then is due for suspension", () => {
    expect(inactivity(m(ago(0)), at(120, -1)).state).toBe("flagged");
    expect(inactivity(m(ago(0)), at(120)).state).toBe("suspend_due");
    expect(inactivity(m(ago(0)), at(120, 1)).state).toBe("suspend_due");
  });

  it("someone who never signed in counts from the day they were added", () => {
    expect(inactivity(m(null, { addedAt: ago(0) }), at(89)).state).toBe("ok");
    expect(inactivity(m(null, { addedAt: ago(0) }), at(90)).state).toBe("flagged");
  });

  it("a Keep restarts the clock", () => {
    const kept = m(ago(100), { inactivityKeptAt: ago(0) });
    expect(inactivity(kept, at(0)).state).toBe("ok");
    expect(inactivity(kept, at(90)).state).toBe("flagged");
    expect(inactivity(kept, at(120)).state).toBe("suspend_due");
  });
});

// ── Recertification: reading ──────────────────────────────────

describe("recertification phase", () => {
  const r = recert({ startsAt: at(0), dueAt: at(30) });

  it("is upcoming before it starts and open from the start", () => {
    expect(recertPhase(r, at(0, -1))).toBe("upcoming");
    expect(recertPhase(r, at(0))).toBe("open");
  });

  it("is open until one millisecond before the deadline and closed at it", () => {
    expect(recertPhase(r, at(30, -1))).toBe("open");
    expect(recertPhase(r, at(30))).toBe("closed");
    expect(recertPhase(r, at(30, 1))).toBe("closed");
  });

  it("is closed once completed, whatever the time", () => {
    expect(recertPhase({ ...r, completedAt: at(5) }, at(6))).toBe("closed");
  });
});

describe("recertification subjects and progress", () => {
  it("covers active members of the team, Team Admins aside", () => {
    const list = [
      ...coral(),
      membership("naomi", ["team_admin"], { teamId: DEPOSITS.id }),
      membership("morgan", ["viewer"], { status: "lapsed", statusReason: "recert_unconfirmed" }),
    ];
    expect(recertSubjects(list, CORAL.id)).toEqual(["devon", "jordan", "maya", "sam"]);
  });

  it('reads "4 of 6 confirmed"', () => {
    const r = recert({ users: ["a", "b", "c", "d", "e", "f"] });
    r.items[0]!.decision = "keep";
    r.items[1]!.decision = "keep";
    r.items[2]!.decision = "keep";
    r.items[3]!.decision = "remove";
    const members = ["a", "b", "c", "e", "f"].map((u) => membership(u, ["viewer"]));
    expect(recertProgress(r, members)).toEqual({
      total: 6,
      decided: 4,
      kept: 3,
      removed: 1,
      pending: 2,
      label: "4 of 6 confirmed",
    });
  });

  it("counts someone removed on the Members page as removed", () => {
    const r = recert({ users: ["jordan", "maya"] });
    const progress = recertProgress(r, [membership("jordan", ["approver"])]);
    expect(progress).toMatchObject({ decided: 1, removed: 1, pending: 1 });
  });

  it("labels the quarter of the deadline", () => {
    expect(quarterLabel(new Date(Date.UTC(2027, 2, 3)))).toBe("Q1 2027");
    expect(quarterLabel(new Date(Date.UTC(2026, 9, 31)))).toBe("Q4 2026");
  });
});

// ── Requesting access ─────────────────────────────────────────

describe("requestAccess", () => {
  const base = {
    requester: PEOPLE.morgan,
    team: CORAL,
    role: "author" as TeamRole,
    reason: "  Drafting the spring promotions.  ",
    now: at(0),
    memberships: [] as MembershipFacts[],
    requests: [] as AccessRequestFacts[],
  };

  it("records the request and tells the team's admins", () => {
    const result = requestAccess(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toEqual({
      userId: "morgan",
      teamId: CORAL.id,
      role: "author",
      reason: "Drafting the spring promotions.",
      createdAt: at(0),
    });
    expect(audits(result.effects)).toEqual([
      expect.objectContaining({
        action: "access.requested",
        teamId: CORAL.id,
        details: { userId: "morgan", userName: "Morgan Lee", role: "author", reason: "Drafting the spring promotions." },
      }),
    ]);
    const [note] = notes(result.effects);
    expect(note).toMatchObject({
      notification: "access_requested",
      to: { kind: "team_admins", teamId: CORAL.id, exceptUserIds: ["morgan"] },
      title: "Morgan Lee asked for Author access to Coral Offers.",
      body: "Drafting the spring promotions.",
      link: { to: "settings", teamId: CORAL.id, section: "access-requests" },
    });
  });

  it("offers Viewer, Author and Approver only", () => {
    for (const role of ["viewer", "author", "approver"] as TeamRole[]) expect(requestAccess({ ...base, role }).ok).toBe(true);
    expect(requestAccess({ ...base, role: "team_admin" })).toEqual({ ok: false, ...ACCESS_REFUSALS.pickRole });
  });

  it("needs a reason, kept short", () => {
    expect(requestAccess({ ...base, reason: "   " })).toEqual({ ok: false, code: "request_reason_missing", reason: "Add a reason." });
    expect(requestAccess({ ...base, reason: "x".repeat(501) })).toEqual({ ok: false, ...ACCESS_REFUSALS.reasonTooLong });
    expect(requestAccess({ ...base, reason: "x".repeat(500) }).ok).toBe(true);
  });

  it("allows one pending request per team", () => {
    const pending = request({ userId: "morgan", teamId: CORAL.id });
    expect(requestAccess({ ...base, requests: [pending] })).toEqual({
      ok: false,
      code: "request_pending",
      reason: "You already asked for access to Coral Offers.",
    });
    expect(requestAccess({ ...base, team: DEPOSITS, requests: [pending] }).ok).toBe(true);
    expect(requestAccess({ ...base, requests: [{ ...pending, status: "denied" }] }).ok).toBe(true);
  });

  it("refuses a role already held, but a member may ask for another one", () => {
    const priya = { ...base, requester: { id: "priya", name: "Priya Raman" } };
    const viewer = membership("priya", ["viewer"], { teamId: DEPOSITS.id });
    expect(requestAccess({ ...priya, team: DEPOSITS, role: "viewer", memberships: [viewer] })).toEqual({
      ok: false,
      code: "has_role",
      reason: "You already have Viewer access to Deposits.",
    });
    expect(requestAccess({ ...priya, team: DEPOSITS, role: "author", memberships: [viewer] }).ok).toBe(true);
  });

  it("someone whose access lapsed may ask again for the same role", () => {
    const lapsed = membership("sam", ["viewer"], { status: "lapsed", statusReason: "recert_unconfirmed" });
    const result = requestAccess({ ...base, requester: PEOPLE.sam, role: "viewer", memberships: [lapsed] });
    expect(result.ok).toBe(true);
  });
});

// ── Deciding access ───────────────────────────────────────────

describe("decideAccessRequest", () => {
  const base = {
    request: request(),
    requester: PEOPLE.morgan,
    team: CORAL,
    actor: PEOPLE.alex,
    decision: "approve" as const,
    now: at(0),
    membership: null,
  };

  it("never on your own request", () => {
    expect(decideAccessRequest({ ...base, request: request({ userId: "alex" }), requester: PEOPLE.alex })).toEqual({
      ok: false,
      code: "own_request",
      reason: "You can't decide your own access request.",
    });
  });

  it("only while pending", () => {
    expect(decideAccessRequest({ ...base, request: request({ status: "approved" }) })).toEqual({
      ok: false,
      code: "request_decided",
      reason: "This request was already decided.",
    });
  });

  it("approving adds a membership with the role and tells the requester", () => {
    const result = decideAccessRequest(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toEqual({ status: "approved", decidedBy: "alex", decidedAt: at(0), decisionNote: null });
    expect(result.membership).toEqual({
      kind: "insert",
      membership: { userId: "morgan", teamId: CORAL.id, roles: ["author"], addedAt: at(0), addedBy: "alex" },
    });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.granted",
      details: { requestId: "ar_1", userId: "morgan", userName: "Morgan Lee", role: "author", roles: ["author"] },
    });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "access_granted",
      to: { kind: "user", userId: "morgan" },
      title: "Alex Kim approved your Author access to Coral Offers.",
      link: { to: "library", teamId: CORAL.id },
    });
  });

  it("approving for an active member adds the role to the ones they have", () => {
    const current = membership("morgan", ["viewer"]);
    const result = decideAccessRequest({ ...base, membership: current });
    expect(result.ok && result.membership).toEqual({
      kind: "update",
      membershipId: current.id,
      set: { roles: ["viewer", "author"] },
    });
  });

  it("approving for a lapsed member reinstates them with the requested role and a fresh inactivity clock", () => {
    const lapsed = membership("morgan", ["approver"], { status: "lapsed", statusReason: "recert_unconfirmed" });
    const result = decideAccessRequest({ ...base, membership: lapsed });
    expect(result.ok && result.membership).toEqual({
      kind: "update",
      membershipId: lapsed.id,
      set: {
        status: "active",
        statusReason: null,
        statusChangedAt: at(0),
        roles: ["author"],
        inactivityFlaggedAt: null,
        inactivityKeptAt: at(0),
      },
    });
  });

  it("denying needs a note, which the requester sees", () => {
    expect(decideAccessRequest({ ...base, decision: "deny", note: "  " })).toEqual({
      ok: false,
      code: "deny_note_missing",
      reason: "Add a note to explain the decision.",
    });
    const result = decideAccessRequest({ ...base, decision: "deny", note: " Ask Jordan first. " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toBeNull();
    expect(result.request).toMatchObject({ status: "denied", decisionNote: "Ask Jordan first." });
    expect(audits(result.effects)[0]).toMatchObject({ action: "access.denied", details: { note: "Ask Jordan first." } });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "access_denied",
      title: "Alex Kim declined your request for Author access to Coral Offers.",
      body: "Ask Jordan first.",
      link: { to: "request-access" },
    });
  });

  it("keeps the note short", () => {
    expect(decideAccessRequest({ ...base, note: "x".repeat(501) })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.noteTooLong,
    });
  });
});

// ── Members ───────────────────────────────────────────────────

describe("changeRoles", () => {
  const team = coral();
  const jordan = team[1]!;
  const alex = team[0]!;
  const base = { membership: jordan, member: PEOPLE.jordan, team: CORAL, actor: PEOPLE.alex, now: at(0), teamMemberships: team };

  it("replaces the roles and tells the member", () => {
    const result = changeRoles({ ...base, roles: ["approver", "author"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({ kind: "update", membershipId: jordan.id, set: { roles: ["author", "approver"] } });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.role_changed",
      details: { userId: "jordan", from: ["approver"], to: ["author", "approver"] },
    });
    expect(notes(result.effects)[0]?.title).toBe("Alex Kim changed your roles on Coral Offers to Author & Approver.");
  });

  it("changes nothing when the roles are the same", () => {
    expect(changeRoles({ ...base, roles: ["approver"] })).toEqual({ ok: true, membership: null, effects: [] });
  });

  it("needs at least one role", () => {
    expect(changeRoles({ ...base, roles: [] })).toEqual({ ok: false, code: "no_roles", reason: "Pick at least one role." });
  });

  it("never your own", () => {
    expect(changeRoles({ ...base, membership: alex, member: PEOPLE.alex, roles: ["approver"] })).toEqual({
      ok: false,
      code: "own_access",
      reason: "You can't change your own access.",
    });
  });

  it("only on an active membership", () => {
    const lapsed = { ...jordan, status: "lapsed" as const };
    expect(changeRoles({ ...base, membership: lapsed, roles: ["author"] })).toEqual({
      ok: false,
      code: "membership_not_active",
      reason: "This member's access isn't active.",
    });
  });

  it("keeps at least one Team Admin", () => {
    const second = membership("jordan", ["team_admin", "approver"]);
    const withTwo = [alex, second];
    // Jordan (the other admin) acts on Alex: Alex may lose the role while Jordan keeps it...
    expect(
      changeRoles({ ...base, membership: alex, member: PEOPLE.alex, actor: PEOPLE.jordan, teamMemberships: withTwo, roles: ["approver"] })
        .ok,
    ).toBe(true);
    // ...but not when Alex is the only one.
    expect(
      changeRoles({ ...base, membership: alex, member: PEOPLE.alex, actor: PEOPLE.jordan, roles: ["approver"] }),
    ).toEqual({ ok: false, code: "last_admin", reason: "Coral Offers needs at least one Team Admin." });
  });
});

describe("removeMember", () => {
  const team = coral();
  const base = { member: PEOPLE.maya, team: CORAL, actor: PEOPLE.alex, now: at(0), teamMemberships: team };

  it("deletes the membership and tells the member", () => {
    const maya = team[2]!;
    const result = removeMember({ ...base, membership: maya });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({ kind: "delete", membershipId: maya.id });
    expect(audits(result.effects)[0]).toMatchObject({ action: "access.removed", details: { userId: "maya", roles: ["author"] } });
    expect(notes(result.effects)[0]).toMatchObject({
      title: "Alex Kim removed your access to Coral Offers.",
      link: { to: "request-access" },
    });
  });

  it("never yourself, never the last Team Admin", () => {
    expect(removeMember({ ...base, membership: team[0]!, member: PEOPLE.alex })).toEqual({
      ok: false,
      code: "own_access",
      reason: "You can't change your own access.",
    });
    expect(removeMember({ ...base, actor: PEOPLE.jordan, membership: team[0]!, member: PEOPLE.alex })).toEqual({
      ok: false,
      code: "last_admin",
      reason: "Coral Offers needs at least one Team Admin.",
    });
  });

  it("may remove a suspended member", () => {
    const devon = { ...team[4]!, status: "suspended" as const, statusReason: "inactivity" as const };
    expect(removeMember({ ...base, member: PEOPLE.devon, membership: devon }).ok).toBe(true);
  });
});

describe("suspendInactive and keepInactive", () => {
  const team = coral();
  const devon = team[4]!; // 95 days
  const base = { membership: devon, member: PEOPLE.devon, team: CORAL, actor: PEOPLE.alex, now: at(0), teamMemberships: team };

  it("suspends a flagged member, saying why", () => {
    const result = suspendInactive(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({
      kind: "update",
      membershipId: devon.id,
      set: { status: "suspended", statusReason: "inactivity", statusChangedAt: at(0) },
    });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.suspended",
      details: { reason: "inactivity", daysInactive: 95 },
    });
    expect(notes(result.effects)[0]?.title).toBe(
      "Alex Kim suspended your access to Coral Offers after 95 days without a sign-in.",
    );
  });

  it("refuses before 90 days, and allows it exactly at 90", () => {
    const fresh = membership("devon", ["viewer"], { lastActiveAt: at(0) });
    expect(suspendInactive({ ...base, membership: fresh, now: at(90, -1) })).toEqual({
      ok: false,
      code: "not_inactive",
      reason: "This member signed in within 90 days.",
    });
    expect(suspendInactive({ ...base, membership: fresh, now: at(90) }).ok).toBe(true);
    expect(keepInactive({ ...base, membership: fresh, now: at(90, -1) }).ok).toBe(false);
    expect(keepInactive({ ...base, membership: fresh, now: at(90) }).ok).toBe(true);
  });

  it("refuses an inactive membership and your own", () => {
    const suspended = { ...devon, status: "suspended" as const };
    expect(suspendInactive({ ...base, membership: suspended })).toEqual({ ok: false, ...ACCESS_REFUSALS.notActive });
    expect(keepInactive({ ...base, membership: suspended })).toEqual({ ok: false, ...ACCESS_REFUSALS.notActive });
    const alexIdle = { ...team[0]!, lastActiveAt: ago(100) };
    expect(suspendInactive({ ...base, membership: alexIdle, member: PEOPLE.alex })).toEqual({
      ok: false,
      code: "own_access",
      reason: "You can't change your own access.",
    });
  });

  it("Keep clears the flag and restarts the clock from now", () => {
    const result = keepInactive(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({
      kind: "update",
      membershipId: devon.id,
      set: { inactivityKeptAt: at(0), inactivityFlaggedAt: null },
    });
    expect(audits(result.effects)[0]).toMatchObject({ action: "access.kept", details: { daysInactive: 95 } });
    expect(notes(result.effects)).toEqual([]);

    const kept = { ...devon, inactivityKeptAt: at(0), inactivityFlaggedAt: null };
    // The sweep leaves Devon alone until 90 days after the Keep, and suspends at 120.
    expect(sweepAt(at(89), [kept]).membershipChanges).toEqual([]);
    expect(statusOf(sweepAt(at(90), [kept]), kept.id)).toEqual({ inactivityFlaggedAt: at(90) });
    expect(statusOf(sweepAt(at(120), [kept]), kept.id)).toMatchObject({ status: "suspended", statusChangedAt: at(120) });
  });
});

describe("reinstate", () => {
  const base = { member: PEOPLE.devon, team: CORAL, actor: PEOPLE.alex, now: at(30) };

  it("restores a suspended member with a fresh inactivity clock", () => {
    const suspended = membership("devon", ["viewer"], {
      lastActiveAt: ago(95),
      status: "suspended",
      statusReason: "inactivity_auto",
      statusChangedAt: at(25),
      inactivityFlaggedAt: ago(5),
    });
    const result = reinstate({ ...base, membership: suspended });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({
      kind: "update",
      membershipId: suspended.id,
      set: { status: "active", statusReason: null, statusChangedAt: at(30), inactivityFlaggedAt: null, inactivityKeptAt: at(30) },
    });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.reinstated",
      details: { from: "suspended", reason: "inactivity_auto", roles: ["viewer"] },
    });
    expect(notes(result.effects)[0]?.title).toBe("Alex Kim restored your access to Coral Offers.");

    // The next sweep doesn't suspend them straight back.
    const restored = { ...suspended, ...result.membership.kind === "update" ? result.membership.set : {} } as MembershipFacts;
    expect(sweepAt(at(31), [restored]).membershipChanges).toEqual([]);
  });

  it("refuses an active member and yourself", () => {
    expect(reinstate({ ...base, membership: membership("devon", ["viewer"]) })).toEqual({
      ok: false,
      code: "membership_already_active",
      reason: "This member's access is already active.",
    });
    const lapsed = membership("alex", ["approver"], { status: "lapsed" });
    expect(reinstate({ ...base, member: PEOPLE.alex, membership: lapsed })).toEqual({
      ok: false,
      code: "own_access",
      reason: "You can't change your own access.",
    });
  });
});

// ── Recertification: acting ───────────────────────────────────

describe("startRecert", () => {
  const base = { team: CORAL, actor: PEOPLE.alex, now: at(0), memberships: coral(), unfinished: [] as RecertFacts[] };

  it("starts now, due in 30 days, covering members other than Team Admins", () => {
    const result = startRecert(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recert).toMatchObject({ teamId: CORAL.id, startsAt: at(0), dueAt: at(30), label: "Q1 2027" });
    expect(result.recert.items.map((i) => i.userId)).toEqual(["devon", "jordan", "maya", "sam"]);
    expect(result.recert.items.every((i) => i.decision === null)).toBe(true);
    expect(audits(result.effects)[0]).toMatchObject({ action: "recert.started", details: { members: 4 } });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "recert_due",
      to: { kind: "team_admins", teamId: CORAL.id, exceptUserIds: ["alex"] },
      title: "Q1 2027 access review for Coral Offers is due March 3, 2027.",
      link: { to: "settings", teamId: CORAL.id, section: "recertification" },
    });
  });

  it("refuses while a review is open or upcoming, and allows it once closed", () => {
    expect(startRecert({ ...base, unfinished: [recert()] })).toEqual({ ok: false, code: "recert_open", reason: "A review is already open." });
    expect(startRecert({ ...base, unfinished: [recert({ startsAt: at(5), dueAt: at(35) })] }).ok).toBe(false);
    // Deadline reached but not swept yet: it counts as closed.
    expect(startRecert({ ...base, unfinished: [recert({ dueAt: at(0) })] }).ok).toBe(true);
  });

  it("refuses when there's nobody to review", () => {
    expect(startRecert({ ...base, memberships: [coral()[0]!] })).toEqual({ ok: false, code: "nobody_to_recertify", reason: "There's nobody to review." });
  });
});

describe("decideRecertItem", () => {
  const team = coral();
  const base = {
    recert: recert(),
    userId: "maya",
    member: PEOPLE.maya,
    team: CORAL,
    actor: PEOPLE.alex,
    decision: "keep" as const,
    now: at(0),
    teamMemberships: team,
  };

  it("keeps a member", () => {
    const result = decideRecertItem(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item).toEqual({ decision: "keep", decidedBy: "alex", decidedAt: at(0) });
    expect(result.membership).toBeNull();
    expect(result.completedAt).toBeNull();
    expect(audits(result.effects)).toEqual([
      expect.objectContaining({ action: "recert.kept", details: expect.objectContaining({ userId: "maya", label: "Q1 2027" }) }),
    ]);
  });

  it("removing ends the access at once and tells the member", () => {
    const result = decideRecertItem({ ...base, decision: "remove" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({ kind: "delete", membershipId: team[2]!.id });
    expect(audits(result.effects)[0]?.action).toBe("recert.removed");
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "access_removed",
      to: { kind: "user", userId: "maya" },
      title: "Your access to Coral Offers was removed in the Q1 2027 access review.",
    });
  });

  it("is open until one millisecond before the deadline, and closed at it", () => {
    expect(decideRecertItem({ ...base, now: at(30, -1) }).ok).toBe(true);
    expect(decideRecertItem({ ...base, now: at(30) })).toEqual({
      ok: false,
      code: "recert_closed",
      reason: "This review closed on March 3, 2027.",
    });
  });

  it("refuses before the review starts", () => {
    const later = recert({ startsAt: at(10), dueAt: at(40) });
    expect(decideRecertItem({ ...base, recert: later })).toEqual({
      ok: false,
      code: "recert_not_started",
      reason: "This review starts on February 11, 2027.",
    });
  });

  it("refuses yourself, outsiders, repeats and people already gone", () => {
    expect(decideRecertItem({ ...base, userId: "alex", member: PEOPLE.alex })).toEqual({
      ok: false,
      code: "own_access",
      reason: "You can't change your own access.",
    });
    expect(decideRecertItem({ ...base, userId: "morgan", member: PEOPLE.morgan })).toEqual({
      ok: false,
      code: "not_in_recert",
      reason: "This person isn't part of this review.",
    });
    const decided = recert();
    decided.items[1]!.decision = "keep";
    expect(decideRecertItem({ ...base, recert: decided })).toEqual({ ok: false, code: "already_recertified", reason: "This member was already reviewed." });
    expect(decideRecertItem({ ...base, teamMemberships: team.filter((m) => m.userId !== "maya") })).toEqual({
      ok: false,
      code: "no_longer_member",
      reason: "This person is no longer a member.",
    });
  });

  it("closes the review early once everyone is decided", () => {
    const almost = recert();
    for (const item of almost.items) if (item.userId !== "sam") item.decision = "keep";
    const result = decideRecertItem({ ...base, recert: almost, userId: "sam", member: PEOPLE.sam });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedAt).toEqual(at(0));
    expect(audits(result.effects).map((e) => e.action)).toEqual(["recert.kept", "recert.closed"]);
    expect(audits(result.effects)[1]?.details).toMatchObject({ kept: 4, removed: 0, lapsed: 0 });
  });

  it("closing early counts the last one removed", () => {
    const almost = recert();
    for (const item of almost.items) if (item.userId !== "sam") item.decision = "keep";
    const result = decideRecertItem({ ...base, recert: almost, userId: "sam", member: PEOPLE.sam, decision: "remove" });
    expect(result.ok && result.completedAt).toEqual(at(0));
    expect(result.ok && audits(result.effects)[1]?.details).toMatchObject({ kept: 3, removed: 1 });
  });
});

// ── The sweep ─────────────────────────────────────────────────

describe("sweepAccess: recertification deadline", () => {
  /** Alex kept everyone except Sam. */
  function scenario() {
    const memberships = coral().map((m) => (m.userId === "devon" ? { ...m, lastActiveAt: ago(1) } : m));
    const r = recert();
    for (const item of r.items) {
      if (item.userId !== "sam") Object.assign(item, { decision: "keep", decidedBy: "alex", decidedAt: at(1) });
    }
    return { memberships, recerts: [r] };
  }

  it("changes nothing one millisecond before the deadline", () => {
    const { memberships, recerts } = scenario();
    expect(sweepAt(at(30, -1), memberships, recerts)).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
  });

  it("lapses the unconfirmed member exactly at the deadline, and closes the review", () => {
    const { memberships, recerts } = scenario();
    const result = sweepAt(at(30), memberships, recerts);
    const sam = memberships.find((m) => m.userId === "sam")!;
    expect(result.membershipChanges).toEqual([
      {
        kind: "update",
        membershipId: sam.id,
        set: { status: "lapsed", statusReason: "recert_unconfirmed", statusChangedAt: at(30) },
      },
    ]);
    expect(result.recertsClosed).toEqual([{ id: "rc_1", completedAt: at(30) }]);
    expect(audits(result.effects).map((e) => [e.action, e.actorId, e.at?.getTime()])).toEqual([
      ["access.lapsed", null, at(30).getTime()],
      ["recert.closed", null, at(30).getTime()],
    ]);
    expect(audits(result.effects)[1]?.details).toMatchObject({ kept: 3, removed: 0, lapsed: 1 });
    expect(notes(result.effects).map((n) => [n.to, n.title])).toEqual([
      [{ kind: "user", userId: "sam" }, "Your access to Coral Offers lapsed: it wasn't recertified by March 3, 2027."],
      [
        { kind: "team_admins", teamId: CORAL.id, exceptUserIds: ["sam"] },
        "Sam Ortiz's access to Coral Offers lapsed: not recertified by March 3, 2027.",
      ],
    ]);
  });

  it("backdates to the deadline when the clock jumps well past it", () => {
    const { memberships, recerts } = scenario();
    const result = sweepAt(at(31, 1), memberships, recerts);
    expect(statusOf(result, memberships.find((m) => m.userId === "sam")!.id)?.statusChangedAt).toEqual(at(30));
    expect(result.effects.every((e) => e.at?.getTime() === at(30).getTime())).toBe(true);
  });

  it("is idempotent", () => {
    const { memberships, recerts } = scenario();
    const first = sweepAt(at(31), memberships, recerts);
    const next = apply(first, memberships, recerts);
    expect(sweepAt(at(31), next.memberships, next.recerts)).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
    expect(sweepAt(at(45), next.memberships, next.recerts).membershipChanges).toEqual([]);
  });

  it("leaves members who aren't active alone, and other teams' members", () => {
    const { memberships, recerts } = scenario();
    const withSuspendedSam = memberships.map((m) =>
      m.userId === "sam" ? { ...m, status: "suspended" as const, statusReason: "inactivity" as const } : m,
    );
    const depositsSam = membership("sam", ["viewer"], { id: "m_sam_deposits", teamId: DEPOSITS.id });
    const result = sweepAt(at(30), [...withSuspendedSam, depositsSam], recerts);
    expect(result.membershipChanges).toEqual([]);
    expect(result.recertsClosed).toHaveLength(1);
    expect(audits(result.effects)[0]?.details).toMatchObject({ lapsed: 0 });
  });

  it("ignores upcoming and completed reviews", () => {
    const { memberships } = scenario();
    const upcoming = recert({ id: "rc_up", startsAt: at(40), dueAt: at(70) });
    const done = recert({ id: "rc_done", completedAt: at(5), dueAt: at(10) });
    expect(sweepAt(at(31), memberships, [upcoming, done]).recertsClosed).toEqual([]);
  });

  it("someone added after the review started isn't part of it and doesn't lapse", () => {
    const { memberships, recerts } = scenario();
    const morgan = membership("morgan", ["author"], { addedAt: at(10), lastActiveAt: at(10) });
    const result = sweepAt(at(30), [...memberships, morgan], recerts);
    expect(statusOf(result, morgan.id)).toBeUndefined();
  });
});

describe("sweepAccess: inactivity", () => {
  const fresh = (lastActive: Date, extra: Partial<MembershipFacts> = {}) =>
    membership("devon", ["viewer"], { lastActiveAt: lastActive, ...extra });

  it("flags at exactly 90 days and tells the team's admins, not before", () => {
    const m = fresh(at(0));
    expect(sweepAt(at(90, -1), [m]).effects).toEqual([]);
    const result = sweepAt(at(90), [m]);
    expect(result.membershipChanges).toEqual([{ kind: "update", membershipId: m.id, set: { inactivityFlaggedAt: at(90) } }]);
    expect(audits(result.effects)[0]).toMatchObject({ action: "access.flagged_inactive", actorId: null, at: at(90) });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "inactivity_flagged",
      to: { kind: "team_admins", teamId: CORAL.id, exceptUserIds: ["devon"] },
      title: "Devon Lin hasn't signed in for 90 days.",
      body: "Access to Coral Offers is suspended automatically on June 1, 2027.",
      at: at(90),
    });
  });

  it("flags only once", () => {
    const m = fresh(at(0), { inactivityFlaggedAt: at(90) });
    expect(sweepAt(at(100), [m]).effects).toEqual([]);
  });

  it("suspends automatically at exactly 120 days, not one millisecond before", () => {
    const m = fresh(at(0), { inactivityFlaggedAt: at(90) });
    expect(sweepAt(at(120, -1), [m]).membershipChanges).toEqual([]);
    const result = sweepAt(at(120), [m]);
    expect(result.membershipChanges).toEqual([
      {
        kind: "update",
        membershipId: m.id,
        set: { status: "suspended", statusReason: "inactivity_auto", statusChangedAt: at(120) },
      },
    ]);
    expect(audits(result.effects)).toEqual([
      expect.objectContaining({
        action: "access.suspended",
        actorId: null,
        at: at(120),
        details: expect.objectContaining({ reason: "inactivity_auto", daysInactive: 120 }),
      }),
    ]);
    expect(notes(result.effects).map((n) => n.title)).toEqual([
      "Your access to Coral Offers was suspended after 120 days without a sign-in.",
      "Devon Lin's access to Coral Offers was suspended after 120 days without a sign-in.",
    ]);
  });

  it("a jump from 85 to 125 days records the flag at day 90 and the suspension at day 120, in order", () => {
    const m = fresh(ago(85));
    const result = sweepAt(at(40), [m]);
    expect(statusOf(result, m.id)).toEqual({
      inactivityFlaggedAt: at(5),
      status: "suspended",
      statusReason: "inactivity_auto",
      statusChangedAt: at(35),
    });
    expect(result.effects.map((e) => [e.kind === "audit" ? e.action : e.notification, e.at?.getTime()])).toEqual([
      ["access.flagged_inactive", at(5).getTime()],
      ["access.suspended", at(35).getTime()],
      ["access_suspended", at(35).getTime()],
      ["access_suspended", at(35).getTime()],
    ]);
    // No "flagged" notification: by now the member is suspended.
    expect(notes(result.effects).some((n) => n.notification === "inactivity_flagged")).toBe(false);
  });

  it("leaves suspended and lapsed memberships alone", () => {
    const suspended = fresh(ago(200), { status: "suspended", statusReason: "inactivity" });
    const lapsed = fresh(ago(200), { id: "m_x", status: "lapsed", statusReason: "recert_unconfirmed" });
    expect(sweepAt(at(0), [suspended, lapsed])).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
  });

  it("applies to Team Admins too, and never tells them about themselves", () => {
    const alex = membership("alex", ["team_admin", "approver"], { lastActiveAt: at(0) });
    const result = sweepAt(at(90), [alex]);
    expect(notes(result.effects)[0]?.to).toEqual({ kind: "team_admins", teamId: CORAL.id, exceptUserIds: ["alex"] });
  });
});

describe("sweepAccess: jumps across several boundaries", () => {
  it("the demo: Devon at 95 days is suspended on day 120; Sam lapses at the deadline; one review closes", () => {
    // Seed: recert due in 30 days; Devon flagged 5 days ago. Scenario 5 advances 15 days, scenario 8 another 16.
    const memberships = coral();
    const r = recert();
    for (const item of r.items) {
      if (item.userId === "jordan" || item.userId === "maya") item.decision = "keep";
    }
    // Alex also kept Devon, who never signs in again.
    r.items.find((i) => i.userId === "devon")!.decision = "keep";

    const afterScenario5 = sweepAt(at(15), memberships, [r]);
    expect(afterScenario5).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });

    const result = sweepAt(at(31), memberships, [r]);
    const id = (u: string) => memberships.find((m) => m.userId === u)!.id;
    expect(statusOf(result, id("devon"))).toEqual({
      status: "suspended",
      statusReason: "inactivity_auto",
      statusChangedAt: at(25),
    });
    expect(statusOf(result, id("sam"))).toEqual({
      status: "lapsed",
      statusReason: "recert_unconfirmed",
      statusChangedAt: at(30),
    });
    expect(statusOf(result, id("maya"))).toBeUndefined();
    expect(result.recertsClosed).toEqual([{ id: "rc_1", completedAt: at(30) }]);
    // Time order: Devon's suspension (day 25) before Sam's lapse and the close (day 30).
    expect(audits(result.effects).map((e) => e.action)).toEqual(["access.suspended", "access.lapsed", "recert.closed"]);
    expect(audits(result.effects)[2]?.details).toMatchObject({ kept: 3, lapsed: 1 });
  });

  it("an undecided member whose inactivity suspension comes first is suspended, not lapsed", () => {
    const memberships = coral(); // Devon: suspended on day 25
    const r = recert(); // everyone undecided, due day 30
    const result = sweepAt(at(31), memberships, [r]);
    const devon = memberships.find((m) => m.userId === "devon")!;
    expect(statusOf(result, devon.id)).toMatchObject({ status: "suspended", statusChangedAt: at(25) });
    expect(audits(result.effects).find((e) => e.action === "recert.closed")?.details).toMatchObject({ lapsed: 3 });
  });

  it("a lapse that comes first wins, and the later 90-day flag no longer applies", () => {
    const m = membership("sam", ["viewer"], { lastActiveAt: ago(60) }); // flag on day 30, suspend on day 60
    const r = recert({ users: ["sam"], dueAt: at(10) });
    const result = sweepAt(at(70), [m], [r]);
    expect(statusOf(result, m.id)).toEqual({ status: "lapsed", statusReason: "recert_unconfirmed", statusChangedAt: at(10) });
    expect(audits(result.effects).map((e) => e.action)).toEqual(["access.lapsed", "recert.closed"]);
  });

  it("when the deadline and day 120 fall on the same instant, the review wins", () => {
    const m = membership("sam", ["viewer"], { lastActiveAt: ago(90), inactivityFlaggedAt: ago(0) }); // day 120 = at(30)
    const r = recert({ users: ["sam"] }); // due at(30)
    const result = sweepAt(at(30), [m], [r]);
    expect(statusOf(result, m.id)).toMatchObject({ status: "lapsed", statusChangedAt: at(30) });
  });

  it("two reviews (two teams) close in deadline order", () => {
    const coralSam = membership("sam", ["viewer"]);
    const depositsMaya = membership("maya", ["author"], { id: "m_maya_dep", teamId: DEPOSITS.id });
    const a = recert({ id: "rc_a", users: ["sam"], dueAt: at(20) });
    const b = recert({ id: "rc_b", teamId: DEPOSITS.id, users: ["maya"], dueAt: at(10) });
    const result = sweepAt(at(25), [coralSam, depositsMaya], [a, b]);
    expect(result.recertsClosed.map((c) => c.id)).toEqual(["rc_b", "rc_a"]);
    expect(audits(result.effects).map((e) => [e.action, e.teamId])).toEqual([
      ["access.lapsed", DEPOSITS.id],
      ["recert.closed", DEPOSITS.id],
      ["access.lapsed", CORAL.id],
      ["recert.closed", CORAL.id],
    ]);
  });

  it("everything the sweep writes is idempotent across a long jump", () => {
    const memberships = [...coral(), membership("naomi", ["author"], { id: "m_n", teamId: DEPOSITS.id, lastActiveAt: ago(85) })];
    const recerts = [recert()];
    const first = sweepAt(at(200), memberships, recerts);
    expect(first.membershipChanges.length).toBeGreaterThan(0);
    const next = apply(first, memberships, recerts);
    expect(sweepAt(at(200), next.memberships, next.recerts)).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
  });
});

describe("sweepAccess: the last Team Admin", () => {
  const idleAdmin = (userId: string, lastActive: Date, extra: Partial<MembershipFacts> = {}) =>
    membership(userId, ["team_admin", "approver"], { lastActiveAt: lastActive, inactivityFlaggedAt: null, ...extra });

  it("keeps the team's only Team Admin at day 120, flags them, and tells the Platform Admins once", () => {
    const alex = idleAdmin("alex", at(0));
    const result = sweepAt(at(125), [alex]);
    // No suspension: still flagged, marked as held at day 120.
    expect(result.membershipChanges).toEqual([{ kind: "update", membershipId: alex.id, set: { inactivityFlaggedAt: at(120) } }]);
    expect(audits(result.effects).map((e) => [e.action, e.actorId, e.at?.getTime()])).toEqual([
      ["access.flagged_inactive", null, at(90).getTime()],
      ["access.kept_last_admin", null, at(120).getTime()],
    ]);
    expect(audits(result.effects)[1]?.details).toMatchObject({ userId: "alex", reason: "inactivity_auto", daysInactive: 120, teamName: "Coral Offers" });
    const held = notes(result.effects).find((n) => n.to.kind === "platform_admins");
    expect(held).toMatchObject({
      notification: "inactivity_flagged",
      link: { to: "platform", section: "teams" },
      title: "Alex Kim hasn't signed in for 120 days, but as the last Team Admin of Coral Offers their access stays on.",
      at: at(120),
    });

    const next = apply(result, [alex], []);
    expect(sweepAt(at(125), next.memberships)).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
    expect(sweepAt(at(400), next.memberships)).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
  });

  it("with two idle Team Admins, the first to reach day 120 is suspended and the last is kept", () => {
    const alex = idleAdmin("alex", at(0)); // day 120 = at(120)
    const priya = idleAdmin("priya", at(5)); // day 120 = at(125)
    const result = sweepAt(at(200), [alex, priya]);
    expect(statusOf(result, alex.id)).toMatchObject({ status: "suspended", statusChangedAt: at(120) });
    expect(statusOf(result, priya.id)).toEqual({ inactivityFlaggedAt: at(125) });
    expect(audits(result.effects).map((e) => e.action)).toEqual([
      "access.flagged_inactive",
      "access.flagged_inactive",
      "access.suspended",
      "access.kept_last_admin",
    ]);
  });

  it("another active Team Admin means no exception: the idle one is suspended as usual", () => {
    const alex = idleAdmin("alex", at(0));
    const priya = idleAdmin("priya", at(100));
    const result = sweepAt(at(121), [alex, priya]);
    expect(statusOf(result, alex.id)).toMatchObject({ status: "suspended", statusReason: "inactivity_auto" });
    expect(audits(result.effects).some((e) => e.action === "access.kept_last_admin")).toBe(false);
  });

  it("doesn't lapse a current Team Admin at a review's deadline; the review still closes", () => {
    // Promoted to Team Admin during the review, so still on its list, undecided.
    const sam = idleAdmin("sam", at(20));
    const r = recert({ users: ["sam"] });
    const result = sweepAt(at(31), [sam], [r]);
    expect(result.membershipChanges).toEqual([]);
    expect(result.recertsClosed).toEqual([{ id: "rc_1", completedAt: at(30) }]);
    expect(audits(result.effects).map((e) => e.action)).toEqual(["recert.closed"]);
    expect(audits(result.effects)[0]?.details).toMatchObject({ lapsed: 0 });
    expect(notes(result.effects)).toEqual([]);
    const next = apply(result, [sam], [r]);
    expect(sweepAt(at(31), next.memberships, next.recerts.filter((x) => x.completedAt === null))).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
  });

  it("a Team Admin promoted during a review doesn't lapse even when another Team Admin remains", () => {
    const alex = membership("alex", ["team_admin"]);
    const jordan = membership("jordan", ["approver", "team_admin"]);
    const r = recert({ users: ["jordan", "maya"] });
    const maya = membership("maya", ["author"]);
    const result = sweepAt(at(31), [alex, jordan, maya], [r]);
    expect(statusOf(result, jordan.id)).toBeUndefined();
    expect(statusOf(result, maya.id)).toMatchObject({ status: "lapsed", statusReason: "recert_unconfirmed" });
    expect(audits(result.effects).find((e) => e.action === "recert.closed")?.details).toMatchObject({ lapsed: 1 });
  });

  it("a held Team Admin who signs in again starts a fresh clock: flagged and held again later", () => {
    const alex = idleAdmin("alex", at(0), { inactivityFlaggedAt: at(120) }); // held at day 120
    const signedIn = { ...alex, lastActiveAt: at(130) };
    expect(sweepAt(at(150), [signedIn])).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
    const result = sweepAt(at(250), [signedIn]); // 120 days after the sign-in
    expect(audits(result.effects).map((e) => [e.action, e.at?.getTime()])).toEqual([
      ["access.flagged_inactive", at(220).getTime()],
      ["access.kept_last_admin", at(250).getTime()],
    ]);
  });
});

describe("sweepAccess: a flag from before the last sign-in", () => {
  it("doesn't count: 90 days after the sign-in the member is flagged again", () => {
    const devon = membership("devon", ["viewer"], { lastActiveAt: at(10), inactivityFlaggedAt: at(0) }); // flagged, then signed in
    expect(sweepAt(at(99), [devon]).effects).toEqual([]);
    const result = sweepAt(at(100), [devon]);
    expect(result.membershipChanges).toEqual([{ kind: "update", membershipId: devon.id, set: { inactivityFlaggedAt: at(100) } }]);
    expect(notes(result.effects).map((n) => n.notification)).toEqual(["inactivity_flagged"]);
  });
});

// ── What the Team settings sections say ──────────────────────────────────────

describe("the roles editor's line (describeRoleChange) and validateRoles", () => {
  const sam = PEOPLE.sam;
  it("says who the member will be, and holds Save while the roles are the ones they have", () => {
    expect(describeRoleChange({ member: sam, team: CORAL, from: ["viewer"], to: ["approver", "author"] })).toEqual({
      line: "Sam Ortiz will be Author & Approver on Coral Offers.",
      blocked: false,
    });
    expect(describeRoleChange({ member: sam, team: CORAL, from: ["author", "viewer"], to: ["viewer", "author"] })).toEqual({
      line: "Sam Ortiz will be Viewer & Author on Coral Offers.",
      blocked: true,
    });
  });

  it("with no role ticked, says they need one and blocks Save: the rule changeRoles refuses with", () => {
    expect(describeRoleChange({ member: sam, team: CORAL, from: ["viewer"], to: [] })).toEqual({
      line: "Sam needs at least one role on Coral Offers.",
      blocked: true,
    });
    expect(validateRoles([])).toBe(ACCESS_REFUSALS.pickRoles);
    expect(validateRoles(["viewer"])).toBeNull();
    const refused = changeRoles({
      membership: membership("sam", ["viewer"]),
      member: sam,
      team: CORAL,
      actor: PEOPLE.alex,
      now: at(0),
      teamMemberships: coral(),
      roles: [],
    });
    expect(refused).toEqual({ ok: false, ...validateRoles([]) });
  });

  it("firstName is the first word", () => {
    expect(firstName("Sam Ortiz")).toBe("Sam");
    expect(firstName("Cher")).toBe("Cher");
  });
});

describe("deciding a request: requestDecisionRefusal and validateDecisionNote", () => {
  it("nobody decides their own request, and a decided one stays decided", () => {
    expect(requestDecisionRefusal(request(), PEOPLE.alex)).toBeNull();
    expect(requestDecisionRefusal(request({ userId: "alex" }), PEOPLE.alex)).toBe(REASONS.ownRequest);
    expect(requestDecisionRefusal(request({ status: "approved" }), PEOPLE.alex)).toBe(ACCESS_REFUSALS.decided);
  });

  it("a denial needs a note; any note stays under the limit; decideAccessRequest refuses the same way", () => {
    expect(validateDecisionNote("deny", "  ")).toBe(ACCESS_REFUSALS.denyNote);
    expect(validateDecisionNote("deny", "Not this quarter.")).toBeNull();
    expect(validateDecisionNote("approve", null)).toBeNull();
    expect(validateDecisionNote("approve", "x".repeat(501))).toBe(ACCESS_REFUSALS.noteTooLong);
    const input = { request: request(), requester: PEOPLE.morgan, team: CORAL, actor: PEOPLE.alex, now: at(0), membership: null };
    expect(decideAccessRequest({ ...input, decision: "deny", note: " " })).toEqual({
      ok: false,
      ...validateDecisionNote("deny", " "),
    });
  });
});

describe("the strips' lines", () => {
  it("memberConsequences: Remove, Restore with their roles, Suspend, and Keep with the day they're flagged again", () => {
    const devon = membership("devon", ["viewer"], { activeDaysAgo: 95, inactivityFlaggedAt: ago(5) });
    expect(memberConsequences({ membership: devon, member: PEOPLE.devon, team: CORAL, now: at(0) })).toEqual({
      remove: "Devon Lin loses access to Coral Offers and drops off this list. They can ask for access again.",
      reinstate: "Devon signs in to Coral Offers again as Viewer. The inactivity count restarts today.",
      suspend: "Devon can't sign in to Coral Offers until you restore them.",
      // Keep restarts the clock now (Feb 1, 2027): flagged again 90 days later.
      keep: "Devon stays on Coral Offers. The count restarts today, so they're flagged again on May 2 if they still haven't signed in.",
    });
    // That day is the one keepInactive's fresh clock gives.
    const kept = keepInactive({ membership: devon, member: PEOPLE.devon, team: CORAL, actor: PEOPLE.alex, now: at(0) });
    if (!kept.ok || kept.membership.kind !== "update") throw new Error("expected a keep");
    expect(inactivity({ ...devon, ...kept.membership.set }, at(0)).flagAt).toEqual(at(90));
  });

  it("names the year when the next flag falls in another year", () => {
    const late = new Date(Date.UTC(2026, 10, 20, 12)); // Nov 20, 2026
    const devon = membership("devon", ["viewer"], { lastActiveAt: new Date(late.getTime() - 95 * DAY_MS) });
    expect(memberConsequences({ membership: devon, member: PEOPLE.devon, team: CORAL, now: late }).keep).toContain(
      "flagged again on Feb 18, 2027",
    );
  });

  it("requestConsequences: what approving and denying a request do", () => {
    expect(requestConsequences({ requester: PEOPLE.morgan, role: "author", team: CORAL })).toEqual({
      approve: "Morgan Lee gets Author access to Coral Offers and sees its Library the next time they open Stencil.",
      deny: "Morgan sees your note and can ask again.",
    });
  });

  it("startRecertConsequence: the deadline startRecert sets, 30 days out", () => {
    expect(recertDueAt(at(0))).toEqual(at(30));
    const started = startRecert({ team: CORAL, actor: PEOPLE.alex, now: at(0), memberships: coral(), unfinished: [] });
    if (!started.ok) throw new Error(started.reason);
    expect(started.recert.dueAt).toEqual(recertDueAt(at(0)));
    expect(startRecertConsequence(CORAL, at(0))).toBe(
      "Every member except Team Admins is asked to be kept or removed by Mar 3, 30 days from today. Anyone not confirmed by then loses access to Coral Offers.",
    );
    expect(recertRemoveConsequence(PEOPLE.sam, CORAL)).toBe("Sam Ortiz loses access to Coral Offers now, not at the deadline.");
  });
});

describe("a review as the Recertification section shows it", () => {
  const review = recert({ startsAt: ago(4), dueAt: at(30) });
  const footnote = (now: Date, opts: { lapsed?: { id: string; name: string }[]; completedAt?: Date | null } = {}) =>
    recertFootnote({ recert: { ...review, completedAt: opts.completedAt ?? null }, lapsed: opts.lapsed ?? [], team: CORAL, now });

  it("recertFootnote: the deadline while it runs; once closed, who lapsed, that it closed early, or nobody", () => {
    expect(footnote(at(0))).toBe("Anyone not confirmed by Mar 3 loses access to Coral Offers.");
    expect(footnote(at(31), { lapsed: [PEOPLE.maya, PEOPLE.sam] })).toBe("Access lapsed on Mar 3 for Maya Chen and Sam Ortiz.");
    expect(footnote(at(12), { completedAt: at(10) })).toBe("Closed on Feb 11: every member was decided.");
    expect(footnote(at(31))).toBe("Nobody lapsed.");
  });

  it("recertItemOutcome: a settled row reads its outcome; an undecided one in an open review has none", () => {
    type Status = "active" | "suspended" | "lapsed" | "removed";
    const outcome = (decision: "keep" | "remove" | null, decidedAt: Date | null, membership: Status, now = at(0)) =>
      recertItemOutcome({
        item: { decision, decidedAt },
        decidedBy: decision ? PEOPLE.alex : null,
        membership,
        recert: review,
        now,
      });
    expect(outcome(null, null, "active")).toBeNull();
    expect(outcome("keep", at(1), "active")).toBe("Kept · Alex Kim, Feb 2");
    expect(outcome("remove", at(1), "removed")).toBe("Removed · Feb 2");
    expect(outcome(null, null, "removed")).toBe("Removed");
    expect(outcome(null, null, "suspended")).toBe("Suspended for inactivity");
    expect(outcome(null, null, "lapsed", at(31))).toBe("Access lapsed Mar 3");
    expect(outcome(null, null, "active", at(31))).toBe("Not confirmed");
  });
});

describe("heldAsLastAdmin", () => {
  it("only an active member the sweep kept past day 120, by its record", () => {
    const alex = membership("alex", ["team_admin", "approver"], { lastActiveAt: at(0), inactivityFlaggedAt: null });
    const swept = sweepAt(at(125), [alex]).membershipChanges[0];
    if (!swept || swept.kind !== "update") throw new Error("expected the hold");
    const held = { ...alex, ...swept.set };
    expect(heldAsLastAdmin(held, at(125))).toBe(true);
    // Past day 120 with nothing recorded (no sweep yet): not held; the suspension is due.
    expect(heldAsLastAdmin(alex, at(125))).toBe(false);
    expect(heldAsLastAdmin({ ...held, status: "suspended" }, at(125))).toBe(false);
    // A sign-in starts a fresh clock.
    expect(heldAsLastAdmin({ ...held, lastActiveAt: at(124) }, at(125))).toBe(false);
  });
});
