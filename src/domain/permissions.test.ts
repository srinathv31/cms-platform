import { describe, expect, it } from "vitest";
import {
  ALL_SPACE,
  PermissionError,
  REASONS,
  assertCan,
  can,
  canSeeSpace,
  defaultSpace,
  isCrossTeam,
  rolesOn,
  spacesFor,
} from "./permissions";
import type {
  Action,
  MembershipStatus,
  PermissionResource,
  PlatformRole,
  TeamRole,
  Viewer,
  ViewerMembership,
} from "./types";

// ── Fixtures ──────────────────────────────────────────────────

const TEAMS = {
  "coral-offers": "Coral Offers",
  deposits: "Deposits",
  "card-statements": "Card Statements",
} as const;
type TeamSlug = keyof typeof TEAMS;

const GENERIC = "You don't have access to do this.";
const OWN_VERSION = "You submitted this version.";
const OWN_REVOKE = "You started this revoke. Another approver must confirm it.";
const OWN_REQUEST = "You can't decide your own access request.";

function member(
  team: TeamSlug,
  roles: TeamRole[],
  status: MembershipStatus = "active",
): ViewerMembership {
  return { teamId: team, teamSlug: team, teamName: TEAMS[team], roles, status };
}

function person(
  userId: string,
  opts: { platformRole?: PlatformRole; memberships?: ViewerMembership[] } = {},
): Viewer {
  return {
    userId,
    name: userId,
    initials: userId.slice(0, 2).toUpperCase(),
    title: "",
    platformRole: opts.platformRole ?? null,
    memberships: opts.memberships ?? [],
  };
}

// Seed personas (build plan, "Seed personas").
const maya = person("maya", { memberships: [member("coral-offers", ["author"])] });
const jordan = person("jordan", { memberships: [member("coral-offers", ["approver"])] });
const alex = person("alex", { memberships: [member("coral-offers", ["team_admin", "approver"])] });
const priya = person("priya", {
  memberships: [member("coral-offers", ["author"]), member("deposits", ["viewer"])],
});
const sam = person("sam", { memberships: [member("coral-offers", ["viewer"])] });
const riley = person("riley", { platformRole: "platform_admin" });
const taylor = person("taylor", { platformRole: "auditor" });
const morgan = person("morgan");

const coral = { teamId: "coral-offers" } satisfies PermissionResource;
const deposits = { teamId: "deposits" } satisfies PermissionResource;
const cardStatements = { teamId: "card-statements" } satisfies PermissionResource;
const allTeams = { teamId: ALL_SPACE } satisfies PermissionResource;

const allow = { ok: true };
const deny = (reason: string) => ({ ok: false, reason });

// ── The permission matrix ─────────────────────────────────────
// A literal copy of the build plan's matrix. The last row ("Anyone") spans every column.

type Column = "viewer" | "author" | "approver" | "team_admin" | "platform_admin" | "auditor";

