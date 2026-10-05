import { describe, expect, it } from "vitest";
import { describeActivity, type ActivityEvent } from "./activity";
import type { Person } from "./review-types";

const MAYA: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 30 };
const JORDAN: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 200 };
const ALEX: Person = { id: "alex", name: "Alex Kim", initials: "AK", hue: 140 };

const REVOKE_REASON = "Wrong APR in legal notices";

const event = (action: string, versionNumber: number | null, details: Record<string, unknown> = {}): ActivityEvent => ({
  action,
  details,
  versionNumber,
});

describe("describeActivity: one sentence per audit action", () => {
  it.each<[string, ActivityEvent, Person | null, string]>([
    ["template.created", event("template.created", null, { name: "Spring", source: "blank" }), MAYA, "Maya Chen created the template."],
    ["draft.started", event("draft.started", null, { basedOn: 2 }), MAYA, "Maya Chen started a draft from v2."],
    ["draft.edited", event("draft.edited", null, { saves: 12, basedOn: 2 }), MAYA, "Maya Chen edited the draft."],
    [
      "version.submitted, with a note",
      event("version.submitted", 3, { number: 3, note: "Adds the annual fee", contractChanges: 1, breaking: true }),
      MAYA,
      "Maya Chen submitted v3 for review: Adds the annual fee.",
    ],
    [
      "version.submitted, without one",
      event("version.submitted", 3, { number: 3, note: null }),
      MAYA,
      "Maya Chen submitted v3 for review.",
    ],
    [
      "version.changes_requested",
      event("version.changes_requested", 1, { number: 1, stage: "Team approver", reason: "The APR doesn't match." }),
      JORDAN,
      "Jordan Ellis requested changes on v1: The APR doesn't match.",
    ],
    [
      "version.stage_approved",
      event("version.stage_approved", 2, { number: 2, stage: "Team approver", next: "Legal reviewer" }),
      JORDAN,
      "Jordan Ellis approved v2 (Team approver).",
    ],
    [
      "version.activated by an approver",
      event("version.activated", 2, { number: 2, supersedes: 1, stage: "Team approver" }),
      JORDAN,
      "Jordan Ellis approved v2, making it Active.",
    ],
    ["version.superseded", event("version.superseded", 1, { number: 1, supersededBy: 2 }), JORDAN, "v1 was superseded by v2."],
    [
      "version.sunset_set",
      event("version.sunset_set", 1, { number: 1, sunsetAt: "2027-03-01T00:00:00.000Z", previousSunsetAt: null }),
      JORDAN,
      "Jordan Ellis set v1 to sunset on March 1, 2027.",
    ],
    [
      "version.sunset_set, moved",
      event("version.sunset_set", 1, { sunsetAt: "2027-03-01T00:00:00.000Z", previousSunsetAt: "2026-10-25T00:00:00.000Z" }),
      JORDAN,
      "Jordan Ellis moved the sunset of v1 to March 1, 2027.",
    ],
    [
      "version.revoke_started (the read model's example)",
      event("version.revoke_started", 1, { number: 1, reason: REVOKE_REASON }),
      JORDAN,
      "Jordan Ellis started revoking v1: Wrong APR in legal notices.",
    ],
    [
      "version.revoke_cancelled",
      event("version.revoke_cancelled", 1, { number: 1, reason: REVOKE_REASON, startedBy: "jordan" }),
      ALEX,
      "Alex Kim canceled the revoke of v1.",
    ],
    [
      "version.revoked",
      event("version.revoked", 1, { number: 1, reason: REVOKE_REASON, startedBy: "jordan", wasActive: false }),
      ALEX,
      "Alex Kim confirmed the revoke of v1: Wrong APR in legal notices.",
    ],
    ["comment.added", event("comment.added", 1, { threadId: "t1", blockId: "b1" }), JORDAN, "Jordan Ellis commented on v1."],
    ["comment.added on a draft", event("comment.added", null, { threadId: "t1" }), MAYA, "Maya Chen commented on the draft."],
    ["thread.resolved", event("thread.resolved", 1, { threadId: "t1" }), MAYA, "Maya Chen resolved a comment on v1."],
    [
      "thread.resolved, answered by resubmitting",
      event("thread.resolved", 1, { threadId: "t1", blockId: "doc", auto: true, resolvedWith: 2 }),
      MAYA,
      "Maya Chen answered the change request on v1 with v2.",
    ],
    ["thread.reopened", event("thread.reopened", 1, { threadId: "t1" }), JORDAN, "Jordan Ellis reopened a comment on v1."],
  ])("%s", (_, e, actor, sentence) => {
    expect(describeActivity(e, actor)).toBe(sentence);
  });
});

