import { describe, expect, it } from "vitest";
import type { PaletteTemplateRow } from "./import-types";
import { PALETTE_MATCH_LIMIT, PALETTE_REST_LIMIT } from "./palette";
import {
  paletteSearch,
  recentTemplateIds,
  type PaletteTemplate,
  type PaletteVersion,
} from "./palette-search";
import type {
  MembershipStatus,
  PlatformRole,
  TeamRole,
  VersionState,
  Viewer,
} from "./types";

// The palette's search as the backend decides it: who sees which templates, what each is shown as, and what
// Recent and the list hold. Facts built by hand; the ranking itself is also covered in palette.test.ts.

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
const morgan = viewer("morgan");
const lapsed = viewer("lapsed", {
  team: CORAL,
  roles: ["author"],
  status: "suspended",
});

// ── Templates and versions ───────────────────────────────────────────────────

function template(id: string, team: typeof CORAL = CORAL): PaletteTemplate {
  return { id, teamId: team.id, teamSlug: team.slug, teamName: team.name };
}

function version(
  templateId: string,
  number: number | null,
  state: VersionState,
  name: string,
  round: number | null = number === null ? null : 1,
): PaletteVersion {
  return { templateId, number, round, state, name };
}

/** A template and its single Active version, named: the usual way a template reaches the palette. */
function active(id: string, name: string, team: typeof CORAL = CORAL): Entry {
  return {
    template: template(id, team),
    version: version(id, 1, "active", name),
  };
}

type Entry = { template: PaletteTemplate; version: PaletteVersion | null };

function search(
  entries: Entry[],
  over: {
    viewer?: Viewer;
    teamId?: string | null;
    recentIds?: string[];
    q?: string | null;
    currentId?: string | null;
    versions?: PaletteVersion[];
  } = {},
) {
  return paletteSearch({
    viewer: maya,
    teamId: CORAL.id,
    templates: entries.map((e) => e.template),
    versions:
      over.versions ?? entries.flatMap((e) => (e.version ? [e.version] : [])),
    recentIds: [],
    q: null,
    currentId: null,
    ...over,
  });
}

const rowIds = (rows: PaletteTemplateRow[]) => rows.map((r) => r.id);
const rowNames = (rows: PaletteTemplateRow[]) => rows.map((r) => r.name);

/** `count` templates named "<prefix> 01", "<prefix> 02" ... with ids "UC-<prefix>-01" ... */
function numbered(prefix: string, count: number): Entry[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return active(`UC-${prefix}-${n}`, `${prefix} ${n}`);
  });
}

// ── recentTemplateIds ────────────────────────────────────────────────────────

describe("recentTemplateIds", () => {
  it("is each template once, in the order they first appear (newest first)", () => {
    expect(
      recentTemplateIds([
        { templateId: "UC-2" },
        { templateId: "UC-1" },
        { templateId: "UC-2" },
        { templateId: "UC-3" },
        { templateId: "UC-1" },
      ]),
    ).toEqual(["UC-2", "UC-1", "UC-3"]);
  });

  it("drops events that name no template", () => {
    expect(
      recentTemplateIds([
        { templateId: null },
        { templateId: "UC-1" },
        { templateId: null },
        { templateId: "UC-2" },
      ]),
    ).toEqual(["UC-1", "UC-2"]);
  });

  it("is empty for no events, or for events that name nothing", () => {
    expect(recentTemplateIds([])).toEqual([]);
    expect(recentTemplateIds([{ templateId: null }])).toEqual([]);
  });
});

// ── paletteSearch at rest ────────────────────────────────────────────────────