const MATRIX: { row: string; actions: Action[]; cells: Record<Column, string> }[] = [
  {
    row: "View team templates and versions",
    actions: ["template.view"],
    cells: { viewer: "Yes", author: "Yes", approver: "Yes", team_admin: "Yes", platform_admin: "All teams", auditor: "All teams" },
  },
  {
    row: "Create, edit, import, manage variables",
    actions: ["template.create", "draft.edit"],
    cells: { viewer: "—", author: "Yes", approver: "—", team_admin: "—", platform_admin: "—", auditor: "—" },
  },
  {
    row: "Submit for review",
    actions: ["version.submit"],
    cells: { viewer: "—", author: "Yes", approver: "—", team_admin: "—", platform_admin: "—", auditor: "—" },
  },
  {
    row: "Comment during review",
    actions: ["review.comment"],
    cells: { viewer: "—", author: "Yes", approver: "Yes", team_admin: "—", platform_admin: "—", auditor: "—" },
  },
  {
    row: "Approve or request changes",
    actions: ["version.decide"],
    cells: { viewer: "—", author: "—", approver: "Yes, never on a version they authored", team_admin: "—", platform_admin: "—", auditor: "—" },
  },
  {
    row: "Set sunset date",
    actions: ["version.setSunset"],
    cells: { viewer: "—", author: "—", approver: "Yes", team_admin: "—", platform_admin: "—", auditor: "—" },
  },
  {
    row: "Revoke",
    actions: ["version.revoke.start", "version.revoke.confirm"],
    cells: { viewer: "—", author: "—", approver: "Start or confirm; confirmer must be a different approver", team_admin: "—", platform_admin: "—", auditor: "—" },
  },
  {
    row: "Use integration panel",
    actions: ["integration.view"],
    cells: { viewer: "Yes", author: "Yes", approver: "Yes", team_admin: "Yes", platform_admin: "Yes", auditor: "Yes" },
  },
  {
    row: "Manage members, access requests, recertification",
    actions: ["team.manageMembers", "team.decideAccessRequest"],
    cells: { viewer: "—", author: "—", approver: "—", team_admin: "Yes, never their own request", platform_admin: "—", auditor: "—" },
  },
  {
    row: "Manage teams, content types, channel rules, approval chains",
    actions: ["platform.manage"],
    cells: { viewer: "—", author: "—", approver: "—", team_admin: "—", platform_admin: "Yes", auditor: "—" },
  },
  {
    row: "View audit log",
    actions: ["audit.view"],
    cells: { viewer: "—", author: "—", approver: "—", team_admin: "Own team", platform_admin: "All teams", auditor: "All teams" },
  },
  {
    row: "Request access to a team",
    actions: ["access.request"],
    cells: { viewer: "Anyone", author: "Anyone", approver: "Anyone", team_admin: "Anyone", platform_admin: "Anyone", auditor: "Anyone" },
  },
];

/** One holder per column. Team roles sit on Coral Offers; platform roles have no team. */
const HOLDERS: Record<Column, Viewer> = {
  viewer: person("u-viewer", { memberships: [member("coral-offers", ["viewer"])] }),
  author: person("u-author", { memberships: [member("coral-offers", ["author"])] }),
  approver: person("u-approver", { memberships: [member("coral-offers", ["approver"])] }),
  team_admin: person("u-admin", { memberships: [member("coral-offers", ["team_admin"])] }),
  platform_admin: person("u-platform", { platformRole: "platform_admin" }),
  auditor: person("u-auditor", { platformRole: "auditor" }),
};

/** Where each cell is checked: the holder's team, another team, and the cross-team contexts. */
const CONTEXTS = {
  "own team": coral,
  "other team": deposits,
  '"All teams"': allTeams,
  "no team": { teamId: null },
} satisfies Record<string, PermissionResource>;
type Context = keyof typeof CONTEXTS;

const isPlatform = (c: Column) => c === "platform_admin" || c === "auditor";

function expectedIn(column: Column, cell: string): Record<Context, boolean> {
  const everywhere = { "own team": true, "other team": true, '"All teams"': true, "no team": true };
  if (cell === "—") return { "own team": false, "other team": false, '"All teams"': false, "no team": false };
  if (cell === "Anyone" || cell === "All teams") return everywhere;
  if (isPlatform(column)) return everywhere; // a cross-team "Yes" is not tied to a team
  return { "own team": true, "other team": false, '"All teams"': false, "no team": false };
}

/** The qualified cells: allowed, except on the holder's own item. */
const SELF_RULES: Record<string, { action: Action; field: keyof PermissionResource; reason: string }> = {
  "Yes, never on a version they authored": { action: "version.decide", field: "submittedBy", reason: OWN_VERSION },
  "Start or confirm; confirmer must be a different approver": { action: "version.revoke.confirm", field: "revokeStartedBy", reason: OWN_REVOKE },
  "Yes, never their own request": { action: "team.decideAccessRequest", field: "requesterId", reason: OWN_REQUEST },
};

const CASES = MATRIX.flatMap(({ row, actions, cells }) =>
  actions.flatMap((action) =>
    (Object.keys(cells) as Column[]).map((column) => ({ row, action, column, cell: cells[column] })),
  ),
);

