import { describe, expect, it } from "vitest";
import type {
  AccessNotificationEffect,
  MembershipFacts,
  RecertFacts,
  SweepResult,
} from "../access-types";
import { describeNotification } from "../notifications";
import {
  at,
  ago,
  CORAL,
  DEPOSITS,
  membership,
  recert,
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

/** What the server does with a sweep: write the changes back. */
function apply(
  result: SweepResult,
  memberships: MembershipFacts[],
  recerts: RecertFacts[],
) {
  const nextMemberships = memberships.map((m) => {
    const change = result.membershipChanges.find(
      (c) => c.kind === "update" && c.membershipId === m.id,
    );
    return change?.kind === "update" ? { ...m, ...change.set } : m;
  });
  const nextRecerts = recerts.map((r) => {
    const closed = result.recertsClosed.find((c) => c.id === r.id);
    return closed ? { ...r, completedAt: closed.completedAt } : r;
  });
  return { memberships: nextMemberships, recerts: nextRecerts };
}

describe("sweepAccess: recertification deadline", () => {
  /** Alex kept everyone except Sam. */
  function scenario() {
    const memberships = coral().map((m) =>
      m.userId === "devon" ? { ...m, lastActiveAt: ago(1) } : m,
    );
    const r = recert();
    for (const item of r.items) {
      if (item.userId !== "sam")
        Object.assign(item, {
          decision: "keep",
          decidedBy: "alex",
          decidedAt: at(1),
        });
    }
    return { memberships, recerts: [r] };
  }

  it("changes nothing one millisecond before the deadline", () => {
    const { memberships, recerts } = scenario();
    expect(sweepAt(at(30, -1), memberships, recerts)).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
  });

  it("lapses the unconfirmed member exactly at the deadline, and closes the review", () => {
    const { memberships, recerts } = scenario();
    const result = sweepAt(at(30), memberships, recerts);
    const sam = memberships.find((m) => m.userId === "sam")!;
    expect(result.membershipChanges).toEqual([
      {
        kind: "update",
        membershipId: sam.id,
        set: {
          status: "lapsed",
          statusReason: "recert_unconfirmed",
          statusChangedAt: at(30),
        },
      },
    ]);
    expect(result.recertsClosed).toEqual([{ id: "rc_1", completedAt: at(30) }]);
    expect(
      audits(result.effects).map((e) => [e.action, e.actorId, e.at?.getTime()]),
    ).toEqual([
      ["access.lapsed", null, at(30).getTime()],
      ["recert.closed", null, at(30).getTime()],
    ]);
    expect(audits(result.effects)[1]?.details).toMatchObject({
      kept: 3,
      removed: 0,
      lapsed: 1,
    });
    // One set of facts for both: the member's own sentence and the admins' are worded when each reads it.
    const lapsed = {
      userId: "sam",
      userName: "Sam Ortiz",
      teamName: "Coral Offers",
      dueAt: at(30).toISOString(),
    };
    expect(notes(result.effects).map((n) => [n.to, n.facts])).toEqual([
      [{ kind: "user", userId: "sam" }, lapsed],
      [
        { kind: "team_admins", teamId: CORAL.id, exceptUserIds: ["sam"] },
        lapsed,
      ],
    ]);
    expect(
      notes(result.effects).map((n, i) => words(n, i === 0 ? "sam" : "alex")),
    ).toEqual([
      {
        title:
          "Your access to Coral Offers lapsed: it wasn't recertified by March 3, 2027.",
        body: null,
      },
      {
        title:
          "Sam Ortiz's access to Coral Offers lapsed: not recertified by March 3, 2027.",
        body: null,
      },
    ]);
  });

  it("backdates to the deadline when the clock jumps well past it", () => {
    const { memberships, recerts } = scenario();
    const result = sweepAt(at(31, 1), memberships, recerts);
    expect(
      statusOf(result, memberships.find((m) => m.userId === "sam")!.id)
        ?.statusChangedAt,
    ).toEqual(at(30));
    expect(
      result.effects.every((e) => e.at?.getTime() === at(30).getTime()),
    ).toBe(true);
  });

  it("is idempotent", () => {
    const { memberships, recerts } = scenario();
    const first = sweepAt(at(31), memberships, recerts);
    const next = apply(first, memberships, recerts);
    expect(sweepAt(at(31), next.memberships, next.recerts)).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
    expect(
      sweepAt(at(45), next.memberships, next.recerts).membershipChanges,
    ).toEqual([]);
  });

  it("leaves members who aren't active alone, and other teams' members", () => {
    const { memberships, recerts } = scenario();
    const withSuspendedSam = memberships.map((m) =>
      m.userId === "sam"
        ? {
            ...m,
            status: "suspended" as const,
            statusReason: "inactivity" as const,
          }
        : m,
    );
    const depositsSam = membership("sam", ["viewer"], {
      id: "m_sam_deposits",
      teamId: DEPOSITS.id,
    });
    const result = sweepAt(at(30), [...withSuspendedSam, depositsSam], recerts);
    expect(result.membershipChanges).toEqual([]);
    expect(result.recertsClosed).toHaveLength(1);
    expect(audits(result.effects)[0]?.details).toMatchObject({ lapsed: 0 });
  });

  it("ignores upcoming and completed reviews", () => {
    const { memberships } = scenario();
    const upcoming = recert({ id: "rc_up", startsAt: at(40), dueAt: at(70) });
    const done = recert({ id: "rc_done", completedAt: at(5), dueAt: at(10) });
    expect(
      sweepAt(at(31), memberships, [upcoming, done]).recertsClosed,
    ).toEqual([]);
  });

  it("someone added after the review started isn't part of it and doesn't lapse", () => {
    const { memberships, recerts } = scenario();
    const morgan = membership("morgan", ["author"], {
      addedAt: at(10),
      lastActiveAt: at(10),
    });
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
    expect(result.membershipChanges).toEqual([
      {
        kind: "update",
        membershipId: m.id,
        set: { inactivityFlaggedAt: at(90) },
      },
    ]);
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.flagged_inactive",
      actorId: null,
      at: at(90),
    });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "inactivity_flagged",
      to: { kind: "team_admins", teamId: CORAL.id, exceptUserIds: ["devon"] },
      facts: {
        userId: "devon",
        userName: "Devon Lin",
        teamName: "Coral Offers",
        suspendsAt: at(120).toISOString(),
      },
      at: at(90),
    });
    expect(notes(result.effects)[0]).not.toHaveProperty("body");
    expect(words(notes(result.effects)[0], "alex")).toEqual({
      title: "Devon Lin hasn't signed in for 90 days.",
      body: "Access to Coral Offers is suspended automatically on June 1, 2027.",
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
        set: {
          status: "suspended",
          statusReason: "inactivity_auto",
          statusChangedAt: at(120),
        },
      },
    ]);
    expect(audits(result.effects)).toEqual([
      expect.objectContaining({
        action: "access.suspended",
        actorId: null,
        at: at(120),
        details: expect.objectContaining({
          reason: "inactivity_auto",
          daysInactive: 120,
        }),
      }),
    ]);
    const suspended = {
      userId: "devon",
      userName: "Devon Lin",
      teamName: "Coral Offers",
      daysInactive: 120,
      actorName: null,
    };
    expect(notes(result.effects).map((n) => n.facts)).toEqual([
      suspended,
      suspended,
    ]);
    // The same facts read "Your access…" to the member and "Devon Lin's access…" to the admins.
    expect(
      notes(result.effects).map(
        (n, i) => words(n, i === 0 ? "devon" : "alex")?.title,
      ),
    ).toEqual([
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
    expect(
      result.effects.map((e) => [
        e.kind === "audit" ? e.action : e.notification,
        e.at?.getTime(),
      ]),
    ).toEqual([
      ["access.flagged_inactive", at(5).getTime()],
      ["access.suspended", at(35).getTime()],
      ["access_suspended", at(35).getTime()],
      ["access_suspended", at(35).getTime()],
    ]);
    // No "flagged" notification: by now the member is suspended.
    expect(
      notes(result.effects).some(
        (n) => n.notification === "inactivity_flagged",
      ),
    ).toBe(false);
  });

  it("leaves suspended and lapsed memberships alone", () => {
    const suspended = fresh(ago(200), {
      status: "suspended",
      statusReason: "inactivity",
    });
    const lapsed = fresh(ago(200), {
      id: "m_x",
      status: "lapsed",
      statusReason: "recert_unconfirmed",
    });
    expect(sweepAt(at(0), [suspended, lapsed])).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
  });

  it("applies to Team Admins too, and never tells them about themselves", () => {
    const alex = membership("alex", ["team_admin", "approver"], {
      lastActiveAt: at(0),
    });
    const result = sweepAt(at(90), [alex]);
    expect(notes(result.effects)[0]?.to).toEqual({
      kind: "team_admins",
      teamId: CORAL.id,
      exceptUserIds: ["alex"],
    });
  });
});