describe("paletteSearch at rest", () => {
  it("has no query, and lists the first page by name with no Recent", () => {
    const facts = search(numbered("Notice", 3).reverse());
    expect(facts!.query).toBe("");
    expect(facts!.recent).toEqual([]);
    expect(rowNames(facts!.templates)).toEqual([
      "Notice 01",
      "Notice 02",
      "Notice 03",
    ]);
  });

  it("Recent is at most five, newest first; the rest are listed by name", () => {
    const entries = numbered("Notice", 14);
    // Seven recent templates, newest first: Notice 14 down to Notice 08.
    const recentIds = entries
      .map((e) => e.template.id)
      .reverse()
      .slice(0, 7);
    const facts = search(entries, { recentIds });
    expect(rowNames(facts!.recent)).toEqual([
      "Notice 14",
      "Notice 13",
      "Notice 12",
      "Notice 11",
      "Notice 10",
    ]);
    // The sixth and seventh recent are ordinary templates: listed by name, the first PALETTE_REST_LIMIT of
    // the nine that are not in Recent.
    expect(facts!.templates).toHaveLength(PALETTE_REST_LIMIT);
    expect(rowNames(facts!.templates)).toEqual([
      "Notice 01",
      "Notice 02",
      "Notice 03",
      "Notice 04",
      "Notice 05",
      "Notice 06",
      "Notice 07",
      "Notice 08",
    ]);
  });

  it("Recent leaves out the template being viewed, which stays in the list", () => {
    const entries = numbered("Notice", 6);
    const facts = search(entries, {
      recentIds: [
        "UC-Notice-03",
        "UC-Notice-01",
        "UC-Notice-05",
        "UC-Notice-02",
        "UC-Notice-06",
        "UC-Notice-04",
      ],
      currentId: "UC-Notice-01",
    });
    // The window of five is cut first, then the current template leaves it: the sixth is not promoted.
    expect(rowIds(facts!.recent)).toEqual([
      "UC-Notice-03",
      "UC-Notice-05",
      "UC-Notice-02",
      "UC-Notice-06",
    ]);
    expect(rowIds(facts!.templates)).toEqual(["UC-Notice-01", "UC-Notice-04"]);
  });

  it("skips recent templates the viewer may not see in the space", () => {
    const entries = [
      active("UC-1", "Cash Back"),
      active("UC-2", "Savings Rate", DEPOSITS),
    ];
    const facts = search(entries, { recentIds: ["UC-2", "UC-9", "UC-1"] });
    expect(rowIds(facts!.recent)).toEqual(["UC-1"]);
    expect(rowIds(facts!.templates)).toEqual([]);
  });

  it("lists by name, then id, by code point: 'Zebra' before 'apple', and equal names by id", () => {
    const facts = search([
      active("UC-1", "apple"),
      active("UC-3", "Mango"),
      active("UC-2", "Zebra"),
      active("UC-4", "Mango"),
    ]);
    // Code point order puts "Zebra" (Z is 90) before "apple" (a is 97); a locale order would not.
    expect(facts!.templates.map((t) => [t.name, t.id])).toEqual([
      ["Mango", "UC-3"],
      ["Mango", "UC-4"],
      ["Zebra", "UC-2"],
      ["apple", "UC-1"],
    ]);
  });

  it("a row is the id, the latest version's name and state, and the team", () => {
    const facts = search([active("UC-1", "Cash Back")]);
    expect(facts!.templates).toEqual([
      {
        id: "UC-1",
        name: "Cash Back",
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        status: "active",
      },
    ]);
  });
});

// ── paletteSearch while searching ────────────────────────────────────────────

