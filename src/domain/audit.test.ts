import { describe, expect, it } from "vitest";
import type { AccessAuditAction, AuditFilters, AuditRow } from "./access-types";
import {
  actionLabel,
  actionOptions,
  activeFilterCount,
  auditDomain,
  auditFacetCounts,
  auditQuery,
  canonicalAction,
  categoryOf,
  csvField,
  datePresets,
  dateRangeLabel,
  describeAuditEvent,
  filterAuditRows,
  filterValues,
  isDay,
  parseAuditFilters,
  parseCsv,
  toCsv,
  toggleFilterValue,
} from "./audit";
import type { AuditAction, Person } from "./review-types";
import type { NumberedRound } from "./rounds";

const alex: Person = { id: "alex", name: "Alex Kim", initials: "AK", hue: 152 };
const sam: Person = { id: "sam", name: "Sam Ortiz", initials: "SO", hue: 48 };
const riley: Person = {
  id: "riley",
  name: "Riley Brooks",
  initials: "RB",
  hue: 266,
};
const maya: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 28 };
const morgan: Person = {
  id: "morgan",
  name: "Morgan Lee",
  initials: "ML",
  hue: 96,
};

const LIFECYCLE: AuditAction[] = [
  "template.created",
  "draft.started",
  "draft.edited",
  "version.submitted",
  "version.changes_requested",
  "version.stage_approved",
  "version.activated",
  "version.superseded",
  "version.sunset_set",
  "version.sunset_passed",
  "version.revoke_started",
  "version.revoke_cancelled",
  "version.revoked",
  "comment.added",
  "thread.resolved",
  "thread.reopened",
];

const ACCESS: AccessAuditAction[] = [
  "access.requested",
  "access.granted",
  "access.denied",
  "access.role_changed",
  "access.removed",
  "access.flagged_inactive",
  "access.kept",
  "access.suspended",
  "access.lapsed",
  "access.reinstated",
  "access.kept_last_admin",
  "recert.started",
  "recert.kept",
  "recert.removed",
  "recert.closed",
  "platform.config_changed",
];

/** Details shaped like what domain/access/, domain/platform-config/ and the seed write. */
const DETAILS: Record<AccessAuditAction, Record<string, unknown>> = {
  "access.requested": {
    userId: "morgan",
    userName: "Morgan Lee",
    role: "author",
    reason: "Joining the offers team",
  },
  "access.granted": {
    requestId: "ar_1",
    userId: "morgan",
    userName: "Morgan Lee",
    role: "author",
    roles: ["author"],
    note: null,
  },
  "access.denied": {
    requestId: "ar_1",
    userId: "morgan",
    userName: "Morgan Lee",
    role: "approver",
    note: "Ask your manager first",
  },
  "access.role_changed": {
    userId: "sam",
    userName: "Sam Ortiz",
    from: ["viewer"],
    to: ["viewer", "author"],
  },
  "access.removed": {
    userId: "sam",
    userName: "Sam Ortiz",
    roles: ["viewer"],
    status: "active",
  },
  "access.flagged_inactive": {
    userId: "devon",
    userName: "Devon Lin",
    lastActiveAt: "2026-07-02T16:00:00.000Z",
    suspendsAt: "2026-10-30T16:00:00.000Z",
  },
  "access.kept": { userId: "devon", userName: "Devon Lin", daysInactive: 95 },
  "access.suspended": {
    userId: "devon",
    userName: "Devon Lin",
    reason: "inactivity",
    daysInactive: 95,
  },
  "access.lapsed": {
    userId: "sam",
    userName: "Sam Ortiz",
    recertId: "rc_1",
    label: "Q4 2026",
    dueAt: "2027-03-03T12:00:00.000Z",
    roles: ["viewer"],
  },
  "access.reinstated": {
    userId: "devon",
    userName: "Devon Lin",
    from: "suspended",
    reason: "inactivity",
    roles: ["viewer"],
  },
  "access.kept_last_admin": {
    userId: "alex",
    userName: "Alex Kim",
    teamName: "Coral Offers",
    reason: "inactivity_auto",
    daysInactive: 120,
  },
  "recert.started": {
    label: "Q4 2026",
    dueAt: "2026-11-04T16:00:00.000Z",
    members: 6,
  },
  "recert.kept": {
    recertId: "rc_1",
    label: "Q4 2026",
    userId: "maya",
    userName: "Maya Chen",
    roles: ["author"],
  },
  "recert.removed": {
    recertId: "rc_1",
    label: "Q4 2026",
    userId: "sam",
    userName: "Sam Ortiz",
    roles: ["viewer"],
  },
  "recert.closed": {
    recertId: "rc_1",
    label: "Q4 2026",
    kept: 5,
    removed: 0,
    lapsed: 1,
  },
  "platform.config_changed": {
    area: "channel_rules",
    contentTypeId: "ct_disclosure",
    contentTypeName: "Disclosure",
    channel: "pdf",
    allowed: false,
    activeUsing: 2,
  },
};

