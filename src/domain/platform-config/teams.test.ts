import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeNotification } from "../notifications";
import { describeConfigChange } from "./effects";
import { PLATFORM_REFUSALS } from "./refusals";
import { RESERVED_SLUGS } from "./limits";
import {
  cannotBeFirstTeamAdmin,
  createTeam,
  newTeamConsequences,
  slugify,
  validateNewTeam,
} from "./teams";
import { NOW, riley, alex } from "./fixtures";

const alexAdmin = { ...alex, platformRole: null };
const taylorAuditor = {
  id: "taylor",
  name: "Taylor Nguyen",
  platformRole: "auditor" as const,
};

const EXISTING = [
  { slug: "coral-offers", name: "Coral Offers" },
  { slug: "deposits", name: "Deposits" },
];

describe("slugify", () => {
  it.each([
    ["Coral Offers", "coral-offers"],
    ["  Café & Co.  ", "cafe-co"],
    ["Home Loans 2027", "home-loans-2027"],
    ["***", ""],
  ])("%s → %s", (name, slug) => expect(slugify(name)).toBe(slug));
});

describe("createTeam", () => {
  const run = (over: Partial<Parameters<typeof createTeam>[0]> = {}) =>
    createTeam({
      id: "t_home",
      name: "Home Loans",
      description: "Mortgage disclosures.",
      icon: "home",
      admin: alexAdmin,
      actor: riley,
      now: NOW,
      existing: EXISTING,
      ...over,
    });

  it("creates the team under the id it is given (never its slug) with its first Team Admin, records it and tells the admin", () => {
    const result = run();
    expect(result).toEqual({
      ok: true,
      team: {
        id: "t_home",
        slug: "home-loans",
        name: "Home Loans",
        description: "Mortgage disclosures.",
        icon: "home",
        createdAt: NOW,
      },
      membership: {
        kind: "insert",
        membership: {
          userId: "alex",
          teamId: "t_home",
          roles: ["team_admin"],
          addedAt: NOW,
          addedBy: "riley",
        },
      },
      effects: [
        {
          kind: "audit",
          action: "platform.config_changed",
          teamId: "t_home",
          details: {
            area: "teams",
            teamName: "Home Loans",
            slug: "home-loans",
            userId: "alex",
            userName: "Alex Kim",
          },
        },
        {
          kind: "audit",
          action: "access.granted",
          teamId: "t_home",
          details: {
            userId: "alex",
            userName: "Alex Kim",
            role: "team_admin",
            roles: ["team_admin"],
            appointed: true,
          },
        },
        {
          kind: "notification",
          notification: "team_admin_appointed",
          to: { kind: "user", userId: "alex" },
          teamId: "t_home",
          facts: { actorName: "Riley Brooks", teamName: "Home Loans" },
          link: { to: "settings", teamId: "t_home", section: "members" },
        },
      ],
    });
    // Both are worded when they are read: the audit row on the Audit page, the notification in the bell.
    const [created, , appointed] = result.ok ? result.effects : [];
    expect(
      created?.kind === "audit" && describeConfigChange(created.details),
    ).toBe("created team Home Loans with Alex Kim as Team Admin");
    expect(
      appointed?.kind === "notification" &&
        describeNotification(appointed.notification, appointed.facts, "alex"),
    ).toEqual({
      title: "Riley Brooks made you Team Admin of Home Loans.",
      body: null,
    });
  });

  it("refuses an empty, long, reserved or taken name, a long description and an unknown icon", () => {
    expect(run({ name: "  " })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.teamName,
    });
    expect(run({ name: "x".repeat(61) })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.teamNameTooLong,
    });
    expect(run({ name: "All" })).toEqual({
      ok: false,
      code: "team_name_reserved",
      reason: '"All" can\'t be used as a team name.',
    });
    expect(run({ name: "!!!" })).toEqual({
      ok: false,
      code: "team_name_reserved",
      reason: '"!!!" can\'t be used as a team name.',
    });
    expect(run({ name: "coral offers" })).toEqual({
      ok: false,
      code: "team_name_taken",
      reason: "A team called Coral Offers already exists.",
    });
    expect(run({ name: "DEPOSITS" })).toEqual({
      ok: false,
      code: "team_name_taken",
      reason: "A team called Deposits already exists.",
    });
    expect(run({ description: "x".repeat(201) })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.descriptionTooLong,
    });
    expect(run({ icon: "skull" })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.icon,
    });
  });

  it("refuses an Auditor as the first Team Admin, before it looks at the team", () => {
    const refused = {
      ok: false,
      code: "auditor_cant_be_admin",
      reason: "Taylor Nguyen is an Auditor and can't be a Team Admin.",
    };
    expect(run({ admin: taylorAuditor })).toEqual(refused);
    expect(run({ admin: taylorAuditor, name: "  " })).toEqual(refused);
    expect(
      run({ admin: { ...alexAdmin, platformRole: "platform_admin" } }).ok,
    ).toBe(true);
  });

  it("cannotBeFirstTeamAdmin: an Auditor can't, anyone else can", () => {
    expect(cannotBeFirstTeamAdmin(taylorAuditor)).toEqual(
      PLATFORM_REFUSALS.auditorCantBeAdmin("Taylor Nguyen"),
    );
    expect(cannotBeFirstTeamAdmin(alexAdmin)).toBeNull();
    expect(
      cannotBeFirstTeamAdmin({ ...alex, platformRole: "platform_admin" }),
    ).toBeNull();
  });

  it("refuses a name whose slug is a top-level route", () => {
    for (const name of ["SIM", "api", "Request Access"])
      expect(run({ name })).toEqual({
        ok: false,
        code: "team_name_reserved",
        reason: `"${name}" can't be used as a team name.`,
      });
  });
});

