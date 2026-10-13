import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { LibraryRowFacts } from "@/domain/library";
import type { TemplateLibrary } from "@/server/services/templates";
import { getLibrary, libraryData } from "./library";

// The Library's read model as the BFF builds it: facts in (TemplateLibrary, what the templates service answers),
// the rows out. `libraryData` is pure, so its tests hand it facts directly; what the service decides (which
// templates the viewer sees, the version each is shown by, the status, the sunset, the order, `can.create`) is
// the contract suite's. `getLibrary` is checked for what it adds: the space it asks about, and Not found.

const env = vi.hoisted(() => ({
  library: undefined as unknown,
  asked: [] as { ctx: unknown; input: unknown }[],
}));
vi.mock("@/server/context/request", () => ({
  requireRequestContext: async () => ({
    viewer: { userId: "maya" },
    correlationId: "req_test",
  }),
}));
vi.mock("@/server/services", () => ({
  services: () => ({
    templates: {
      library: async (ctx: unknown, input: unknown) => {
        env.asked.push({ ctx, input });
        return env.library;
      },
    },
  }),
}));
vi.mock("./spaces", () => ({
  requireSpace: async (slug: string) => ({
    slug,
    isAll: slug === "all",
    teamId: slug === "all" ? null : `t_${slug}`,
    name: slug,
  }),
}));

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const ASOF = "2026-10-04T12:00:00.000Z";
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.parse(ASOF) - ms).toISOString();

/** One row as the service answers it; an Active document by Maya unless `over` says otherwise. */
function row(
  over: Partial<LibraryRowFacts> & Pick<LibraryRowFacts, "id">,
): LibraryRowFacts {
  return {
    teamId: "t_coral",
    teamSlug: "coral",
    teamName: "Coral Offers",
    name: "Balance Transfer Intro — Terms",
    family: "document",
    status: "active",
    sunsetDay: null,
    sunsetPassed: false,
    activeNumber: 2,
    lastEditedAt: ago(3 * HOUR),
    owner: { id: "maya", name: "Maya Chen", initials: "MC", hue: 30 },
    ...over,
  };
}

function library(
  rows: LibraryRowFacts[],
  over: Partial<TemplateLibrary> = {},
): TemplateLibrary {
  return { rows, can: { create: { ok: true } }, asOf: ASOF, ...over };
}

describe("libraryData", () => {
  it("maps each row field for field: the team's id is dropped, and the owner comes without an id", () => {
    const data = libraryData(
      library([
        row({
          id: "UC-AAAAAA",
          status: "superseded",
          sunsetDay: "2026-10-25",
          sunsetPassed: true,
          activeNumber: null,
        }),
      ]),
    );
    expect(data.rows).toEqual([
      {
        id: "UC-AAAAAA",
        name: "Balance Transfer Intro — Terms",
        family: "document",
        teamSlug: "coral",
        teamName: "Coral Offers",
        status: "superseded",
        sunsetDay: "2026-10-25",
        sunsetPassed: true,
        activeNumber: null,
        lastEdited: "3 hours ago",
        owner: { name: "Maya Chen", initials: "MC", hue: 30 },
      },
    ]);
    expect(data.rows[0]).not.toHaveProperty("teamId");
    expect(data.rows[0]!.owner).not.toHaveProperty("id");
  });

  it("carries a template's kind as the service decided it", () => {
    const data = libraryData(
      library([
        row({ id: "UC-AAAAAA", family: "document" }),
        row({ id: "UC-BBBBBB", family: "message", name: "Card Used Abroad" }),
      ]),
    );
    expect(data.rows.map((r) => [r.id, r.family])).toEqual([
      ["UC-AAAAAA", "document"],
      ["UC-BBBBBB", "message"],
    ]);
  });

  it("words the last edit from the read's asOf, and says a dash for a template with no edit", () => {
    const data = libraryData(
      library([
        row({ id: "UC-AAAAAA", lastEditedAt: ago(30_000) }),
        row({ id: "UC-BBBBBB", lastEditedAt: ago(3 * HOUR) }),
        row({ id: "UC-CCCCCC", lastEditedAt: "2026-10-03T01:00:00.000Z" }),
        row({ id: "UC-DDDDDD", lastEditedAt: "2026-09-30T12:00:00.000Z" }),
        row({ id: "UC-EEEEEE", lastEditedAt: null }),
      ]),
    );
    expect(data.rows.map((r) => r.lastEdited)).toEqual([
      "just now",
      "3 hours ago",
      "yesterday",
      "4 days ago",
      "—",
    ]);
  });

  it("counts the age from the facts' instant, not from the clock of whoever reads it", () => {
    const edited = "2026-10-04T09:00:00.000Z";
    const at = (asOf: string) =>
      libraryData(
        library([row({ id: "UC-AAAAAA", lastEditedAt: edited })], { asOf }),
      ).rows[0]!.lastEdited;
    expect(at("2026-10-04T12:00:00.000Z")).toBe("3 hours ago");
    expect(at("2026-10-04T10:00:00.000Z")).toBe("1 hour ago");
    expect(at("2026-10-06T12:00:00.000Z")).toBe("2 days ago");
  });

  it("keeps the order the service sent, whatever the names and ages say", () => {
    const data = libraryData(
      library([
        row({ id: "UC-CCCCCC", name: "Zeta", lastEditedAt: ago(HOUR) }),
        row({ id: "UC-AAAAAA", name: "Alpha", lastEditedAt: ago(5 * HOUR) }),
        row({ id: "UC-BBBBBB", name: "Mid", lastEditedAt: ago(9 * HOUR) }),
        row({ id: "UC-DDDDDD", name: "Aardvark", lastEditedAt: null }),
      ]),
    );
    expect(data.rows.map((r) => r.id)).toEqual([
      "UC-CCCCCC",
      "UC-AAAAAA",
      "UC-BBBBBB",
      "UC-DDDDDD",
    ]);
  });

  it("canCreate is the service's decided permission, and asOf is echoed", () => {
    expect(libraryData(library([])).canCreate).toBe(true);
    const refused = libraryData(
      library([], {
        can: {
          create: { ok: false, ...REQUEST_REFUSALS.templateUnavailable },
        },
      }),
    );
    expect(refused).toEqual({ rows: [], canCreate: false, asOf: ASOF });
  });
});

describe("getLibrary", () => {
  beforeEach(() => {
    env.asked = [];
    env.library = {
      ok: true,
      ...library([row({ id: "UC-AAAAAA" })]),
    };
  });

  it("asks the service for the space's team by id, as the signed-in person, and shapes its answer", async () => {
    const data = await getLibrary("coral");
    expect(env.asked).toEqual([
      {
        ctx: expect.objectContaining({ viewer: { userId: "maya" } }),
        input: { teamId: "t_coral" },
      },
    ]);
    expect(data).toMatchObject({
      canCreate: true,
      asOf: ASOF,
      rows: [{ id: "UC-AAAAAA", lastEdited: "3 hours ago" }],
    });
  });

  it("asks for every team (a null team id) in All teams", async () => {
    await getLibrary("all");
    expect(env.asked.map((a) => a.input)).toEqual([{ teamId: null }]);
  });

  it("is Not found when the service refuses the space", async () => {
    env.library = {
      ok: false,
      status: 404,
      ...REQUEST_REFUSALS.spaceUnavailable,
    };
    await expect(getLibrary("coral")).rejects.toThrow(NOT_FOUND);
  });
});