describe("permission matrix (build plan)", () => {
  it.each(CASES)("$row · $column ($cell) · $action", ({ action, column, cell }) => {
    const viewer = HOLDERS[column];
    const expected = expectedIn(column, cell);
    for (const [context, resource] of Object.entries(CONTEXTS) as [Context, PermissionResource][]) {
      expect(can(viewer, action, resource), context).toEqual(expected[context] ? allow : deny(GENERIC));
    }
  });

  const guarded = CASES.filter((c) => SELF_RULES[c.cell]?.action === c.action);

  it("covers every qualified cell", () => {
    expect(guarded.map((c) => c.action).sort()).toEqual(
      ["team.decideAccessRequest", "version.decide", "version.revoke.confirm"],
    );
  });

  it.each(guarded)("$row · $column · blocked on their own item ($action)", ({ action, column, cell }) => {
    const viewer = HOLDERS[column];
    const { field, reason } = SELF_RULES[cell];
    expect(can(viewer, action, { ...coral, [field]: viewer.userId })).toEqual(deny(reason));
    expect(can(viewer, action, { ...coral, [field]: "someone-else" })).toEqual(allow);
  });

  it("covers every action in the Action union", () => {
    const covered = new Set(MATRIX.flatMap((r) => r.actions));
    const all: Record<Action, true> = {
      "template.view": true,
      "template.create": true,
      "draft.edit": true,
      "version.submit": true,
      "review.comment": true,
      "version.decide": true,
      "version.setSunset": true,
      "version.revoke.start": true,
      "version.revoke.confirm": true,
      "integration.view": true,
      "team.manageMembers": true,
      "team.decideAccessRequest": true,
      "platform.manage": true,
      "audit.view": true,
      "access.request": true,
    };
    expect([...covered].sort()).toEqual(Object.keys(all).sort());
  });

  it("explains a self-block to anyone on the team, even without the role", () => {
    // Scenario 3.1: Maya sees Approve disabled with "You submitted this version."
    expect(can(maya, "version.decide", { ...coral, submittedBy: "maya" })).toEqual(deny(OWN_VERSION));
    expect(can(maya, "version.decide", { ...coral, submittedBy: "jordan" })).toEqual(deny(GENERIC));
  });

  it("gives outsiders the generic reason, never the self-block wording", () => {
    expect(can(morgan, "version.decide", { ...coral, submittedBy: "morgan" })).toEqual(deny(GENERIC));
    expect(can(morgan, "team.decideAccessRequest", { ...coral, requesterId: "morgan" })).toEqual(deny(GENERIC));
  });
});

// ── Behavior rules and seed personas ──────────────────────────

describe("maker-checker", () => {
  it("Jordan cannot decide a version he submitted", () => {
    expect(can(jordan, "version.decide", { ...coral, submittedBy: "jordan" })).toEqual(deny(OWN_VERSION));
  });

  it("Alex can decide the version Jordan submitted", () => {
    expect(can(alex, "version.decide", { ...coral, submittedBy: "jordan" })).toEqual(allow);
  });

  it("Jordan can decide Maya's version; Maya cannot decide anything", () => {
    expect(can(jordan, "version.decide", { ...coral, submittedBy: "maya" })).toEqual(allow);
    expect(can(maya, "version.decide", { ...coral, submittedBy: "jordan" }).ok).toBe(false);
  });
});

describe("two-person revoke", () => {
  it("Jordan starts, cannot confirm his own; Alex confirms", () => {
    expect(can(jordan, "version.revoke.start", coral)).toEqual(allow);
    expect(can(jordan, "version.revoke.confirm", { ...coral, revokeStartedBy: "jordan" })).toEqual(deny(OWN_REVOKE));
    expect(can(alex, "version.revoke.confirm", { ...coral, revokeStartedBy: "jordan" })).toEqual(allow);
  });

  it("authors and viewers cannot start or confirm", () => {
    for (const v of [maya, sam, riley, taylor]) {
      expect(can(v, "version.revoke.start", coral).ok).toBe(false);
      expect(can(v, "version.revoke.confirm", { ...coral, revokeStartedBy: "jordan" }).ok).toBe(false);
    }
  });
});