describe("paletteSearch while searching", () => {
  const entries = [
    active("UC-AAAAAA", "Annual Fee Waiver"),
    active("UC-CCCCCC", "Cash Back"),
    active("UC-EEEEEE", "Savings Rate", DEPOSITS),
  ];

  it("has no Recent", () => {
    const facts = search(entries, { q: "a", recentIds: ["UC-CCCCCC"] });
    expect(facts!.recent).toEqual([]);
    expect(facts!.templates.length).toBeGreaterThan(0);
  });

  it("answers at most PALETTE_MATCH_LIMIT matches", () => {
    const facts = search(numbered("Notice", PALETTE_MATCH_LIMIT + 5), {
      viewer: maya,
      q: "notice",
    });
    expect(facts!.templates).toHaveLength(PALETTE_MATCH_LIMIT);
    // The best of equal matches are the first by name.
    expect(facts!.templates[0]!.name).toBe("Notice 01");
    expect(facts!.templates.at(-1)!.name).toBe(
      `Notice ${String(PALETTE_MATCH_LIMIT).padStart(2, "0")}`,
    );
  });

  it("every word must match the name, the team, the id or the status as the badge words it", () => {
    const find = (q: string) =>
      rowNames(search(entries, { viewer: riley, teamId: null, q })!.templates);
    expect(find("cash back")).toEqual(["Cash Back"]);
    // The team's name.
    expect(find("deposits")).toEqual(["Savings Rate"]);
    // The id, in any case.
    expect(find("uc-cc")).toEqual(["Cash Back"]);
    // The status: "Active" for all three.
    expect(find("active")).toHaveLength(3);
    // Every word, in any place: the name and the team.
    expect(find("cash coral")).toEqual(["Cash Back"]);
    expect(find("cash zzz")).toEqual([]);
  });

  it("matches the status of the latest version, worded as the badge words it", () => {
    const versions = [
      version("UC-1", 1, "active", "Cash Back"),
      version("UC-1", 2, "changes_requested", "Cash Back"),
      version("UC-2", null, "draft", "Savings Rate"),
      version("UC-3", 1, "in_review", "Balance Transfer"),
    ];
    const find = (q: string) =>
      rowIds(
        search([active("UC-1", ""), active("UC-2", ""), active("UC-3", "")], {
          versions,
          q,
        })!.templates,
      );
    expect(find("changes requested")).toEqual(["UC-1"]);
    // v1 is Active, but the template is shown by its latest version.
    expect(find("active")).toEqual([]);
    expect(find("draft")).toEqual(["UC-2"]);
    expect(find("in review")).toEqual(["UC-3"]);
  });

  it("ranks a name that starts with the word, then a word of the name, then the rest", () => {
    const facts = search(
      [
        active("UC-1", "Annual Points"),
        active("UC-2", "Holiday Points"),
        active("UC-3", "Pointsplus"),
        active("UC-4", "Checkpoint"),
      ],
      { q: "point" },
    );
    expect(rowNames(facts!.templates)).toEqual([
      "Pointsplus",
      "Annual Points",
      "Holiday Points",
      "Checkpoint",
    ]);
  });

  it("equal matches go by name, then id, by code point", () => {
    // Every name has the word inside a word, so all four rank alike.
    const facts = search(
      [
        active("UC-1", "apple"),
        active("UC-2", "Zebra"),
        active("UC-4", "Mane"),
        active("UC-3", "Mane"),
      ],
      { q: "e" },
    );
    expect(facts!.templates.map((t) => [t.name, t.id])).toEqual([
      ["Mane", "UC-3"],
      ["Mane", "UC-4"],
      ["Zebra", "UC-2"],
      ["apple", "UC-1"],
    ]);
  });

  it("a better match beats a worse one whatever the name order", () => {
    const facts = search(
      [active("UC-1", "Annual Show"), active("UC-2", "Showcase")],
      { q: "show" },
    );
    // "Annual Show" is first by name, but "Showcase" starts with the word.
    expect(rowNames(facts!.templates)).toEqual(["Showcase", "Annual Show"]);
  });

  it("recent templates win ties between equal matches, newest first", () => {
    const tied = [
      active("UC-1", "Alpha Fee"),
      active("UC-2", "Beta Fee"),
      active("UC-3", "Gamma Fee"),
      active("UC-4", "Fee Waiver"),
    ];
    expect(rowNames(search(tied, { q: "fee" })!.templates)).toEqual([
      "Fee Waiver", // starts with the word: the best match
      "Alpha Fee",
      "Beta Fee",
      "Gamma Fee",
    ]);
    const facts = search(tied, { q: "fee", recentIds: ["UC-3", "UC-2"] });
    expect(rowNames(facts!.templates)).toEqual([
      "Fee Waiver", // a recent template does not beat a better match
      "Gamma Fee",
      "Beta Fee",
      "Alpha Fee",
    ]);
  });

  it("normalizes the query", () => {
    expect(search(entries, { q: "  Cash   BACK " })!.query).toBe("cash back");
    expect(search(entries, { q: "   " })!.query).toBe("");
    expect(search(entries, { q: null })!.query).toBe("");
    // A search that is only spaces is at rest.
    expect(search(entries, { q: "   " })!.templates).toHaveLength(2);
  });
});

// ── What each template is shown as ───────────────────────────────────────────