/**
 * The URL segments at the root of an app folder, which a team's slug (`/[team]/…`) must not equal
 * (decision 0071): the folders directly under `dir`, looking through route groups "(x)", which add no
 * segment. Not segments: a dynamic folder "[x]" (the team itself is one), a private folder "_x", a
 * parallel-route slot "@x", and an intercepting route "(.)x", which shows an existing route in place.
 * Files are not segments either: a file route (favicon.ico, robots.txt) has an extension, and a slug
 * has no dot.
 */
function rootSegments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      if (/^\((?!\.)[^)]*\)$/.test(entry.name))
        return rootSegments(join(dir, entry.name));
      if (/^[[_@(]/.test(entry.name)) return [];
      return [entry.name];
    });
}

describe("RESERVED_SLUGS holds every top-level URL segment, read from the folders (decision 0071)", () => {
  const root = process.cwd();

  it("reads a folder tree the way Next.js routes it", () => {
    const dir = mkdtempSync(join(tmpdir(), "segments-"));
    try {
      for (const path of [
        "(product)/[team]/templates",
        "(product)/request-access",
        "(product)/(nested)/pricing",
        "(.)modal/inner",
        "(simulator)/sim/customers",
        "_private/hidden",
        "@slot/panel",
        "api/v1",
        "[team]",
      ])
        mkdirSync(join(dir, path), { recursive: true });
      writeFileSync(join(dir, "favicon.ico"), "");
      expect(rootSegments(dir).sort()).toEqual([
        "api",
        "pricing",
        "request-access",
        "sim",
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("finds the segments of every route group under src/app, and api", () => {
    expect(rootSegments(join(root, "src/app"))).toEqual(
      expect.arrayContaining([
        "api",
        "sim",
        "request-access",
        "editor-lab",
        "pdf-lab",
        "logo-lab",
      ]),
    );
  });

  it("reserves every top-level segment under src/app (product, simulator, dev, api)", () => {
    const segments = rootSegments(join(root, "src/app"));
    expect(segments.filter((s) => !RESERVED_SLUGS.has(s))).toEqual([]);
  });

  it("reserves every top-level folder or extensionless file under public/", () => {
    const publicNames = existsSync(join(root, "public"))
      ? readdirSync(join(root, "public")).filter((name) => !name.includes("."))
      : [];
    expect(publicNames.filter((s) => !RESERVED_SLUGS.has(s))).toEqual([]);
  });
});

describe("validateNewTeam (the Create team form, as the admin types)", () => {
  const check = (over: Partial<Parameters<typeof validateNewTeam>[0]> = {}) =>
    validateNewTeam({
      name: "Home Loans",
      description: "Mortgage disclosures.",
      icon: "home",
      existing: EXISTING,
      ...over,
    });

  it("tidies what was typed and finds nothing wrong with a new team", () => {
    expect(
      check({ name: "  Home   Loans ", description: " Mortgages. " }),
    ).toEqual({
      name: "Home Loans",
      description: "Mortgages.",
      slug: "home-loans",
      problem: null,
    });
  });

  it("gives the reason createTeam refuses with, in the same order", () => {
    const cases: { name?: string; description?: string; icon?: string }[] = [
      { name: " " },
      { name: "x".repeat(61) },
      { description: "x".repeat(201) },
      { icon: "skull" },
      { name: "All" },
      { name: "coral offers" },
      // A reserved name and a long description: the description is said first, as the server does.
      { name: "Sim", description: "x".repeat(201) },
    ];
    for (const over of cases) {
      const { problem } = check(over);
      expect(problem).not.toBeNull();
      const created = createTeam({
        id: "t_home",
        name: "Home Loans",
        description: "",
        icon: "home",
        admin: alexAdmin,
        actor: riley,
        now: NOW,
        existing: EXISTING,
        ...over,
      });
      expect(created).toEqual({ ok: false, ...problem });
    }
    expect(check({ name: "coral offers" }).problem).toEqual({
      code: "team_name_taken",
      reason: "A team called Coral Offers already exists.",
    });
    expect(check({ name: "Sim", description: "x".repeat(201) }).problem).toBe(
      PLATFORM_REFUSALS.descriptionTooLong,
    );
  });

  it("newTeamConsequences: who becomes Team Admin, and that it starts empty", () => {
    expect(newTeamConsequences("Home Loans", "Alex Kim")).toEqual([
      "Alex Kim becomes Team Admin of Home Loans and approves its access requests.",
      "Home Loans starts with no templates.",
    ]);
  });
});