/** A released version, round 1: the label is "vN" whatever the event. */
const v = (number: number): NumberedRound => ({
  number,
  round: 1,
  state: "superseded",
});

function row(
  over: Partial<AuditRow> & Pick<AuditRow, "id" | "at" | "action">,
): AuditRow {
  const category = categoryOf(over.action);
  return {
    actor: alex,
    team: { slug: "coral-offers", name: "Coral Offers" },
    template: null,
    versionLabel: null,
    category,
    actionLabel: actionLabel(
      over.action,
      (over.actor === undefined ? alex : over.actor) !== null,
    ),
    summary: "",
    subject: null,
    when: "",
    ago: "",
    ...over,
  };
}

// ── Catalog ─────────────────────────────────────────────────

describe("the action catalog", () => {
  it("files every lifecycle action under templates, access and recert under access, config under platform", () => {
    for (const a of LIFECYCLE) expect(categoryOf(a)).toBe("templates");
    for (const a of ACCESS.filter((x) => x !== "platform.config_changed"))
      expect(categoryOf(a)).toBe("access");
    expect(categoryOf("platform.config_changed")).toBe("platform");
    expect(categoryOf("access.something_new")).toBe("access");
    expect(categoryOf("platform.other")).toBe("platform");
  });

  it("labels every action, and a stage's approval as Approved", () => {
    for (const a of [...LIFECYCLE, ...ACCESS])
      expect(actionLabel(a)).toMatch(/^[A-Z][a-z]/);
    expect(actionLabel("version.submitted")).toBe("Submitted");
    expect(actionLabel("version.sunset_passed")).toBe("Sunset passed");
    expect(actionLabel("access.granted")).toBe("Access granted");
    expect(actionLabel("platform.config_changed")).toBe(
      "Configuration changed",
    );
    expect(actionLabel("version.revoked")).toBe("Revoked");
    expect(actionLabel("thread.resolved")).toBe("Comment resolved");
    expect(actionLabel("version.stage_approved")).toBe("Approved");
    expect(actionLabel("version.fancy_thing")).toBe("Fancy thing");
    // An action is data from the database: a name on Object's prototype isn't in the catalog.
    expect(actionLabel("toString")).toBe("ToString");
    expect(categoryOf("hasOwnProperty")).toBe("templates");
    expect(parseAuditFilters({ action: "toString" })).toEqual({});
  });

  it("files every approval under Approved: a stage's, and the last stage's, which also activates", () => {
    expect(canonicalAction("version.stage_approved")).toBe("version.approved");
    expect(canonicalAction("version.activated", true)).toBe("version.approved");
    expect(actionLabel("version.activated", true)).toBe("Approved");
    // No other spelling is folded into another: `canonicalAction` knows no aliases.
    for (const action of ["version.revoked", "thread.resolved", "toString"])
      expect(canonicalAction(action)).toBe(action);
  });

  it("lists options grouped by category in a stable order, every value canonical", () => {
    const options = actionOptions();
    const categories = options.map((o) => o.category);
    expect(categories).toEqual(
      [...categories].sort(
        (a, b) =>
          ["templates", "access", "platform"].indexOf(a) -
          ["templates", "access", "platform"].indexOf(b),
      ),
    );
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
    for (const o of options) expect(canonicalAction(o.value)).toBe(o.value);
    for (const a of ACCESS) expect(options.map((o) => o.value)).toContain(a);
    expect(actionOptions()).toEqual(options);
  });
});

// ── Sentences ───────────────────────────────────────────────

