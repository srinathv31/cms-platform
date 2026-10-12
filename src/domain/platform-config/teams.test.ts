import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
      name: "Home Loans",
      description: "Mortgage disclosures.",
      icon: "home",
      admin: alexAdmin,
      actor: riley,
      now: NOW,
      existing: EXISTING,
      ...over,
    });

  it("creates the team (id = slug) with its first Team Admin, records it and tells the admin", () => {
    const result = run();
    expect(result).toEqual({
      ok: true,
      team: {
        id: "home-loans",
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
          teamId: "home-loans",
          roles: ["team_admin"],
          addedAt: NOW,
          addedBy: "riley",
        },
      },
      effects: [
        {
          kind: "audit",
          action: "platform.config_changed",
          teamId: "home-loans",
          details: {
            area: "teams",
            summary: "Created team Home Loans with Alex Kim as Team Admin",
            teamName: "Home Loans",
            slug: "home-loans",
            userId: "alex",
            userName: "Alex Kim",
          },
        },
        {
          kind: "audit",
          action: "access.granted",
          teamId: "home-loans",
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
          teamId: "home-loans",
          title: "Riley Brooks made you Team Admin of Home Loans.",
          link: { to: "settings", teamId: "home-loans", section: "members" },
        },
      ],
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

  it("refuses a name whose slug is a top-level route: every top-level segment under src/app is reserved", () => {
    expect(run({ name: "SIM" })).toEqual({
      ok: false,
      code: "team_name_reserved",
      reason: '"SIM" can\'t be used as a team name.',
    });
    // Route groups "(x)" are looked through; dynamic "[x]", private "_x" and files are not segments.
    const segments = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() &&
            !e.name.startsWith("[") &&
            !e.name.startsWith("_") &&
            !e.name.startsWith("@"),
        )
        .flatMap((e) =>
          e.name.startsWith("(") ? segments(join(dir, e.name)) : [e.name],
        );
    const top = segments(join(process.cwd(), "src/app"));
    expect(top).toEqual(
      expect.arrayContaining(["api", "sim", "request-access", "editor-lab"]),
    );
    expect(top.filter((s) => !RESERVED_SLUGS.has(s))).toEqual([]);
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