describe("paletteSearch: a template's name and status", () => {
  const one = (versions: PaletteVersion[]) =>
    search([{ template: template("UC-1"), version: null }], { versions })!
      .templates[0]!;

  it("come from the open draft when there is one", () => {
    expect(
      one([
        version("UC-1", 1, "active", "Live name"),
        version("UC-1", null, "draft", "Draft name"),
      ]),
    ).toMatchObject({ name: "Draft name", status: "draft" });
  });

  it("otherwise from the highest number, and of its rounds the latest", () => {
    expect(
      one([
        version("UC-1", 1, "active", "Live name"),
        version("UC-1", 2, "changes_requested", "Round one"),
        version("UC-1", 2, "in_review", "Round two", 2),
      ]),
    ).toMatchObject({ name: "Round two", status: "in_review" });
  });

  it("are the id and 'draft' for a template with no version", () => {
    const facts = search([{ template: template("UC-7"), version: null }]);
    expect(facts!.templates).toEqual([
      {
        id: "UC-7",
        name: "UC-7",
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        status: "draft",
      },
    ]);
  });

  it("only that template's versions are read", () => {
    const facts = search([active("UC-1", ""), active("UC-2", "")], {
      versions: [
        version("UC-1", 1, "active", "First"),
        version("UC-2", 4, "superseded", "Second"),
      ],
    });
    expect(facts!.templates.map((t) => [t.id, t.name, t.status])).toEqual([
      ["UC-1", "First", "active"],
      ["UC-2", "Second", "superseded"],
    ]);
  });
});

// ── The space and the current template ───────────────────────────────────────

describe("paletteSearch: the space and who may see it", () => {
  const entries = [
    active("UC-1", "Cash Back"),
    active("UC-2", "Savings Rate", DEPOSITS),
  ];

  it("a team's space lists only that team's templates", () => {
    expect(rowIds(search(entries, { viewer: maya })!.templates)).toEqual([
      "UC-1",
    ]);
    expect(
      rowIds(search(entries, { viewer: eli, teamId: DEPOSITS.id })!.templates),
    ).toEqual(["UC-2"]);
    // A platform admin entering one team sees only that team.
    expect(
      rowIds(
        search(entries, { viewer: riley, teamId: DEPOSITS.id })!.templates,
      ),
    ).toEqual(["UC-2"]);
  });

  it("the cross-team space lists every team's templates for a platform role", () => {
    expect(
      rowIds(search(entries, { viewer: riley, teamId: null })!.templates),
    ).toEqual(["UC-1", "UC-2"]);
  });

  it("is null when the viewer may not enter the space", () => {
    expect(search(entries, { viewer: maya, teamId: DEPOSITS.id })).toBeNull();
    expect(search(entries, { viewer: morgan })).toBeNull();
    expect(search(entries, { viewer: lapsed })).toBeNull();
    expect(search(entries, { viewer: maya, teamId: null })).toBeNull();
  });

  it("the current template is one the viewer may see in this space", () => {
    const current = (over: Parameters<typeof search>[1]) =>
      search(entries, over)!.current;
    expect(current({ currentId: "UC-1" })).toBe(true);
    // Another team's template: not visible in this space.
    expect(current({ currentId: "UC-2" })).toBe(false);
    // Unknown, or none.
    expect(current({ currentId: "UC-404" })).toBe(false);
    expect(current({ currentId: null })).toBe(false);
    // In the cross-team space, any team's template is.
    expect(current({ viewer: riley, teamId: null, currentId: "UC-2" })).toBe(
      true,
    );
  });

  it("the current template stays in the list when it is not in Recent", () => {
    const facts = search(entries, { currentId: "UC-1" });
    expect(rowIds(facts!.templates)).toEqual(["UC-1"]);
    expect(facts!.current).toBe(true);
  });
});

describe("paletteSearch: what the viewer may create", () => {
  it("an author may, on their team", () => {
    expect(search([], { viewer: maya })!.can.create).toEqual({ ok: true });
  });

  it("a team viewer may not, and is told why by a code", () => {
    expect(search([], { viewer: sam })!.can.create).toMatchObject({
      ok: false,
      code: "generic",
    });
  });

  it("nobody may in the cross-team space, a platform admin included", () => {
    expect(
      search([], { viewer: riley, teamId: null })!.can.create,
    ).toMatchObject({
      ok: false,
      code: "generic",
    });
  });
});