describe("sweepAccess: jumps across several boundaries", () => {
  it("the demo: Devon at 95 days is suspended on day 120; Sam lapses at the deadline; one review closes", () => {
    // Seed: recert due in 30 days; Devon flagged 5 days ago. Scenario 5 advances 15 days, scenario 8 another 16.
    const memberships = coral();
    const r = recert();
    for (const item of r.items) {
      if (item.userId === "jordan" || item.userId === "maya")
        item.decision = "keep";
    }
    // Alex also kept Devon, who never signs in again.
    r.items.find((i) => i.userId === "devon")!.decision = "keep";

    const afterScenario5 = sweepAt(at(15), memberships, [r]);
    expect(afterScenario5).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });

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
    expect(audits(result.effects).map((e) => e.action)).toEqual([
      "access.suspended",
      "access.lapsed",
      "recert.closed",
    ]);
    expect(audits(result.effects)[2]?.details).toMatchObject({
      kept: 3,
      lapsed: 1,
    });
  });

  it("an undecided member whose inactivity suspension comes first is suspended, not lapsed", () => {
    const memberships = coral(); // Devon: suspended on day 25
    const r = recert(); // everyone undecided, due day 30
    const result = sweepAt(at(31), memberships, [r]);
    const devon = memberships.find((m) => m.userId === "devon")!;
    expect(statusOf(result, devon.id)).toMatchObject({
      status: "suspended",
      statusChangedAt: at(25),
    });
    expect(
      audits(result.effects).find((e) => e.action === "recert.closed")?.details,
    ).toMatchObject({ lapsed: 3 });
  });

  it("a lapse that comes first wins, and the later 90-day flag no longer applies", () => {
    const m = membership("sam", ["viewer"], { lastActiveAt: ago(60) }); // flag on day 30, suspend on day 60
    const r = recert({ users: ["sam"], dueAt: at(10) });
    const result = sweepAt(at(70), [m], [r]);
    expect(statusOf(result, m.id)).toEqual({
      status: "lapsed",
      statusReason: "recert_unconfirmed",
      statusChangedAt: at(10),
    });
    expect(audits(result.effects).map((e) => e.action)).toEqual([
      "access.lapsed",
      "recert.closed",
    ]);
  });

  it("when the deadline and day 120 fall on the same instant, the review wins", () => {
    const m = membership("sam", ["viewer"], {
      lastActiveAt: ago(90),
      inactivityFlaggedAt: ago(0),
    }); // day 120 = at(30)
    const r = recert({ users: ["sam"] }); // due at(30)
    const result = sweepAt(at(30), [m], [r]);
    expect(statusOf(result, m.id)).toMatchObject({
      status: "lapsed",
      statusChangedAt: at(30),
    });
  });

  it("two reviews (two teams) close in deadline order", () => {
    const coralSam = membership("sam", ["viewer"]);
    const depositsMaya = membership("maya", ["author"], {
      id: "m_maya_dep",
      teamId: DEPOSITS.id,
    });
    const a = recert({ id: "rc_a", users: ["sam"], dueAt: at(20) });
    const b = recert({
      id: "rc_b",
      teamId: DEPOSITS.id,
      users: ["maya"],
      dueAt: at(10),
    });
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
    const memberships = [
      ...coral(),
      membership("naomi", ["author"], {
        id: "m_n",
        teamId: DEPOSITS.id,
        lastActiveAt: ago(85),
      }),
    ];
    const recerts = [recert()];
    const first = sweepAt(at(200), memberships, recerts);
    expect(first.membershipChanges.length).toBeGreaterThan(0);
    const next = apply(first, memberships, recerts);
    expect(sweepAt(at(200), next.memberships, next.recerts)).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
  });
});