describe("access requests", () => {
  it("a Team Admin cannot decide their own request", () => {
    expect(can(alex, "team.decideAccessRequest", { ...coral, requesterId: "alex" })).toEqual(deny(OWN_REQUEST));
    expect(can(alex, "team.decideAccessRequest", { ...coral, requesterId: "morgan" })).toEqual(allow);
  });

  it("only on the team they administer", () => {
    expect(can(alex, "team.decideAccessRequest", { ...deposits, requesterId: "morgan" })).toEqual(deny(GENERIC));
    expect(can(alex, "team.manageMembers", deposits)).toEqual(deny(GENERIC));
    expect(can(riley, "team.manageMembers", coral)).toEqual(deny(GENERIC));
  });

  it("anyone may request access, including Morgan", () => {
    for (const v of [maya, jordan, alex, priya, sam, riley, taylor, morgan]) {
      expect(can(v, "access.request", deposits)).toEqual(allow);
    }
  });
});

describe("own access (Phase 6)", () => {
  const OWN_ACCESS = "You can't change your own access.";

  it("a Team Admin manages other members, never their own membership", () => {
    expect(can(alex, "team.manageMembers", { ...coral, subjectUserId: "jordan" })).toEqual(allow);
    expect(can(alex, "team.manageMembers", { ...coral, subjectUserId: "alex" })).toEqual(deny(OWN_ACCESS));
    expect(REASONS.ownAccess).toBe(OWN_ACCESS);
  });

  it("without a subject it is the plain settings-access check", () => {
    expect(can(alex, "team.manageMembers", coral)).toEqual(allow);
    expect(can(jordan, "team.manageMembers", coral)).toEqual(deny(GENERIC));
  });

  it("a member without the role gets the generic reason for someone else", () => {
    expect(can(jordan, "team.manageMembers", { ...coral, subjectUserId: "maya" })).toEqual(deny(GENERIC));
  });
});

describe("named approvers (a stage that names a user)", () => {
  // Dana Park: Coral Offers Viewer, named by the "Legal reviewer" stage.
  const dana = person("dana", { memberships: [member("coral-offers", ["viewer"])] });
  const legal = { ...coral, submittedBy: "maya", stageApproverIds: ["dana"] } satisfies PermissionResource;

  it("may decide and comment on the version waiting on her stage", () => {
    expect(can(dana, "version.decide", legal)).toEqual(allow);
    expect(can(dana, "review.comment", legal)).toEqual(allow);
  });

  it("gets nothing else from it", () => {
    for (const action of ["draft.edit", "version.submit", "version.setSunset", "version.revoke.start"] as Action[]) {
      expect(can(dana, action, legal)).toEqual(deny(GENERIC));
    }
  });

  it("only while the current stage names her", () => {
    expect(can(dana, "version.decide", { ...coral, submittedBy: "maya" })).toEqual(deny(GENERIC));
    expect(can(dana, "version.decide", { ...coral, submittedBy: "maya", stageApproverIds: ["jordan"] })).toEqual(
      deny(GENERIC),
    );
  });

  it("on any team, with no membership there (a Legal stage covers every team)", () => {
    const depositsLegal = { ...deposits, submittedBy: "eli", stageApproverIds: ["dana"] } satisfies PermissionResource;
    expect(can(dana, "template.view", depositsLegal)).toEqual(allow);
    expect(can(dana, "version.decide", depositsLegal)).toEqual(allow);
    expect(can(dana, "review.comment", depositsLegal)).toEqual(allow);
    expect(can(dana, "template.view", deposits)).toEqual(deny(GENERIC));
  });

  it("not once she has no active access anywhere", () => {
    const suspended = person("dana", { memberships: [member("coral-offers", ["viewer"], "suspended")] });
    expect(can(suspended, "version.decide", legal)).toEqual(deny(GENERIC));
    expect(can(person("dana"), "version.decide", legal)).toEqual(deny(GENERIC));
  });

  it("maker-checker still applies", () => {
    expect(can(dana, "version.decide", { ...legal, submittedBy: "dana" })).toEqual(deny(OWN_VERSION));
  });

  it("an Auditor named on a stage stays read-only", () => {
    const taylor = person("taylor", { platformRole: "auditor" });
    const named = { ...legal, stageApproverIds: ["taylor"] };
    expect(can(taylor, "version.decide", named)).toEqual(deny(GENERIC));
    expect(can(taylor, "review.comment", named)).toEqual(deny(GENERIC));
    expect(can(taylor, "template.view", named)).toEqual(allow); // an Auditor sees every team anyway
  });
});

