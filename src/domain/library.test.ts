import { describe, expect, it } from "vitest";
import {
  libraryOf,
  type LibraryTemplate,
  type LibraryVersion,
} from "./library";
import type { Person } from "./review-types";
import type {
  Channel,
  MembershipStatus,
  PlatformRole,
  TeamRole,
  VersionState,
  Viewer,
} from "./types";

// The Library, decided on facts built by hand: no database, no clock but the `now` handed in.

const NOW = new Date("2026-10-04T12:00:00.000Z");

// ── Viewers ──────────────────────────────────────────────────────────────────

const CORAL = { id: "t_coral", slug: "coral-offers", name: "Coral Offers" };
const DEPOSITS = { id: "t_deposits", slug: "deposits", name: "Deposits" };

function viewer(
  userId: string,
  opts: {
    platformRole?: PlatformRole;
    team?: typeof CORAL;
    roles?: TeamRole[];
    status?: MembershipStatus;
  } = {},
): Viewer {
  return {
    userId,
    name: userId,
    initials: userId.slice(0, 2).toUpperCase(),
    title: "",
    platformRole: opts.platformRole ?? null,
    memberships: opts.team
      ? [
          {
            teamId: opts.team.id,
            teamSlug: opts.team.slug,
            teamName: opts.team.name,
            roles: opts.roles ?? ["author"],
            status: opts.status ?? "active",
          },
        ]
      : [],
  };
}

const maya = viewer("maya", { team: CORAL, roles: ["author"] });
const sam = viewer("sam", { team: CORAL, roles: ["viewer"] });
const eli = viewer("eli", { team: DEPOSITS, roles: ["author"] });
const riley = viewer("riley", { platformRole: "platform_admin" });
const taylor = viewer("taylor", { platformRole: "auditor" });
const morgan = viewer("morgan"); // no membership, no platform role
const lapsed = viewer("lapsed", {
  team: CORAL,
  roles: ["author"],
  status: "suspended",
});

// ── Templates and versions ───────────────────────────────────────────────────

const OWNER: Person = { id: "maya", name: "Maya", initials: "MA", hue: 200 };

function template(
  id: string,
  over: Partial<LibraryTemplate> = {},
): LibraryTemplate {
  return {
    id,
    teamId: CORAL.id,
    teamSlug: CORAL.slug,
    teamName: CORAL.name,
    allowedChannels: ["pdf", "web", "email"],
    owner: OWNER,
    ...over,
  };
}

/** A version of `templateId`: a numbered row, or the open draft when `number` is null. */
function version(
  templateId: string,
  number: number | null,
  state: VersionState,
  over: Partial<LibraryVersion> = {},
): LibraryVersion {
  return {
    templateId,
    number,
    round: number === null ? null : 1,
    state,
    name: `${templateId} v${number ?? "draft"}`,
    sunsetAt: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...over,
  };
}

function library(
  input: {
    viewer?: Viewer;
    teamId?: string | null;
    templates?: LibraryTemplate[];
    versions?: LibraryVersion[];
    zone?: string;
    now?: Date;
  } = {},
) {
  return libraryOf({
    viewer: maya,
    teamId: CORAL.id,
    templates: [],
    versions: [],
    zone: "UTC",
    now: NOW,
    ...input,
  });
}

/** The single row of a Library of one template. */
function rowOf(
  t: LibraryTemplate,
  versions: LibraryVersion[],
  over: { zone?: string; now?: Date } = {},
) {
  const facts = library({ templates: [t], versions, ...over });
  expect(facts!.rows).toHaveLength(1);
  return facts!.rows[0]!;
}

const ids = (facts: ReturnType<typeof library>) => facts!.rows.map((r) => r.id);

// ── libraryOf: a row ─────────────────────────────────────────────────────────

