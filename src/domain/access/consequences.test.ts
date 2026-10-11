import { describe, expect, it } from "vitest";
import { DAY_MS } from "../dates";
import { ACCESS_REFUSALS } from "./refusals";
import { changeRoles, keepInactive, validateRoles } from "./members";
import {
  describeRoleChange,
  heldAsLastAdmin,
  memberConsequences,
  recertFootnote,
  recertItemOutcome,
  recertRemoveConsequence,
  requestConsequences,
  startRecertConsequence,
} from "./consequences";
import { firstName } from "./roles";
import { inactivity } from "./inactivity";
import { recertDueAt, startRecert } from "./recertification";
import { at, ago, CORAL, PEOPLE, membership, recert, coral, sweepAt } from "./fixtures";

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