describe("membership status", () => {
  it.each<MembershipStatus>(["suspended", "lapsed"])("a %s membership grants nothing", (status) => {
    const v = person("maya", { memberships: [member("coral-offers", ["author", "approver"], status)] });
    expect(rolesOn(v, "coral-offers")).toEqual([]);
    for (const action of ["template.view", "draft.edit", "version.decide", "integration.view"] as Action[]) {
      expect(can(v, action, coral)).toEqual(deny(GENERIC));
    }
    expect(spacesFor(v)).toEqual([]);
    expect(defaultSpace(v)).toBeNull();
    expect(canSeeSpace(v, "coral-offers")).toBe(false);
    expect(can(v, "access.request", coral)).toEqual(allow);
  });

  it("a lapsed team does not affect the viewer's other teams", () => {
    const v = person("priya", {
      memberships: [member("coral-offers", ["author"]), member("deposits", ["viewer"], "lapsed")],
    });
    expect(can(v, "draft.edit", coral)).toEqual(allow);
    expect(can(v, "template.view", deposits)).toEqual(deny(GENERIC));
    expect(spacesFor(v).map((s) => s.slug)).toEqual(["coral-offers"]);
  });
});

describe("personas", () => {
  it("Maya authors in Coral Offers only", () => {
    for (const action of ["template.create", "draft.edit", "version.submit", "review.comment"] as Action[]) {
      expect(can(maya, action, coral)).toEqual(allow);
    }
    expect(can(maya, "template.view", deposits).ok).toBe(false);
    expect(can(maya, "audit.view", coral).ok).toBe(false);
  });

  it("Priya edits in Coral but is view-only in Deposits", () => {
    expect(rolesOn(priya, "deposits")).toEqual(["viewer"]);
    expect(can(priya, "draft.edit", coral)).toEqual(allow);
    expect(can(priya, "template.view", deposits)).toEqual(allow);
    expect(can(priya, "integration.view", deposits)).toEqual(allow);
    for (const action of ["template.create", "draft.edit", "version.submit", "review.comment"] as Action[]) {
      expect(can(priya, action, deposits)).toEqual(deny(GENERIC));
    }
    expect(can(priya, "template.view", cardStatements).ok).toBe(false);
  });

  it("Sam reads and uses the integration panel, nothing more", () => {
    expect(can(sam, "template.view", coral)).toEqual(allow);
    expect(can(sam, "integration.view", coral)).toEqual(allow);
    for (const action of ["draft.edit", "review.comment", "version.decide", "version.setSunset"] as Action[]) {
      expect(can(sam, action, coral).ok).toBe(false);
    }
  });

  it("Alex is Team Admin and Approver on Coral", () => {
    expect([...rolesOn(alex, "coral-offers")].sort()).toEqual(["approver", "team_admin"]);
    expect(rolesOn(alex, "deposits")).toEqual([]);
    expect(can(alex, "audit.view", coral)).toEqual(allow);
    expect(can(alex, "audit.view", deposits).ok).toBe(false);
    expect(can(alex, "audit.view", allTeams).ok).toBe(false);
    expect(can(alex, "draft.edit", coral).ok).toBe(false);
  });

  it("Riley can view Card Statements but not edit", () => {
    expect(can(riley, "template.view", cardStatements)).toEqual(allow);
    expect(can(riley, "integration.view", cardStatements)).toEqual(allow);
    for (const action of ["template.create", "draft.edit", "version.submit", "review.comment", "version.decide"] as Action[]) {
      expect(can(riley, action, cardStatements)).toEqual(deny(GENERIC));
    }
    expect(can(riley, "platform.manage")).toEqual(allow);
    expect(can(riley, "audit.view", allTeams)).toEqual(allow);
  });

  it("Taylor views every team and the audit log everywhere, changes nothing", () => {
    for (const r of [coral, deposits, cardStatements, allTeams]) {
      expect(can(taylor, "template.view", r)).toEqual(allow);
      expect(can(taylor, "audit.view", r)).toEqual(allow);
      expect(can(taylor, "draft.edit", r).ok).toBe(false);
      expect(can(taylor, "version.decide", r).ok).toBe(false);
    }
    expect(can(taylor, "audit.view")).toEqual(allow);
    expect(can(taylor, "platform.manage").ok).toBe(false);
    expect(can(taylor, "team.manageMembers", coral).ok).toBe(false);
  });

  it("Morgan has no team and sees no spaces", () => {
    expect(spacesFor(morgan)).toEqual([]);
    expect(defaultSpace(morgan)).toBeNull();
    for (const slug of [...Object.keys(TEAMS), ALL_SPACE]) expect(canSeeSpace(morgan, slug)).toBe(false);
    expect(can(morgan, "template.view", coral).ok).toBe(false);
  });

  it('"all" and a missing team are the same cross-team context', () => {
    for (const r of [allTeams, { teamId: null }, {}]) {
      expect(can(maya, "template.view", r).ok).toBe(false);
      expect(can(taylor, "template.view", r).ok).toBe(true);
    }
    expect(can(maya, "template.view").ok).toBe(false);
  });
});