describe("libraryOf: a template's row", () => {
  it("is shown by the open draft when there is one", () => {
    const t = template("UC-1");
    const row = rowOf(t, [
      version("UC-1", 1, "active", { name: "Old name" }),
      version("UC-1", null, "draft", { name: "Draft name" }),
    ]);
    expect(row).toMatchObject({
      id: "UC-1",
      name: "Draft name",
      status: "draft",
      activeNumber: 1,
    });
  });

  it("otherwise by the highest number, and of its rounds the latest", () => {
    const t = template("UC-1");
    const row = rowOf(t, [
      version("UC-1", 2, "changes_requested", { name: "Round one" }),
      version("UC-1", 1, "active", { name: "Live" }),
      version("UC-1", 2, "in_review", { name: "Round two", round: 2 }),
    ]);
    expect(row).toMatchObject({
      name: "Round two",
      status: "in_review",
      activeNumber: 1,
    });
  });

  it("takes its name, status and sunset from the latest version alone", () => {
    const t = template("UC-1");
    const sunsetAt = new Date("2026-10-25T04:00:00.000Z");
    // v2 is the latest and has no sunset: v1's does not show through.
    const row = rowOf(t, [
      version("UC-1", 1, "superseded", { name: "One", sunsetAt }),
      version("UC-1", 2, "active", { name: "Two" }),
    ]);
    expect(row).toMatchObject({
      name: "Two",
      status: "active",
      activeNumber: 2,
      sunsetDay: null,
      sunsetPassed: false,
    });
    // When the latest is the one with a sunset, the row has it.
    const superseded = rowOf(t, [
      version("UC-1", 1, "superseded", { name: "One", sunsetAt }),
    ]);
    expect(superseded).toMatchObject({
      status: "superseded",
      sunsetDay: "2026-10-25",
      sunsetPassed: false,
      activeNumber: null,
    });
  });

  it("passes the team and the owner through", () => {
    const t = template("UC-1", {
      teamId: DEPOSITS.id,
      teamSlug: DEPOSITS.slug,
      teamName: DEPOSITS.name,
    });
    const facts = libraryOf({
      viewer: riley,
      teamId: null,
      templates: [t],
      versions: [version("UC-1", 1, "active")],
      zone: "UTC",
      now: NOW,
    });
    expect(facts!.rows[0]).toMatchObject({
      teamId: "t_deposits",
      teamSlug: "deposits",
      teamName: "Deposits",
      owner: OWNER,
    });
  });

  it("is a document or an alert by the content type's channels, never by a version", () => {
    const family = (allowedChannels: Channel[]) =>
      rowOf(template("UC-1", { allowedChannels }), [
        version("UC-1", 1, "active"),
      ]).family;
    expect(family(["pdf", "web", "email"])).toBe("document");
    expect(family(["push", "sms"])).toBe("message");
    expect(family(["push"])).toBe("message");
    // A content type with no channels (it should not happen) is a document.
    expect(family([])).toBe("document");
    // A template with no version has a family too.
    expect(
      rowOf(template("UC-2", { allowedChannels: ["sms"] }), []).family,
    ).toBe("message");
  });

  it("lastEditedAt is the newest change to any of its versions, not only the latest", () => {
    const t = template("UC-1");
    const row = rowOf(t, [
      version("UC-1", 1, "superseded", {
        updatedAt: new Date("2026-09-20T08:30:00.000Z"),
      }),
      version("UC-1", 2, "active", {
        updatedAt: new Date("2026-09-10T00:00:00.000Z"),
      }),
      version("UC-1", 3, "in_review", {
        updatedAt: new Date("2026-09-12T00:00:00.000Z"),
      }),
    ]);
    expect(row.lastEditedAt).toBe("2026-09-20T08:30:00.000Z");
  });

  it("a template with no versions is its id, a draft, and has never been edited", () => {
    const row = rowOf(template("UC-9"), []);
    expect(row).toMatchObject({
      id: "UC-9",
      name: "UC-9",
      status: "draft",
      sunsetDay: null,
      sunsetPassed: false,
      activeNumber: null,
      lastEditedAt: null,
    });
  });

  it("only that template's versions count toward its row", () => {
    const row = rowOf(template("UC-1"), [
      version("UC-1", 1, "active", { name: "Mine" }),
      version("UC-2", 5, "active", {
        name: "Another template's",
        updatedAt: new Date("2026-10-01T00:00:00.000Z"),
      }),
    ]);
    expect(row).toMatchObject({
      name: "Mine",
      activeNumber: 1,
      lastEditedAt: "2026-09-01T00:00:00.000Z",
    });
  });
});

