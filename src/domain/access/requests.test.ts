import { describe, expect, it } from "vitest";
import { ACCESS_REFUSALS } from "./refusals";
import {
  decideAccessRequest,
  requestAccess,
  requestDecisionRefusal,
  validateAccessReason,
  validateDecisionNote,
} from "./requests";
import { REASONS } from "../permissions";
import type { AccessRequestFacts, MembershipFacts } from "../access-types";
import type { TeamRole } from "../types";
import {
  at,
  ago,
  CORAL,
  DEPOSITS,
  PEOPLE,
  membership,
  audits,
  notes,
} from "./fixtures";

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
        details: {
          userId: "morgan",
          userName: "Morgan Lee",
          role: "author",
          reason: "Drafting the spring promotions.",
        },
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
    for (const role of ["viewer", "author", "approver"] as TeamRole[])
      expect(requestAccess({ ...base, role }).ok).toBe(true);
    expect(requestAccess({ ...base, role: "team_admin" })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.pickRole,
    });
  });

  it("needs a reason, kept short", () => {
    expect(requestAccess({ ...base, reason: "   " })).toEqual({
      ok: false,
      code: "request_reason_missing",
      reason: "Add a reason.",
    });
    expect(requestAccess({ ...base, reason: "x".repeat(501) })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.reasonTooLong,
    });
    expect(requestAccess({ ...base, reason: "x".repeat(500) }).ok).toBe(true);
  });

  it("validateAccessReason is the check requestAccess refuses with: empty first, then too long", () => {
    expect(validateAccessReason("")).toBe(ACCESS_REFUSALS.giveReason);
    expect(validateAccessReason("  \n ")).toBe(ACCESS_REFUSALS.giveReason);
    expect(validateAccessReason(`  ${"x".repeat(501)}  `)).toBe(
      ACCESS_REFUSALS.reasonTooLong,
    );
    expect(validateAccessReason("x".repeat(500))).toBeNull();
    // Spaces around the reason don't count toward the limit, as requestAccess trims first.
    expect(validateAccessReason(`  ${"x".repeat(500)}  `)).toBeNull();
    expect(validateAccessReason("Drafting the spring promotions.")).toBeNull();
  });

  it("allows one pending request per team", () => {
    const pending = request({ userId: "morgan", teamId: CORAL.id });
    expect(requestAccess({ ...base, requests: [pending] })).toEqual({
      ok: false,
      code: "request_pending",
      reason: "You already asked for access to Coral Offers.",
    });
    expect(
      requestAccess({ ...base, team: DEPOSITS, requests: [pending] }).ok,
    ).toBe(true);
    expect(
      requestAccess({ ...base, requests: [{ ...pending, status: "denied" }] })
        .ok,
    ).toBe(true);
  });

  it("refuses a role already held, but a member may ask for another one", () => {
    const priya = { ...base, requester: { id: "priya", name: "Priya Raman" } };
    const viewer = membership("priya", ["viewer"], { teamId: DEPOSITS.id });
    expect(
      requestAccess({
        ...priya,
        team: DEPOSITS,
        role: "viewer",
        memberships: [viewer],
      }),
    ).toEqual({
      ok: false,
      code: "has_role",
      reason: "You already have Viewer access to Deposits.",
    });
    expect(
      requestAccess({
        ...priya,
        team: DEPOSITS,
        role: "author",
        memberships: [viewer],
      }).ok,
    ).toBe(true);
  });

  it("someone whose access lapsed may ask again for the same role", () => {
    const lapsed = membership("sam", ["viewer"], {
      status: "lapsed",
      statusReason: "recert_unconfirmed",
    });
    const result = requestAccess({
      ...base,
      requester: PEOPLE.sam,
      role: "viewer",
      memberships: [lapsed],
    });
    expect(result.ok).toBe(true);
  });
});

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
    expect(
      decideAccessRequest({
        ...base,
        request: request({ userId: "alex" }),
        requester: PEOPLE.alex,
      }),
    ).toEqual({
      ok: false,
      code: "own_request",
      reason: "You can't decide your own access request.",
    });
  });

  it("only while pending", () => {
    expect(
      decideAccessRequest({
        ...base,
        request: request({ status: "approved" }),
      }),
    ).toEqual({
      ok: false,
      code: "request_decided",
      reason: "This request was already decided.",
    });
  });

  it("approving adds a membership with the role and tells the requester", () => {
    const result = decideAccessRequest(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toEqual({
      status: "approved",
      decidedBy: "alex",
      decidedAt: at(0),
      decisionNote: null,
    });
    expect(result.membership).toEqual({
      kind: "insert",
      membership: {
        userId: "morgan",
        teamId: CORAL.id,
        roles: ["author"],
        addedAt: at(0),
        addedBy: "alex",
      },
    });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.granted",
      details: {
        requestId: "ar_1",
        userId: "morgan",
        userName: "Morgan Lee",
        role: "author",
        roles: ["author"],
      },
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
    const lapsed = membership("morgan", ["approver"], {
      status: "lapsed",
      statusReason: "recert_unconfirmed",
    });
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
    expect(
      decideAccessRequest({ ...base, decision: "deny", note: "  " }),
    ).toEqual({
      ok: false,
      code: "deny_note_missing",
      reason: "Add a note to explain the decision.",
    });
    const result = decideAccessRequest({
      ...base,
      decision: "deny",
      note: " Ask Jordan first. ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership).toBeNull();
    expect(result.request).toMatchObject({
      status: "denied",
      decisionNote: "Ask Jordan first.",
    });
    expect(audits(result.effects)[0]).toMatchObject({
      action: "access.denied",
      details: { note: "Ask Jordan first." },
    });
    expect(notes(result.effects)[0]).toMatchObject({
      notification: "access_denied",
      title:
        "Alex Kim declined your request for Author access to Coral Offers.",
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

describe("deciding a request: requestDecisionRefusal and validateDecisionNote", () => {
  it("nobody decides their own request, and a decided one stays decided", () => {
    expect(requestDecisionRefusal(request(), PEOPLE.alex)).toBeNull();
    expect(
      requestDecisionRefusal(request({ userId: "alex" }), PEOPLE.alex),
    ).toBe(REASONS.ownRequest);
    expect(
      requestDecisionRefusal(request({ status: "approved" }), PEOPLE.alex),
    ).toBe(ACCESS_REFUSALS.decided);
  });

  it("a denial needs a note; any note stays under the limit; decideAccessRequest refuses the same way", () => {
    expect(validateDecisionNote("deny", "  ")).toBe(ACCESS_REFUSALS.denyNote);
    expect(validateDecisionNote("deny", "Not this quarter.")).toBeNull();
    expect(validateDecisionNote("approve", null)).toBeNull();
    expect(validateDecisionNote("approve", "x".repeat(501))).toBe(
      ACCESS_REFUSALS.noteTooLong,
    );
    const input = {
      request: request(),
      requester: PEOPLE.morgan,
      team: CORAL,
      actor: PEOPLE.alex,
      now: at(0),
      membership: null,
    };
    expect(
      decideAccessRequest({ ...input, decision: "deny", note: " " }),
    ).toEqual({
      ok: false,
      ...validateDecisionNote("deny", " "),
    });
  });
});