describe("spaces", () => {
  it("isCrossTeam is true only for Platform Admin and Auditor", () => {
    expect([maya, jordan, alex, priya, sam, riley, taylor, morgan].filter(isCrossTeam)).toEqual([riley, taylor]);
  });

  it('puts "All teams" first for cross-team viewers', () => {
    const all = { slug: "all", name: "All teams", kind: "all" };
    expect(spacesFor(riley)).toEqual([all]);
    expect(spacesFor(taylor)).toEqual([all]);
    const teams = [
      { slug: "deposits", name: "Deposits" },
      { slug: "coral-offers", name: "Coral Offers" },
      { slug: "card-statements", name: "Card Statements" },
    ];
    expect(spacesFor(taylor, teams).map((s) => s.slug)).toEqual(["all", "card-statements", "coral-offers", "deposits"]);
  });

  it("lists a member's active teams by name, whatever the membership order", () => {
    const reversed = { ...priya, memberships: [...priya.memberships].reverse() };
    const expected = [
      { slug: "coral-offers", name: "Coral Offers", kind: "team" },
      { slug: "deposits", name: "Deposits", kind: "team" },
    ];
    expect(spacesFor(priya)).toEqual(expected);
    expect(spacesFor(reversed)).toEqual(expected);
    expect(spacesFor(priya, [{ slug: "card-statements", name: "Card Statements" }])).toEqual(expected);
  });

  it("defaults to the first space", () => {
    expect(defaultSpace(maya)).toBe("coral-offers");
    expect(defaultSpace(priya)).toBe("coral-offers");
    expect(defaultSpace(riley)).toBe(ALL_SPACE);
    expect(defaultSpace(taylor)).toBe(ALL_SPACE);
    expect(defaultSpace(morgan)).toBeNull();
  });

  it("canSeeSpace follows membership, and every space for cross-team viewers", () => {
    expect(canSeeSpace(priya, "deposits")).toBe(true);
    expect(canSeeSpace(priya, "card-statements")).toBe(false);
    expect(canSeeSpace(maya, ALL_SPACE)).toBe(false);
    expect(canSeeSpace(riley, "card-statements")).toBe(true);
    expect(canSeeSpace(taylor, ALL_SPACE)).toBe(true);
  });
});

describe("assertCan", () => {
  it("throws a PermissionError carrying the reason", () => {
    let error: unknown;
    try {
      assertCan(jordan, "version.decide", { ...coral, submittedBy: "jordan" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PermissionError);
    expect(error).toMatchObject({ reason: OWN_VERSION, action: "version.decide", message: OWN_VERSION });
  });

  it("returns quietly when allowed", () => {
    expect(() => assertCan(maya, "draft.edit", coral)).not.toThrow();
  });

  it("keeps every reason short and plain, ending with a period", () => {
    for (const reason of Object.values(REASONS)) expect(reason).toMatch(/^[A-Z][^.]{0,60}\.( [A-Z][^.]{0,60}\.)?$/);
  });
});