describe("libraryOf: the sunset", () => {
  // 21:00 Eastern on October 24 is 01:00 UTC on October 25.
  const sunsetAt = new Date("2026-10-25T01:00:00.000Z");
  const t = template("UC-1");
  const superseded = [version("UC-1", 1, "superseded", { sunsetAt })];

  it("is the day it falls on in the zone, which is not always the UTC day", () => {
    expect(rowOf(t, superseded, { zone: "UTC" }).sunsetDay).toBe("2026-10-25");
    expect(rowOf(t, superseded, { zone: "America/New_York" }).sunsetDay).toBe(
      "2026-10-24",
    );
  });

  it("has passed at exactly the sunset instant, and not a millisecond before", () => {
    const before = new Date(sunsetAt.getTime() - 1);
    expect(rowOf(t, superseded, { now: before }).sunsetPassed).toBe(false);
    expect(rowOf(t, superseded, { now: sunsetAt }).sunsetPassed).toBe(true);
    expect(
      rowOf(t, superseded, { now: new Date(sunsetAt.getTime() + 1) })
        .sunsetPassed,
    ).toBe(true);
  });
});

// ── libraryOf: the list ──────────────────────────────────────────────────────

describe("libraryOf: the order", () => {
  const edited = (iso: string) => ({ updatedAt: new Date(iso) });

  it("lists the newest edit first", () => {
    const facts = library({
      templates: [template("UC-1"), template("UC-2"), template("UC-3")],
      versions: [
        version("UC-1", 1, "active", edited("2026-09-01T00:00:00.000Z")),
        version("UC-2", 1, "active", edited("2026-09-03T00:00:00.000Z")),
        version("UC-3", 1, "active", edited("2026-09-02T00:00:00.000Z")),
      ],
    });
    expect(ids(facts)).toEqual(["UC-2", "UC-3", "UC-1"]);
  });

  it("a template edited in an older version counts by that edit", () => {
    const facts = library({
      templates: [template("UC-1"), template("UC-2")],
      versions: [
        version("UC-1", 1, "superseded", edited("2026-09-09T00:00:00.000Z")),
        version("UC-1", 2, "active", edited("2026-09-01T00:00:00.000Z")),
        version("UC-2", 1, "active", edited("2026-09-05T00:00:00.000Z")),
      ],
    });
    expect(ids(facts)).toEqual(["UC-1", "UC-2"]);
  });

  it("equal instants go by name, then id, by code point", () => {
    const same = edited("2026-09-01T00:00:00.000Z");
    const facts = library({
      templates: [
        template("UC-1"),
        template("UC-2"),
        template("UC-3"),
        template("UC-4"),
      ],
      versions: [
        version("UC-1", 1, "active", { ...same, name: "apple" }),
        version("UC-2", 1, "active", { ...same, name: "Zebra" }),
        // Same name: the id decides.
        version("UC-4", 1, "active", { ...same, name: "Mango" }),
        version("UC-3", 1, "active", { ...same, name: "Mango" }),
      ],
    });
    // Code point order puts "Zebra" (Z is 90) before "apple" (a is 97); a locale order would not.
    expect(ids(facts)).toEqual(["UC-3", "UC-4", "UC-2", "UC-1"]);
    expect(facts!.rows.map((r) => r.name)).toEqual([
      "Mango",
      "Mango",
      "Zebra",
      "apple",
    ]);
  });

  it("a template never edited comes last, by name then id", () => {
    const facts = library({
      templates: [template("UC-8"), template("UC-7"), template("UC-1")],
      versions: [
        version("UC-1", 1, "active", edited("2020-01-01T00:00:00.000Z")),
      ],
    });
    // No versions: the name is the id.
    expect(ids(facts)).toEqual(["UC-1", "UC-7", "UC-8"]);
  });

  it("the order does not depend on the order the candidates come in", () => {
    const templates = [template("UC-1"), template("UC-2"), template("UC-3")];
    const versions = [
      version("UC-1", 1, "active", edited("2026-09-01T00:00:00.000Z")),
      version("UC-2", 1, "active", edited("2026-09-03T00:00:00.000Z")),
      version("UC-3", 1, "active", edited("2026-09-02T00:00:00.000Z")),
    ];
    expect(ids(library({ templates, versions }))).toEqual(
      ids(
        library({
          templates: [...templates].reverse(),
          versions: [...versions].reverse(),
        }),
      ),
    );
  });
});

