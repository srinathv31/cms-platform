import { describe, expect, it } from "vitest";
import {
  decideRecertItem,
  quarterLabel,
  currentRecert,
  recertPhase,
  recertProgress,
  recertSubjects,
  startRecert,
} from "./recertification";
import type { AccessNotificationEffect, RecertFacts } from "../access-types";
import { describeNotification } from "../notifications";
import {
  at,
  CORAL,
  DEPOSITS,
  PEOPLE,
  membership,
  recert,
  coral,
  audits,
  notes,
} from "./fixtures";

/** A notification effect as the person reading it sees it (`describeNotification`). */
const words = (
  effect: AccessNotificationEffect | undefined,
  readerId: string,
) =>
  effect
    ? describeNotification(effect.notification, effect.facts, readerId)
    : null;

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
      membership("morgan", ["viewer"], {
        status: "lapsed",
        statusReason: "recert_unconfirmed",
      }),
    ];
    expect(recertSubjects(list, CORAL.id)).toEqual([
      "devon",
      "jordan",
      "maya",
      "sam",
    ]);
  });

  it("counts decided items: 4 of 6", () => {
    const r = recert({ users: ["a", "b", "c", "d", "e", "f"] });
    r.items[0]!.decision = "keep";
    r.items[1]!.decision = "keep";
    r.items[2]!.decision = "keep";
    r.items[3]!.decision = "remove";
    const members = ["a", "b", "c", "e", "f"].map((u) =>
      membership(u, ["viewer"]),
    );
    expect(recertProgress(r, members)).toEqual({
      total: 6,
      decided: 4,
      kept: 3,
      removed: 1,
      pending: 2,
    });
  });

  it("counts someone removed on the Members page as removed", () => {
    const r = recert({ users: ["jordan", "maya"] });
    const progress = recertProgress(r, [membership("jordan", ["approver"])]);
    expect(progress).toMatchObject({ decided: 1, removed: 1, pending: 1 });
  });

  it("shows the open review, else the upcoming one, else the latest closed", () => {
    const closed = recert({
      id: "rc_old",
      startsAt: at(-120),
      dueAt: at(-90),
      completedAt: at(-90),
    });
    const lastClosed = recert({
      id: "rc_last",
      startsAt: at(-60),
      dueAt: at(-30),
      completedAt: at(-30),
    });
    const open = recert({ id: "rc_open", startsAt: at(-5), dueAt: at(25) });
    const upcoming = recert({ id: "rc_next", startsAt: at(10), dueAt: at(40) });
    expect(currentRecert([closed, lastClosed], at(0))).toBe(lastClosed);
    expect(currentRecert([closed, lastClosed, open], at(0))).toBe(open);
    expect(currentRecert([closed, upcoming, open], at(0))).toBe(open);
    expect(currentRecert([closed, upcoming], at(0))).toBe(upcoming);
    expect(currentRecert([], at(0))).toBeNull();
  });

  it("labels the quarter of the deadline", () => {
    expect(quarterLabel(new Date(Date.UTC(2027, 2, 3)))).toBe("Q1 2027");
    expect(quarterLabel(new Date(Date.UTC(2026, 9, 31)))).toBe("Q4 2026");
  });
});