describe("describeAuditEvent", () => {
  it("writes one plain sentence for every access and platform action", () => {
    for (const action of ACCESS) {
      for (const actor of [alex, null]) {
        const s = describeAuditEvent(
          { action, details: DETAILS[action], version: null },
          actor,
        );
        expect(s, action).toMatch(/^[A-Z].*[.]$/);
        expect(s, action).not.toMatch(/undefined|null|\[object|NaN/);
      }
    }
  });

  it("writes one plain sentence for every lifecycle action, through describeActivity", () => {
    for (const action of LIFECYCLE) {
      const s = describeAuditEvent(
        { action, details: { reason: "Wrong APR" }, version: v(3) },
        maya,
      );
      // "v3 was superseded." starts with the version, as the Activity tab does.
      expect(s, action).toMatch(/^[A-Zv].*[.]$/);
      expect(s, action).not.toMatch(/undefined|null/);
    }
    expect(
      describeAuditEvent(
        {
          action: "version.submitted",
          details: { note: "Ready" },
          version: v(3),
        },
        maya,
      ),
    ).toBe("Maya Chen submitted v3 for review: Ready.");
    expect(
      describeAuditEvent(
        { action: "version.activated", details: {}, version: v(2) },
        alex,
      ),
    ).toBe("Alex Kim approved v2, making it Active.");
    expect(
      describeAuditEvent(
        {
          action: "version.sunset_passed",
          details: {
            number: 1,
            sunsetAt: "2027-03-01T05:00:00.000Z",
            sunsetDay: "2027-03-01",
            zone: "America/New_York",
          },
          version: v(1),
        },
        null,
      ),
    ).toBe("v1 stopped rendering: its sunset passed on March 1, 2027.");
  });

  it("reads the details the access rules write", () => {
    const say = (
      action: AccessAuditAction,
      actor: Person | null,
      details = DETAILS[action],
    ) => describeAuditEvent({ action, details, version: null }, actor);
    expect(say("access.granted", alex)).toBe(
      "Alex Kim approved Morgan Lee's request for Author access.",
    );
    expect(
      say("access.granted", alex, {
        ...DETAILS["access.granted"],
        note: "Welcome",
      }),
    ).toBe(
      "Alex Kim approved Morgan Lee's request for Author access: Welcome.",
    );
    expect(
      say("access.granted", riley, {
        userId: "alex",
        userName: "Alex Kim",
        roles: ["team_admin", "approver"],
      }),
    ).toBe("Riley Brooks gave Alex Kim Approver & Team Admin access.");
    expect(
      say("access.granted", riley, {
        userId: "hana",
        userName: "Hana Sato",
        role: "team_admin",
        roles: ["team_admin"],
        appointed: true,
      }),
    ).toBe("Riley Brooks made Hana Sato the Team Admin.");
    expect(say("access.denied", alex)).toBe(
      "Alex Kim declined Morgan Lee's request for Approver access: Ask your manager first.",
    );
    expect(say("access.requested", morgan)).toBe(
      "Morgan Lee asked for Author access: Joining the offers team.",
    );
    expect(say("access.requested", morgan, { role: "author" })).toBe(
      "Morgan Lee asked for Author access.",
    );
    expect(say("access.role_changed", alex)).toBe(
      "Alex Kim changed Sam Ortiz's roles from Viewer to Viewer & Author.",
    );
    expect(say("access.removed", alex)).toBe(
      "Alex Kim removed Sam Ortiz's Viewer access.",
    );
    expect(say("access.lapsed", null)).toBe(
      "Sam Ortiz's access lapsed: not recertified by March 3, 2027.",
    );
    expect(say("access.kept_last_admin", null)).toBe(
      "Alex Kim's access wasn't suspended automatically after 120 days without a sign-in: the last Team Admin of Coral Offers.",
    );
    expect(
      say("access.kept_last_admin", null, {
        userId: "alex",
        userName: "Alex Kim",
        teamName: "Coral Offers",
        reason: "recert_unconfirmed",
        dueAt: "2027-03-03T12:00:00.000Z",
      }),
    ).toBe(
      "Alex Kim's access didn't lapse on March 3, 2027: the last Team Admin of Coral Offers.",
    );
    expect(say("access.flagged_inactive", null)).toBe(
      "Devon Lin hasn't signed in for 90 days: suspends automatically on October 30, 2026.",
    );
    expect(say("access.suspended", alex)).toBe(
      "Alex Kim suspended Devon Lin's access after 95 days without a sign-in.",
    );
    expect(
      say("access.suspended", null, {
        userId: "devon",
        userName: "Devon Lin",
        reason: "inactivity_auto",
        daysInactive: 120,
      }),
    ).toBe(
      "Devon Lin's access was suspended automatically after 120 days without a sign-in.",
    );
    expect(say("access.kept", alex)).toBe(
      "Alex Kim kept Devon Lin's access after 95 days without a sign-in.",
    );
    expect(say("access.reinstated", alex)).toBe(
      "Alex Kim reinstated Devon Lin as Viewer.",
    );
    expect(say("recert.started", null)).toBe(
      "The Q4 2026 access review started: 6 members to confirm, due November 4, 2026.",
    );
    expect(say("recert.started", alex)).toBe(
      "Alex Kim started the Q4 2026 access review: 6 members to confirm, due November 4, 2026.",
    );
    expect(say("recert.kept", alex)).toBe(
      "Alex Kim confirmed Maya Chen's access in the Q4 2026 access review.",
    );
    expect(say("recert.removed", alex)).toBe(
      "Alex Kim removed Sam Ortiz in the Q4 2026 access review.",
    );
    expect(say("recert.closed", null)).toBe(
      "The Q4 2026 access review closed: 5 kept, 0 removed, 1 lapsed.",
    );
    expect(say("platform.config_changed", riley)).toBe(
      "Riley Brooks turned off PDF for Disclosure: 2 Active versions stopped rendering to PDF.",
    );
    expect(
      say("platform.config_changed", riley, {
        area: "teams",
        teamName: "Coral Offers",
        slug: "coral-offers",
        userId: "alex",
        userName: "Alex Kim",
      }),
    ).toBe(
      "Riley Brooks created team Coral Offers with Alex Kim as Team Admin.",
    );
    expect(
      say("platform.config_changed", riley, {
        area: "content_types",
        contentTypeName: "Disclosure",
        added: ["Eligibility", "Fees"],
        removed: ["Legal notices"],
        renamed: [{ from: "Rates", to: "Rates and fees" }],
        reordered: true,
        sections: ["Rates and fees", "Eligibility", "Fees"],
      }),
    ).toBe(
      "Riley Brooks changed Disclosure required sections: added Eligibility and Fees; removed Legal notices; renamed Rates to Rates and fees; reordered the sections.",
    );
    expect(
      say("platform.config_changed", riley, {
        area: "content_types",
        contentTypeName: "Alert",
        created: true,
        added: [],
        removed: [],
        renamed: [],
        reordered: false,
        sections: [],
      }),
    ).toBe("Riley Brooks created content type Alert.");
    expect(
      say("platform.config_changed", riley, {
        area: "channel_rules",
        contentTypeName: "Alert",
        channel: "sms",
        allowed: true,
        activeUsing: 0,
      }),
    ).toBe("Riley Brooks turned on SMS for Alert.");
    // A stage that names a person keeps the name they had (`userName`), not a lookup.
    expect(
      say("platform.config_changed", riley, {
        area: "approval_chains",
        contentTypeName: "Disclosure",
        before: ["Team approver"],
        after: ["Team approver", "Legal reviewer"],
        stages: [
          {
            name: "Team approver",
            rule: { kind: "team_role", role: "approver" },
          },
          {
            name: "Legal reviewer",
            rule: { kind: "user", userId: "dana" },
            userName: "Dana Park",
          },
        ],
      }),
    ).toBe(
      "Riley Brooks set Disclosure approval chain: Team approver (Approver role) → Legal reviewer (Dana Park).",
    );
    expect(
      say("platform.config_changed", riley, {
        area: "business_zone",
        from: "America/New_York",
        to: "America/Los_Angeles",
        pendingSunsets: 1,
      }),
    ).toBe(
      "Riley Brooks set the business time zone to Pacific (America/Los_Angeles).",
    );
    // Details that don't word a change (a row from before its area's facts) name the area.
    expect(
      say("platform.config_changed", riley, { area: "approval_chains" }),
    ).toBe("Riley Brooks changed the approval chains.");
    expect(
      say("platform.config_changed", riley, {
        area: "channel_rules",
        summary: "An English sentence is no longer read",
      }),
    ).toBe("Riley Brooks changed the channel rules.");
  });

  it("survives missing and malformed details", () => {
    for (const action of ACCESS) {
      for (const details of [
        null,
        {},
        {
          userName: 42,
          roles: "author",
          dueAt: "not a date",
          daysInactive: "x",
        },
      ]) {
        const s = describeAuditEvent(
          {
            action,
            details: details as Record<string, unknown> | null,
            version: null,
          },
          sam,
        );
        expect(s, action).toMatch(/^[A-Z].*[.]$/);
        expect(s, action).not.toMatch(/undefined|null|\[object|NaN|Invalid/);
      }
    }
  });
});

// ── Filters ─────────────────────────────────────────────────

describe("parseAuditFilters", () => {
  it("reads every field, comma lists and repeated params", () => {
    expect(
      parseAuditFilters({
        team: "coral-offers,deposits",
        person: ["alex", "sam"],
        action: "access,version.submitted",
        template: "uc-4f7k2q",
        from: "2026-09-01",
        to: "2026-10-05",
      }),
    ).toEqual({
      team: "coral-offers,deposits",
      person: "alex,sam",
      action: "access,version.submitted",
      template: "UC-4F7K2Q",
      from: "2026-09-01",
      to: "2026-10-05",
    });
  });

  it("drops what is malformed and keeps the rest", () => {
    expect(
      parseAuditFilters({
        team: "all,Coral Offers!,deposits",
        person: "../etc,alex",
        action: "version.nope,templates,DROP TABLE",
        template: "UC-123,UC-4F7K2Q",
        from: "2026-02-30",
        to: "yesterday",
      }),
    ).toEqual({
      team: "deposits",
      person: "alex",
      action: "templates",
      template: "UC-4F7K2Q",
    });
    expect(parseAuditFilters({})).toEqual({});
    expect(
      parseAuditFilters({ team: "", person: ",,", action: undefined }),
    ).toEqual({});
  });

  it("folds a stage's approval to Approved, dedupes, and swaps a reversed range", () => {
    expect(
      parseAuditFilters({
        action:
          "version.stage_approved,version.approved,version.revoked,version.revoked",
      }),
    ).toEqual({
      action: "version.approved,version.revoked",
    });
    expect(parseAuditFilters({ from: "2026-10-05", to: "2026-09-01" })).toEqual(
      { from: "2026-09-01", to: "2026-10-05" },
    );
  });

  it("is what auditQuery writes, read back", () => {
    const f: AuditFilters = {
      team: "coral-offers,deposits",
      person: "alex",
      action: "access",
      template: "UC-4F7K2Q",
      from: "2026-09-06",
      to: "2026-10-05",
    };
    const q = auditQuery(f);
    expect(q).toBe(
      "?team=coral-offers,deposits&person=alex&action=access&template=UC-4F7K2Q&from=2026-09-06&to=2026-10-05",
    );
    const params = Object.fromEntries(new URLSearchParams(q.slice(1)));
    expect(parseAuditFilters(params)).toEqual(f);
    expect(auditQuery({})).toBe("");
  });

  it("checks days for real", () => {
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-1-01")).toBe(false);
  });
});

describe("filter helpers", () => {
  it("toggles values in and out of a list, and counts chips", () => {
    let f: AuditFilters = {};
    f = toggleFilterValue(f, "person", "alex");
    f = toggleFilterValue(f, "person", "sam");
    expect(filterValues(f, "person")).toEqual(["alex", "sam"]);
    f = toggleFilterValue(f, "person", "alex");
    expect(f).toEqual({ person: "sam" });
    f = toggleFilterValue(f, "person", "sam");
    expect(f).toEqual({});
    expect(
      activeFilterCount({
        person: "alex,sam",
        action: "access",
        from: "2026-09-01",
        to: "2026-10-01",
      }),
    ).toBe(4);
  });

  it("labels date ranges and the 7/30/90-day presets on the demo clock, today included", () => {
    expect(datePresets("2026-10-05")).toEqual([
      { days: 7, label: "Last 7 days", from: "2026-09-29", to: "2026-10-05" },
      { days: 30, label: "Last 30 days", from: "2026-09-06", to: "2026-10-05" },
      { days: 90, label: "Last 90 days", from: "2026-07-08", to: "2026-10-05" },
    ]);
    expect(dateRangeLabel("2026-09-06", "2026-10-05")).toBe(
      "Sep 6, 2026 – Oct 5, 2026",
    );
    expect(dateRangeLabel("2026-10-05", "2026-10-05")).toBe("Oct 5, 2026");
    expect(dateRangeLabel("2026-09-06")).toBe("From Sep 6, 2026");
    expect(dateRangeLabel(null, "2026-10-05")).toBe("Until Oct 5, 2026");
    expect(dateRangeLabel()).toBe("Any date");
    // Given the demo clock's day, its own year goes unsaid.
    expect(dateRangeLabel("2026-09-06", "2026-10-05", "2026-10-05")).toBe(
      "Sep 6 – Oct 5",
    );
    expect(dateRangeLabel("2025-12-06", "2026-01-05", "2026-01-05")).toBe(
      "Dec 6, 2025 – Jan 5",
    );
  });
});

describe("filtering rows", () => {
  const deposits = { slug: "deposits", name: "Deposits" };
  const cashBack = { id: "UC-4F7K2Q", name: "Cash Back" };
  const rows: AuditRow[] = [
    row({
      id: "1",
      at: "2026-10-05T09:00:00.000Z",
      action: "version.submitted",
      actor: maya,
      template: cashBack,
      versionLabel: "v3",
    }),
    row({
      id: "2",
      at: "2026-10-04T23:59:59.000Z",
      action: "version.activated",
      actor: alex,
      template: cashBack,
      versionLabel: "v2",
    }),
    row({
      id: "3",
      at: "2026-10-03T00:00:00.000Z",
      action: "version.sunset_passed",
      actor: null,
      template: cashBack,
      versionLabel: "v1",
    }),
    row({
      id: "4",
      at: "2026-10-02T12:00:00.000Z",
      action: "access.granted",
      actor: alex,
      subject: sam,
    }),
    row({
      id: "5",
      at: "2026-10-01T12:00:00.000Z",
      action: "access.lapsed",
      actor: null,
      subject: sam,
    }),
    row({
      id: "6",
      at: "2026-09-20T12:00:00.000Z",
      action: "access.granted",
      actor: riley,
      subject: alex,
      team: deposits,
    }),
    row({
      id: "7",
      at: "2026-09-10T12:00:00.000Z",
      action: "platform.config_changed",
      actor: riley,
      team: null,
    }),
    row({
      id: "8",
      at: "2026-09-01T12:00:00.000Z",
      action: "version.revoked",
      actor: alex,
      template: cashBack,
      versionLabel: "v1",
    }),
  ];
  const ids = (f: AuditFilters) => filterAuditRows(rows, f).map((r) => r.id);

  it("passes everything with no filters", () => {
    expect(ids({})).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("filters by team (a list, ORed); platform-wide events have no team", () => {
    expect(ids({ team: "deposits" })).toEqual(["6"]);
    expect(ids({ team: "coral-offers,deposits" })).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "8",
    ]);
  });

  it("filters by person: who acted or whom it is about; system for nobody", () => {
    expect(ids({ person: "sam" })).toEqual(["4", "5"]);
    expect(ids({ person: "alex" })).toEqual(["2", "4", "6", "8"]);
    expect(ids({ person: "system" })).toEqual(["3", "5"]);
    expect(ids({ person: "maya,riley" })).toEqual(["1", "6", "7"]);
  });

  it("filters by category or canonical action, final approvals included", () => {
    expect(ids({ action: "access" })).toEqual(["4", "5", "6"]);
    expect(ids({ action: "platform" })).toEqual(["7"]);
    expect(ids({ action: "version.approved" })).toEqual(["2"]);
    expect(ids({ action: "version.sunset_passed" })).toEqual(["3"]);
    expect(ids({ action: "version.revoked" })).toEqual(["8"]);
    expect(ids({ action: "platform,version.submitted" })).toEqual(["1", "7"]);
  });

  it("filters by template", () => {
    expect(ids({ template: "UC-4F7K2Q" })).toEqual(["1", "2", "3", "8"]);
  });

  it("filters by demo-clock day, both ends inclusive", () => {
    expect(ids({ from: "2026-10-04" })).toEqual(["1", "2"]);
    expect(ids({ to: "2026-10-03" })).toEqual(["3", "4", "5", "6", "7", "8"]);
    expect(ids({ from: "2026-10-03", to: "2026-10-04" })).toEqual(["2", "3"]);
    expect(ids({ from: "2026-10-03", to: "2026-10-03" })).toEqual(["3"]);
  });

  it("ANDs the fields together", () => {
    expect(
      ids({ team: "coral-offers", person: "alex", action: "templates" }),
    ).toEqual(["2", "8"]);
    expect(
      ids({ person: "sam", action: "access", from: "2026-10-02" }),
    ).toEqual(["4"]);
    expect(ids({ team: "deposits", template: "UC-4F7K2Q" })).toEqual([]);
    expect(
      ids({
        person: "system",
        action: "templates",
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).toEqual(["3"]);
  });

  it("counts each menu under every OTHER filter", () => {
    const counts = auditFacetCounts(rows, {
      team: "coral-offers",
      action: "access",
    });
    // Team counts ignore the team filter (Deposits still shows its access event).
    expect(counts.team).toEqual({ "coral-offers": 2, deposits: 1 });
    // Action counts ignore the action filter but keep the team filter.
    expect(counts.action).toMatchObject({
      templates: 4,
      access: 2,
      "access.granted": 1,
      "access.lapsed": 1,
      "version.approved": 1,
    });
    expect(counts.action.platform).toBeUndefined();
    // Person counts keep both: Alex granted, Sam was granted and lapsed, the system lapsed him.
    expect(counts.person).toEqual({ alex: 1, sam: 2, system: 1 });
    expect(counts.template).toEqual({});
  });
});

// ── CSV ─────────────────────────────────────────────────────

describe("toCsv", () => {
  const tricky =
    'Wrong APR, "15.99%" in legal notices\nSee line two\r\nand three';
  const rows: AuditRow[] = [
    row({
      id: "1",
      at: "2026-10-05T09:00:00.000Z",
      action: "version.revoke_started",
      actor: { ...alex, name: 'Alex "AK" Kim' },
      template: { id: "UC-4F7K2Q", name: "Cash Back, Terms" },
      versionLabel: "v2",
      summary: tricky,
    }),
    row({
      id: "2",
      at: "2026-10-04T08:00:00.000Z",
      action: "access.lapsed",
      actor: null,
      summary: "Sam Ortiz's access lapsed.",
    }),
    row({
      id: "3",
      at: "2026-10-03T08:00:00.000Z",
      action: "platform.config_changed",
      actor: riley,
      team: null,
      summary: '=HYPERLINK("x")',
    }),
  ];

  it("writes the header and one line per row, CRLF line ends", () => {
    const csv = toCsv(rows);
    expect(
      csv.startsWith("When,Who,Team,Template,Version,Action,Details\r\n"),
    ).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(parseCsv(csv)).toHaveLength(4);
    expect(toCsv([])).toBe("When,Who,Team,Template,Version,Action,Details\r\n");
  });

  it("round-trips commas, quotes and line breaks", () => {
    const [, first, second, third] = parseCsv(toCsv(rows));
    expect(first).toEqual([
      "2026-10-05T09:00:00.000Z",
      'Alex "AK" Kim',
      "Coral Offers",
      "Cash Back, Terms (UC-4F7K2Q)",
      "v2",
      "Revoke started",
      tricky,
    ]);
    expect(second).toEqual([
      "2026-10-04T08:00:00.000Z",
      "Stencil",
      "Coral Offers",
      "",
      "",
      "Access lapsed",
      "Sam Ortiz's access lapsed.",
    ]);
    expect(third![2]).toBe("All teams");
  });

  it("writes the version as the row labels it, the round included", () => {
    const round = row({
      id: "4",
      at: "2026-10-02T08:00:00.000Z",
      action: "version.submitted",
      actor: maya,
      template: { id: "UC-4F7K2Q", name: "Cash Back" },
      versionLabel: "v3 · Round 1",
      summary: "Maya Chen submitted v3, round 1 for review.",
    });
    const [, line] = parseCsv(toCsv([round]));
    expect(line![4]).toBe("v3 · Round 1");
  });

  it("quotes only when needed, and defuses spreadsheet formulas", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(" padded")).toBe('" padded"');
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it("is the contract's toCsv", () => {
    expect(auditDomain.toCsv(rows)).toBe(toCsv(rows));
  });
});