describe("libraryOf: the space and who may see it", () => {
  const coralTemplate = template("UC-1");
  const depositsTemplate = template("UC-2", {
    teamId: DEPOSITS.id,
    teamSlug: DEPOSITS.slug,
    teamName: DEPOSITS.name,
  });
  const templates = [coralTemplate, depositsTemplate];
  const versions = [version("UC-1", 1, "active"), version("UC-2", 1, "active")];

  it("a team's space lists only that team's templates", () => {
    expect(
      ids(library({ viewer: maya, teamId: CORAL.id, templates, versions })),
    ).toEqual(["UC-1"]);
    expect(
      ids(library({ viewer: eli, teamId: DEPOSITS.id, templates, versions })),
    ).toEqual(["UC-2"]);
    // A platform admin entering one team sees only that team, too.
    expect(
      ids(library({ viewer: riley, teamId: DEPOSITS.id, templates, versions })),
    ).toEqual(["UC-2"]);
  });

  it("the cross-team space lists every team's templates for a platform role", () => {
    for (const person of [riley, taylor]) {
      expect(
        ids(library({ viewer: person, teamId: null, templates, versions })),
      ).toEqual(["UC-1", "UC-2"]);
    }
  });

  it("is null when the viewer may not enter the space", () => {
    // Another team's space.
    expect(
      library({ viewer: maya, teamId: DEPOSITS.id, templates, versions }),
    ).toBeNull();
    // No membership and no platform role.
    expect(
      library({ viewer: morgan, teamId: CORAL.id, templates, versions }),
    ).toBeNull();
    // A suspended membership grants nothing.
    expect(
      library({ viewer: lapsed, teamId: CORAL.id, templates, versions }),
    ).toBeNull();
    // The cross-team space is for the platform roles.
    expect(
      library({ viewer: maya, teamId: null, templates, versions }),
    ).toBeNull();
  });

  it("an empty space is an empty list, not null", () => {
    const facts = library({ viewer: maya, teamId: CORAL.id });
    expect(facts!.rows).toEqual([]);
  });
});

describe("libraryOf: what the viewer may create", () => {
  it("an author may, on their team", () => {
    expect(library({ viewer: maya, teamId: CORAL.id })!.can.create).toEqual({
      ok: true,
    });
  });

  it("a team viewer may not, and is told why by a code", () => {
    expect(
      library({ viewer: sam, teamId: CORAL.id })!.can.create,
    ).toMatchObject({ ok: false, code: "generic" });
  });

  it("a platform role may not create in a team's space", () => {
    expect(
      library({ viewer: riley, teamId: CORAL.id })!.can.create,
    ).toMatchObject({ ok: false, code: "generic" });
    expect(
      library({ viewer: taylor, teamId: CORAL.id })!.can.create,
    ).toMatchObject({ ok: false, code: "generic" });
  });

  it("nobody may in the cross-team space, which has no team to create in", () => {
    expect(library({ viewer: riley, teamId: null })!.can.create).toMatchObject({
      ok: false,
      code: "generic",
    });
    expect(library({ viewer: taylor, teamId: null })!.can.create).toMatchObject(
      { ok: false, code: "generic" },
    );
  });
});
