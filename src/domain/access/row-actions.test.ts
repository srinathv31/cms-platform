import { describe, expect, it } from "vitest";
import { REASONS } from "../permissions";
import type { Viewer } from "../types";
import {
  inactivityActions,
  memberActions,
  recertItemActions,
  requestActions,
  startRecertAction,
} from "./row-actions";
import { ACCESS_REFUSALS } from "./refusals";
import { at, ago, CORAL, PEOPLE, coral, membership, recert } from "./fixtures";

// What the viewer may do on a row, decided: the permission first, then the domain's own rule.

const NOW = at(0);

function viewerOf(
  userId: keyof typeof PEOPLE,
  over: Partial<Viewer> = {},
): Viewer {
  return {
    userId,
    name: PEOPLE[userId].name,
    initials: PEOPLE[userId].name.slice(0, 2).toUpperCase(),
    title: "",
    platformRole: null,
    memberships: [
      {
        teamId: CORAL.id,
        teamSlug: "coral-offers",
        teamName: CORAL.name,
        roles: userId === "alex" ? ["team_admin", "approver"] : ["author"],
        status: "active",
      },
    ],
    ...over,
  };
}

const alex = viewerOf("alex");
const team = coral();
const row = (userId: keyof typeof PEOPLE, viewer: Viewer = alex) => {
  const m = team.find((x) => x.userId === userId)!;
  return {
    viewer,
    membership: m,
    member: PEOPLE[userId],
    team: CORAL,
    now: NOW,
    teamMemberships: team,
  };
};

describe("a member's row (memberActions)", () => {
  it("lets a Team Admin change, remove and (when ended) restore another member", () => {
    expect(memberActions(row("maya"))).toEqual({
      editRoles: { ok: true },
      remove: { ok: true },
      reinstate: { ok: false, ...ACCESS_REFUSALS.alreadyActive },
    });
  });

  it("refuses everything on the viewer's own row, with the reason the command gives", () => {
    const own = { ok: false, ...REASONS.ownAccess };
    expect(memberActions(row("alex"))).toEqual({
      editRoles: own,
      remove: own,
      reinstate: own,
    });
  });

  it("refuses with the permission when the viewer isn't the team's Team Admin", () => {
    const refused = { ok: false, ...REASONS.generic };
    expect(memberActions(row("maya", viewerOf("jordan")))).toEqual({
      editRoles: refused,
      remove: refused,
      reinstate: refused,
    });
  });

  it("refuses the roles of a member whose access isn't active", () => {
    const sam = membership("sam", ["viewer"], {
      status: "lapsed",
      statusReason: "recert_unconfirmed",
    });
    const actions = memberActions({
      ...row("sam"),
      membership: sam,
      teamMemberships: [...team.filter((m) => m.userId !== "sam"), sam],
    });
    expect(actions.editRoles).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.notActive,
    });
    expect(actions.reinstate).toEqual({ ok: true });
  });
});

describe("a flagged member's row (inactivityActions)", () => {
  it("can suspend, keep and not restore an active member past 90 days", () => {
    expect(inactivityActions(row("devon"))).toEqual({
      suspend: { ok: true },
      keep: { ok: true },
      reinstate: { ok: false, ...ACCESS_REFUSALS.alreadyActive },
    });
  });

  it("can't suspend or keep a member who isn't flagged", () => {
    expect(inactivityActions(row("maya"))).toMatchObject({
      suspend: { ok: false, ...ACCESS_REFUSALS.notFlagged },
      keep: { ok: false, ...ACCESS_REFUSALS.notFlagged },
    });
  });
});

describe("a request's row (requestActions)", () => {
  const pending = { userId: "morgan", status: "pending" as const };

  it("lets the team's Team Admin decide a pending request, once", () => {
    expect(requestActions(alex, CORAL.id, pending)).toEqual({
      decide: { ok: true },
    });
    expect(
      requestActions(alex, CORAL.id, { ...pending, status: "approved" }),
    ).toEqual({ decide: { ok: false, ...ACCESS_REFUSALS.decided } });
  });

  it("never lets anyone decide their own", () => {
    expect(
      requestActions(alex, CORAL.id, { userId: "alex", status: "pending" }),
    ).toEqual({ decide: { ok: false, ...REASONS.ownRequest } });
  });

  it("refuses with the permission to someone who isn't the team's Team Admin", () => {
    expect(requestActions(viewerOf("maya"), CORAL.id, pending)).toEqual({
      decide: { ok: false, ...REASONS.generic },
    });
  });
});

describe("a review's rows (recertItemActions, startRecertAction)", () => {
  const open = recert({ startsAt: ago(4), dueAt: at(30) });

  const item = (recertFacts: typeof open, userId: keyof typeof PEOPLE) => ({
    viewer: alex,
    recert: recertFacts,
    member: PEOPLE[userId],
    team: CORAL,
    now: NOW,
    teamMemberships: team,
  });

  it("opens Keep and Remove on an undecided member while the review is open", () => {
    expect(recertItemActions(item(open, "sam"))).toEqual({
      decide: { ok: true },
    });
  });

  it("closes them once the review has ended", () => {
    const closed = { ...open, completedAt: ago(1) };
    expect(recertItemActions(item(closed, "sam")).decide.ok).toBe(false);
  });

  it("starts a review only when none is open and somebody is left to review", () => {
    const start = (unfinished: (typeof open)[]) =>
      startRecertAction({
        viewer: alex,
        team: CORAL,
        now: NOW,
        teamMemberships: team,
        unfinished,
      });
    expect(start([])).toEqual({ ok: true });
    expect(start([open])).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.reviewOpen,
    });
    expect(
      startRecertAction({
        viewer: alex,
        team: CORAL,
        now: NOW,
        teamMemberships: [team.find((m) => m.userId === "alex")!],
        unfinished: [],
      }),
    ).toEqual({ ok: false, ...ACCESS_REFUSALS.nobodyToReview });
  });

  it("refuses with the permission to someone who can't manage the team", () => {
    expect(
      startRecertAction({
        viewer: viewerOf("maya"),
        team: CORAL,
        now: NOW,
        teamMemberships: team,
        unfinished: [],
      }),
    ).toEqual({ ok: false, ...REASONS.generic });
  });
});
