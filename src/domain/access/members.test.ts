import { describe, expect, it } from "vitest";
import { ACCESS_REFUSALS } from "./refusals";
import {
  changeRoles,
  keepInactive,
  reinstate,
  removeMember,
  suspendInactive,
} from "./members";
import type {
  AccessNotificationEffect,
  MembershipFacts,
} from "../access-types";
import { describeNotification } from "../notifications";
import {
  at,
  ago,
  CORAL,
  PEOPLE,
  membership,
  coral,
  audits,
  notes,
  sweepAt,
  statusOf,
} from "./fixtures";

/** A notification effect as the person reading it sees it (`describeNotification`). */
const words = (
  effect: AccessNotificationEffect | undefined,
  readerId: string,
) =>
  effect
    ? describeNotification(effect.notification, effect.facts, readerId)
    : null;

describe("changeRoles", () => {
  const team = coral();
  const jordan = team[1]!;
  const alex = team[0]!;
  const base = {
    membership: jordan,
    member: PEOPLE.jordan,
    team: CORAL,
    actor: PEOPLE.alex,
    now: at(0),
    teamMemberships: team,
  };

  it("replaces the roles and tells the member", () => {
    const result = changeRoles({ ...base, roles: ["approver", "author"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({
      kind: "update",
      membershipId: jordan.id,
      set: { roles: ["author", "approver"] },
    });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.role_changed",
      details: {
        userId: "jordan",
        from: ["approver"],
        to: ["author", "approver"],
      },
    });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "roles_changed",
      to: { kind: "user", userId: "jordan" },
      facts: {
        actorName: "Alex Kim",
        teamName: "Coral Offers",
        roles: ["author", "approver"],
      },
    });
    expect(words(notes(result.effects)[0], "jordan")?.title).toBe(
      "Alex Kim changed your roles on Coral Offers to Author & Approver.",
    );
  });

  it("changes nothing when the roles are the same", () => {
    expect(changeRoles({ ...base, roles: ["approver"] })).toEqual({
      ok: true,
      membership: null,
      effects: [],
    });
  });

  it("needs at least one role", () => {
    expect(changeRoles({ ...base, roles: [] })).toEqual({
      ok: false,
      code: "no_roles",
      reason: "Pick at least one role.",
    });
  });

  it("never your own", () => {
    expect(
      changeRoles({
        ...base,
        membership: alex,
        member: PEOPLE.alex,
        roles: ["approver"],
      }),
    ).toEqual({
      ok: false,
      code: "own_access",
      reason: "You can't change your own access.",
    });
  });

  it("only on an active membership", () => {
    const lapsed = { ...jordan, status: "lapsed" as const };
    expect(
      changeRoles({ ...base, membership: lapsed, roles: ["author"] }),
    ).toEqual({
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
      changeRoles({
        ...base,
        membership: alex,
        member: PEOPLE.alex,
        actor: PEOPLE.jordan,
        teamMemberships: withTwo,
        roles: ["approver"],
      }).ok,
    ).toBe(true);
    // ...but not when Alex is the only one.
    expect(
      changeRoles({
        ...base,
        membership: alex,
        member: PEOPLE.alex,
        actor: PEOPLE.jordan,
        roles: ["approver"],
      }),
    ).toEqual({
      ok: false,
      code: "last_admin",
      reason: "Coral Offers needs at least one Team Admin.",
    });
  });
});

describe("removeMember", () => {
  const team = coral();
  const base = {
    member: PEOPLE.maya,
    team: CORAL,
    actor: PEOPLE.alex,
    now: at(0),
    teamMemberships: team,
  };

  it("deletes the membership and tells the member", () => {
    const maya = team[2]!;
    const result = removeMember({ ...base, membership: maya });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({
      kind: "delete",
      membershipId: maya.id,
    });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.removed",
      details: { userId: "maya", roles: ["author"] },
    });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "access_removed",
      facts: { actorName: "Alex Kim", teamName: "Coral Offers" },
      link: { to: "request-access" },
    });
    expect(words(notes(result.effects)[0], "maya")?.title).toBe(
      "Alex Kim removed your access to Coral Offers.",
    );
  });

  it("never yourself, never the last Team Admin", () => {
    expect(
      removeMember({ ...base, membership: team[0]!, member: PEOPLE.alex }),
    ).toEqual({
      ok: false,
      code: "own_access",
      reason: "You can't change your own access.",
    });
    expect(
      removeMember({
        ...base,
        actor: PEOPLE.jordan,
        membership: team[0]!,
        member: PEOPLE.alex,
      }),
    ).toEqual({
      ok: false,
      code: "last_admin",
      reason: "Coral Offers needs at least one Team Admin.",
    });
  });

  it("may remove a suspended member", () => {
    const devon = {
      ...team[4]!,
      status: "suspended" as const,
      statusReason: "inactivity" as const,
    };
    expect(
      removeMember({ ...base, member: PEOPLE.devon, membership: devon }).ok,
    ).toBe(true);
  });
});