describe("sweepAccess: the last Team Admin", () => {
  const idleAdmin = (
    userId: string,
    lastActive: Date,
    extra: Partial<MembershipFacts> = {},
  ) =>
    membership(userId, ["team_admin", "approver"], {
      lastActiveAt: lastActive,
      inactivityFlaggedAt: null,
      ...extra,
    });

  it("keeps the team's only Team Admin at day 120, flags them, and tells the Platform Admins once", () => {
    const alex = idleAdmin("alex", at(0));
    const result = sweepAt(at(125), [alex]);
    // No suspension: still flagged, marked as held at day 120.
    expect(result.membershipChanges).toEqual([
      {
        kind: "update",
        membershipId: alex.id,
        set: { inactivityFlaggedAt: at(120) },
      },
    ]);
    expect(
      audits(result.effects).map((e) => [e.action, e.actorId, e.at?.getTime()]),
    ).toEqual([
      ["access.flagged_inactive", null, at(90).getTime()],
      ["access.kept_last_admin", null, at(120).getTime()],
    ]);
    expect(audits(result.effects)[1]?.details).toMatchObject({
      userId: "alex",
      reason: "inactivity_auto",
      daysInactive: 120,
      teamName: "Coral Offers",
    });
    const held = notes(result.effects).find(
      (n) => n.to.kind === "platform_admins",
    );
    expect(held).toMatchObject({
      notification: "inactivity_flagged",
      link: { to: "platform", section: "teams" },
      facts: {
        userId: "alex",
        userName: "Alex Kim",
        teamName: "Coral Offers",
        keptLastAdmin: true,
        daysInactive: 120,
      },
      at: at(120),
    });
    expect(words(held, "taylor")?.title).toBe(
      "Alex Kim hasn't signed in for 120 days, but as the last Team Admin of Coral Offers their access stays on.",
    );

    const next = apply(result, [alex], []);
    expect(sweepAt(at(125), next.memberships)).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
    expect(sweepAt(at(400), next.memberships)).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
  });

  it("with two idle Team Admins, the first to reach day 120 is suspended and the last is kept", () => {
    const alex = idleAdmin("alex", at(0)); // day 120 = at(120)
    const priya = idleAdmin("priya", at(5)); // day 120 = at(125)
    const result = sweepAt(at(200), [alex, priya]);
    expect(statusOf(result, alex.id)).toMatchObject({
      status: "suspended",
      statusChangedAt: at(120),
    });
    expect(statusOf(result, priya.id)).toEqual({
      inactivityFlaggedAt: at(125),
    });
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
    expect(statusOf(result, alex.id)).toMatchObject({
      status: "suspended",
      statusReason: "inactivity_auto",
    });
    expect(
      audits(result.effects).some((e) => e.action === "access.kept_last_admin"),
    ).toBe(false);
  });

  it("doesn't lapse a current Team Admin at a review's deadline; the review still closes", () => {
    // Promoted to Team Admin during the review, so still on its list, undecided.
    const sam = idleAdmin("sam", at(20));
    const r = recert({ users: ["sam"] });
    const result = sweepAt(at(31), [sam], [r]);
    expect(result.membershipChanges).toEqual([]);
    expect(result.recertsClosed).toEqual([{ id: "rc_1", completedAt: at(30) }]);
    expect(audits(result.effects).map((e) => e.action)).toEqual([
      "recert.closed",
    ]);
    expect(audits(result.effects)[0]?.details).toMatchObject({ lapsed: 0 });
    expect(notes(result.effects)).toEqual([]);
    const next = apply(result, [sam], [r]);
    expect(
      sweepAt(
        at(31),
        next.memberships,
        next.recerts.filter((x) => x.completedAt === null),
      ),
    ).toEqual({
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
    expect(statusOf(result, maya.id)).toMatchObject({
      status: "lapsed",
      statusReason: "recert_unconfirmed",
    });
    expect(
      audits(result.effects).find((e) => e.action === "recert.closed")?.details,
    ).toMatchObject({ lapsed: 1 });
  });

  it("a held Team Admin who signs in again starts a fresh clock: flagged and held again later", () => {
    const alex = idleAdmin("alex", at(0), { inactivityFlaggedAt: at(120) }); // held at day 120
    const signedIn = { ...alex, lastActiveAt: at(130) };
    expect(sweepAt(at(150), [signedIn])).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
    const result = sweepAt(at(250), [signedIn]); // 120 days after the sign-in
    expect(
      audits(result.effects).map((e) => [e.action, e.at?.getTime()]),
    ).toEqual([
      ["access.flagged_inactive", at(220).getTime()],
      ["access.kept_last_admin", at(250).getTime()],
    ]);
  });
});

describe("sweepAccess: a flag from before the last sign-in", () => {
  it("doesn't count: 90 days after the sign-in the member is flagged again", () => {
    const devon = membership("devon", ["viewer"], {
      lastActiveAt: at(10),
      inactivityFlaggedAt: at(0),
    }); // flagged, then signed in
    expect(sweepAt(at(99), [devon]).effects).toEqual([]);
    const result = sweepAt(at(100), [devon]);
    expect(result.membershipChanges).toEqual([
      {
        kind: "update",
        membershipId: devon.id,
        set: { inactivityFlaggedAt: at(100) },
      },
    ]);
    expect(notes(result.effects).map((n) => n.notification)).toEqual([
      "inactivity_flagged",
    ]);
  });
});