describe("describeActivity: the seed's spellings", () => {
  it.each<[string, ActivityEvent, Person | null, string]>([
    ["version.approved", event("version.approved", 2, { number: 2, stage: "Team approver" }), JORDAN, "Jordan Ellis approved v2 (Team approver)."],
    ["version.activated by the system", event("version.activated", 2, { number: 2, supersedes: 1 }), null, "v2 became Active, replacing v1."],
    ["a first activation by the system", event("version.activated", 1, { number: 1, supersedes: null }), null, "v1 became Active."],
    [
      "version.revoke_confirmed",
      event("version.revoke_confirmed", 1, { number: 1, reason: "Wrong bonus amount.", startedBy: "jordan" }),
      ALEX,
      "Alex Kim confirmed the revoke of v1: Wrong bonus amount.",
    ],
    ["comment.resolved", event("comment.resolved", 1, { threadId: "t1" }), MAYA, "Maya Chen resolved a comment on v1."],
  ])("%s", (_, e, actor, sentence) => {
    expect(describeActivity(e, actor)).toBe(sentence);
  });
});

describe("describeActivity: details", () => {
  it("keeps a reason's own closing punctuation, and collapses its whitespace", () => {
    expect(describeActivity(event("version.revoke_started", 1, { reason: "Wrong APR!" }), JORDAN)).toBe(
      "Jordan Ellis started revoking v1: Wrong APR!",
    );
    expect(describeActivity(event("version.submitted", 2, { note: "  Line one.\n\nLine two  " }), MAYA)).toBe(
      "Maya Chen submitted v2 for review: Line one. Line two.",
    );
  });

  it("drops an empty reason", () => {
    expect(describeActivity(event("version.changes_requested", 1, { reason: "   " }), JORDAN)).toBe(
      "Jordan Ellis requested changes on v1.",
    );
  });

  it("finds the version number in the details when the event has none", () => {
    expect(describeActivity(event("version.revoke_started", null, { number: 4, reason: REVOKE_REASON }), JORDAN)).toBe(
      "Jordan Ellis started revoking v4: Wrong APR in legal notices.",
    );
  });

  it("reads null details as none", () => {
    expect(describeActivity({ action: "version.revoke_cancelled", details: null, versionNumber: 1 }, ALEX)).toBe(
      "Alex Kim canceled the revoke of v1.",
    );
  });

  it("names the system when there is no actor", () => {
    expect(describeActivity(event("draft.edited", null), null)).toBe("UCOMP edited the draft.");
  });

  it("says something plain about an action it doesn't know", () => {
    expect(describeActivity(event("platform.config_changed", null, { summary: "Created team Coral Offers" }), null)).toBe(
      "UCOMP: Created team Coral Offers.",
    );
    expect(describeActivity(event("version.archived", 2), MAYA)).toBe("Maya Chen: version archived (v2).");
    expect(describeActivity(event("access.requested", null, { role: "author" }), MAYA)).toBe("Maya Chen: access requested.");
  });

  it("falls back when a sunset date is missing or unreadable", () => {
    expect(describeActivity(event("version.sunset_set", 1, { sunsetAt: "soon" }), JORDAN)).toBe(
      "Jordan Ellis set a sunset date for v1.",
    );
  });
});