describe("startRecert", () => {
  const base = {
    team: CORAL,
    actor: PEOPLE.alex,
    now: at(0),
    memberships: coral(),
    unfinished: [] as RecertFacts[],
  };

  it("starts now, due in 30 days, covering members other than Team Admins", () => {
    const result = startRecert(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recert).toMatchObject({
      teamId: CORAL.id,
      startsAt: at(0),
      dueAt: at(30),
      label: "Q1 2027",
    });
    expect(result.recert.items.map((i) => i.userId)).toEqual([
      "devon",
      "jordan",
      "maya",
      "sam",
    ]);
    expect(result.recert.items.every((i) => i.decision === null)).toBe(true);
    expect(audits(result.effects)[0]).toMatchObject({
      action: "recert.started",
      details: { members: 4 },
    });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "recert_due",
      to: { kind: "team_admins", teamId: CORAL.id, exceptUserIds: ["alex"] },
      facts: {
        teamName: "Coral Offers",
        dueAt: at(30).toISOString(),
        members: 4,
      },
      link: { to: "settings", teamId: CORAL.id, section: "recertification" },
    });
    // The quarter and the second line are worded when it is read, from the deadline and the count.
    expect(words(notes(result.effects)[0], "alex")).toEqual({
      title: "Q1 2027 access review for Coral Offers is due March 3, 2027.",
      body: "Confirm 4 members.",
    });
    expect(notes(result.effects)[0]).not.toHaveProperty("body");
  });

  it("refuses while a review is open or upcoming, and allows it once closed", () => {
    expect(startRecert({ ...base, unfinished: [recert()] })).toEqual({
      ok: false,
      code: "recert_open",
      reason: "A review is already open.",
    });
    expect(
      startRecert({
        ...base,
        unfinished: [recert({ startsAt: at(5), dueAt: at(35) })],
      }).ok,
    ).toBe(false);
    // Deadline reached but not swept yet: it counts as closed.
    expect(
      startRecert({ ...base, unfinished: [recert({ dueAt: at(0) })] }).ok,
    ).toBe(true);
  });

  it("refuses when there's nobody to review", () => {
    expect(startRecert({ ...base, memberships: [coral()[0]!] })).toEqual({
      ok: false,
      code: "nobody_to_recertify",
      reason: "There's nobody to review.",
    });
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
    expect(result.item).toEqual({
      decision: "keep",
      decidedBy: "alex",
      decidedAt: at(0),
    });
    expect(result.membership).toBeNull();
    expect(result.completedAt).toBeNull();
    expect(audits(result.effects)).toEqual([
      expect.objectContaining({
        action: "recert.kept",
        details: expect.objectContaining({ userId: "maya", label: "Q1 2027" }),
      }),
    ]);
  });

  it("removing ends the access at once and tells the member", () => {
    const result = decideRecertItem({ ...base, decision: "remove" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toEqual({
      kind: "delete",
      membershipId: team[2]!.id,
    });
    expect(audits(result.effects)[0]?.action).toBe("recert.removed");
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "access_removed",
      to: { kind: "user", userId: "maya" },
      facts: {
        actorName: "Alex Kim",
        teamName: "Coral Offers",
        recertDueAt: at(30).toISOString(),
      },
    });
    expect(words(notes(result.effects)[0], "maya")?.title).toBe(
      "Your access to Coral Offers was removed in the Q1 2027 access review.",
    );
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
    expect(
      decideRecertItem({ ...base, userId: "alex", member: PEOPLE.alex }),
    ).toEqual({
      ok: false,
      code: "own_access",
      reason: "You can't change your own access.",
    });
    expect(
      decideRecertItem({ ...base, userId: "morgan", member: PEOPLE.morgan }),
    ).toEqual({
      ok: false,
      code: "not_in_recert",
      reason: "This person isn't part of this review.",
    });
    const decided = recert();
    decided.items[1]!.decision = "keep";
    expect(decideRecertItem({ ...base, recert: decided })).toEqual({
      ok: false,
      code: "already_recertified",
      reason: "This member was already reviewed.",
    });
    expect(
      decideRecertItem({
        ...base,
        teamMemberships: team.filter((m) => m.userId !== "maya"),
      }),
    ).toEqual({
      ok: false,
      code: "no_longer_member",
      reason: "This person is no longer a member.",
    });
  });

  it("closes the review early once everyone is decided", () => {
    const almost = recert();
    for (const item of almost.items)
      if (item.userId !== "sam") item.decision = "keep";
    const result = decideRecertItem({
      ...base,
      recert: almost,
      userId: "sam",
      member: PEOPLE.sam,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedAt).toEqual(at(0));
    expect(audits(result.effects).map((e) => e.action)).toEqual([
      "recert.kept",
      "recert.closed",
    ]);
    expect(audits(result.effects)[1]?.details).toMatchObject({
      kept: 4,
      removed: 0,
      lapsed: 0,
    });
  });

  it("closing early counts the last one removed", () => {
    const almost = recert();
    for (const item of almost.items)
      if (item.userId !== "sam") item.decision = "keep";
    const result = decideRecertItem({
      ...base,
      recert: almost,
      userId: "sam",
      member: PEOPLE.sam,
      decision: "remove",
    });
    expect(result.ok && result.completedAt).toEqual(at(0));
    expect(result.ok && audits(result.effects)[1]?.details).toMatchObject({
      kept: 3,
      removed: 1,
    });
  });
});
