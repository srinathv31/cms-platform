import { describe, expect, it } from "vitest";
import { describeActivity, eventVersionLabel, type ActivityEvent } from "./activity";
import type { Person } from "./review-types";
import type { VersionState } from "./types";

const MAYA: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 30 };
const JORDAN: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 200 };
const ALEX: Person = { id: "alex", name: "Alex Kim", initials: "AK", hue: 140 };

const REVOKE_REASON = "Wrong APR in legal notices";

const NAOMI: Person = { id: "naomi", name: "Naomi Reyes", initials: "NR", hue: 300 };

/** An event about version `versionNumber`'s row as it is now: round 1 and released unless `row` says otherwise. */
const event = (
  action: string,
  versionNumber: number | null,
  details: Record<string, unknown> = {},
  row: { round?: number; state?: VersionState } = {},
): ActivityEvent => ({
  action,
  details,
  version: versionNumber === null ? null : { number: versionNumber, round: row.round ?? 1, state: row.state ?? "superseded" },
});

describe("describeActivity: one sentence per audit action", () => {
  it.each<[string, ActivityEvent, Person | null, string]>([
    ["template.created", event("template.created", null, { name: "Spring", source: "blank" }), MAYA, "Maya Chen created the template."],
    [
      "template.created by an import",
      event("template.created", null, { name: "Spring", source: "import:docx", filename: "Spring offer.docx" }),
      MAYA,
      "Maya Chen imported Spring offer.docx.",
    ],
    [
      "template.created by an import with no file name",
      event("template.created", null, { name: "Spring", source: "import:txt" }),
      MAYA,
      "Maya Chen created the template.",
    ],
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
      "version.sunset_set, with the day and zone it was set in",
      event("version.sunset_set", 1, {
        number: 1,
        sunsetAt: "2027-03-01T05:00:00.000Z",
        sunsetDay: "2027-03-01",
        zone: "America/New_York",
        previousSunsetAt: null,
      }),
      JORDAN,
      "Jordan Ellis set v1 to sunset on March 1, 2027.",
    ],
    [
      "version.sunset_set, a day whose instant is the UTC day before (a zone ahead of UTC)",
      event("version.sunset_set", 1, { number: 1, sunsetAt: "2027-02-28T18:30:00.000Z", sunsetDay: "2027-03-01", previousSunsetAt: null }),
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
      "version.sunset_passed (the sweep, no actor): the day in the zone it was read in",
      event("version.sunset_passed", 1, { number: 1, sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01", zone: "America/New_York" }),
      null,
      "v1 stopped rendering: its sunset passed on March 1, 2027.",
    ],
    [
      "version.sunset_passed, Pacific: the day, not the UTC date of the instant",
      event("version.sunset_passed", 2, { number: 2, sunsetAt: "2027-03-02T08:00:00.000Z", sunsetDay: "2027-03-02", zone: "America/Los_Angeles" }),
      null,
      "v2 stopped rendering: its sunset passed on March 2, 2027.",
    ],
    ["version.sunset_passed, no day recorded", event("version.sunset_passed", 1, { number: 1 }), null, "v1 stopped rendering: its sunset passed."],
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
      "thread.resolved, answered by resubmitting: the next round of the same number",
      event(
        "thread.resolved",
        1,
        { threadId: "t1", blockId: "doc", auto: true, resolvedWith: 1, resolvedWithRound: 2 },
        { state: "changes_requested" },
      ),
      MAYA,
      "Maya Chen answered the change request on v1, round 1 with round 2.",
    ],
    [
      "thread.resolved, answered by resubmitting before rounds: the next number",
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
    expect(
      describeActivity({ action: "version.revoke_cancelled", details: null, version: { number: 1, round: 1, state: "superseded" } }, ALEX),
    ).toBe(
      "Alex Kim canceled the revoke of v1.",
    );
  });

  it("names the system when there is no actor", () => {
    expect(describeActivity(event("draft.edited", null), null)).toBe("Stencil edited the draft.");
  });

  it("says something plain about an action it doesn't know", () => {
    expect(describeActivity(event("platform.config_changed", null, { summary: "Created team Coral Offers" }), null)).toBe(
      "Stencil: Created team Coral Offers.",
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

// A review event names the round as the review history does; the rest name the released version.
describe("describeActivity: rounds", () => {
  it.each<[string, ActivityEvent, Person | null, string]>([
    [
      "submitted, a round later sent back",
      event("version.submitted", 3, { number: 3, round: 1, note: null }, { round: 1, state: "changes_requested" }),
      MAYA,
      "Maya Chen submitted v3, round 1 for review.",
    ],
    [
      "submitted, the second round in review",
      event("version.submitted", 3, { number: 3, round: 2, note: null }, { round: 2, state: "in_review" }),
      MAYA,
      "Maya Chen submitted v3, round 2 for review.",
    ],
    [
      "submitted, the first round in review: no round yet",
      event("version.submitted", 3, { number: 3, round: 1, note: null }, { round: 1, state: "in_review" }),
      MAYA,
      "Maya Chen submitted v3 for review.",
    ],
    [
      "submitted, the round later approved (history)",
      event("version.submitted", 2, { number: 2, round: 3, note: null }, { round: 3, state: "active" }),
      MAYA,
      "Maya Chen submitted v2, round 3 for review.",
    ],
    [
      "changes requested on round 1",
      event("version.changes_requested", 3, { number: 3, round: 1, reason: "Say when the fee starts." }, { state: "changes_requested" }),
      JORDAN,
      "Jordan Ellis requested changes on v3, round 1: Say when the fee starts.",
    ],
    [
      "activated on round 3",
      event("version.activated", 2, { number: 2, round: 3, supersedes: 1 }, { round: 3, state: "active" }),
      NAOMI,
      "Naomi Reyes approved v2 on round 3, making it Active.",
    ],
    [
      "activated on round 1",
      event("version.activated", 2, { number: 2, round: 1, supersedes: 1 }, { round: 1, state: "active" }),
      NAOMI,
      "Naomi Reyes approved v2, making it Active.",
    ],
    [
      "a sunset is about the released version: no round",
      event("version.sunset_set", 2, { number: 2, sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01" }, { round: 3 }),
      JORDAN,
      "Jordan Ellis set v2 to sunset on March 1, 2027.",
    ],
    [
      "a row the event doesn't join: the round from its details",
      event("version.submitted", null, { number: 4, round: 2, note: null }),
      MAYA,
      "Maya Chen submitted v4, round 2 for review.",
    ],
  ])("%s", (_, e, actor, sentence) => {
    expect(describeActivity(e, actor)).toBe(sentence);
  });

  it("labels the event's version for its row, with the round only for review events", () => {
    const sentBack = { number: 3, round: 1, state: "changes_requested" } as const;
    const approved = { number: 2, round: 3, state: "active" } as const;
    expect(eventVersionLabel("version.submitted", sentBack)).toBe("v3 · Round 1");
    expect(eventVersionLabel("version.activated", approved)).toBe("v2 · Round 3");
    expect(eventVersionLabel("version.activated", approved, "sentence")).toBe("v2, round 3");
    expect(eventVersionLabel("version.revoke_started", approved)).toBe("v2");
    expect(eventVersionLabel("comment.added", null)).toBeNull();
  });
});