describe("suspendInactive and keepInactive", () => {
  const team = coral();
  const devon = team[4]!; // 95 days
  const base = {
    membership: devon,
    member: PEOPLE.devon,
    team: CORAL,
    actor: PEOPLE.alex,
    now: at(0),
    teamMemberships: team,
  };

  it("suspends a flagged member, saying why", () => {
    const result = suspendInactive(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({
      kind: "update",
      membershipId: devon.id,
      set: {
        status: "suspended",
        statusReason: "inactivity",
        statusChangedAt: at(0),
      },
    });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.suspended",
      details: { reason: "inactivity", daysInactive: 95 },
    });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "access_suspended",
      to: { kind: "user", userId: "devon" },
      facts: {
        userId: "devon",
        userName: "Devon Lin",
        teamName: "Coral Offers",
        daysInactive: 95,
        actorName: "Alex Kim",
      },
    });
    // Worded for the reader: the member hears "your", anyone else reads the member's name.
    expect(words(notes(result.effects)[0], "devon")?.title).toBe(
      "Alex Kim suspended your access to Coral Offers after 95 days without a sign-in.",
    );
    expect(words(notes(result.effects)[0], "jordan")?.title).toBe(
      "Alex Kim suspended Devon Lin's access to Coral Offers after 95 days without a sign-in.",
    );
  });

  it("refuses before 90 days, and allows it exactly at 90", () => {
    const fresh = membership("devon", ["viewer"], { lastActiveAt: at(0) });
    expect(
      suspendInactive({ ...base, membership: fresh, now: at(90, -1) }),
    ).toEqual({
      ok: false,
      code: "not_inactive",
      reason: "This member signed in within 90 days.",
    });
    expect(
      suspendInactive({ ...base, membership: fresh, now: at(90) }).ok,
    ).toBe(true);
    expect(
      keepInactive({ ...base, membership: fresh, now: at(90, -1) }).ok,
    ).toBe(false);
    expect(keepInactive({ ...base, membership: fresh, now: at(90) }).ok).toBe(
      true,
    );
  });

  it("refuses an inactive membership and your own", () => {
    const suspended = { ...devon, status: "suspended" as const };
    expect(suspendInactive({ ...base, membership: suspended })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.notActive,
    });
    expect(keepInactive({ ...base, membership: suspended })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.notActive,
    });
    const alexIdle = { ...team[0]!, lastActiveAt: ago(100) };
    expect(
      suspendInactive({ ...base, membership: alexIdle, member: PEOPLE.alex }),
    ).toEqual({
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
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.kept",
      details: { daysInactive: 95 },
    });
    expect(notes(result.effects)).toEqual([]);

    const kept = {
      ...devon,
      inactivityKeptAt: at(0),
      inactivityFlaggedAt: null,
    };
    // The sweep leaves Devon alone until 90 days after the Keep, and suspends at 120.
    expect(sweepAt(at(89), [kept]).membershipChanges).toEqual([]);
    expect(statusOf(sweepAt(at(90), [kept]), kept.id)).toEqual({
      inactivityFlaggedAt: at(90),
    });
    expect(statusOf(sweepAt(at(120), [kept]), kept.id)).toMatchObject({
      status: "suspended",
      statusChangedAt: at(120),
    });
  });
});

describe("reinstate", () => {
  const base = {
    member: PEOPLE.devon,
    team: CORAL,
    actor: PEOPLE.alex,
    now: at(30),
  };

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
      set: {
        status: "active",
        statusReason: null,
        statusChangedAt: at(30),
        inactivityFlaggedAt: null,
        inactivityKeptAt: at(30),
      },
    });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.reinstated",
      details: {
        from: "suspended",
        reason: "inactivity_auto",
        roles: ["viewer"],
      },
    });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "access_granted",
      facts: { actorName: "Alex Kim", teamName: "Coral Offers" },
    });
    expect(notes(result.effects)[0]?.facts).not.toHaveProperty("role");
    expect(words(notes(result.effects)[0], "devon")?.title).toBe(
      "Alex Kim restored your access to Coral Offers.",
    );

    // The next sweep doesn't suspend them straight back.
    const restored = {
      ...suspended,
      ...(result.membership.kind === "update" ? result.membership.set : {}),
    } as MembershipFacts;
    expect(sweepAt(at(31), [restored]).membershipChanges).toEqual([]);
  });

  it("refuses an active member and yourself", () => {
    expect(
      reinstate({ ...base, membership: membership("devon", ["viewer"]) }),
    ).toEqual({
      ok: false,
      code: "membership_already_active",
      reason: "This member's access is already active.",
    });
    const lapsed = membership("alex", ["approver"], { status: "lapsed" });
    expect(
      reinstate({ ...base, member: PEOPLE.alex, membership: lapsed }),
    ).toEqual({
      ok: false,
      code: "own_access",
      reason: "You can't change your own access.",
    });
  });
});
