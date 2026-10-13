import { describe, expect, it } from "vitest";
import {
  advanceDaysRefusal,
  DEMO_ADVANCE_MAX_DAYS,
  DEMO_REFUSALS,
  demoToolsRefusal,
  isLocalDatabaseFile,
  personaLanding,
  resetRefusal,
} from "./demo";
import type { SpaceTeam } from "./spaces";
import type { TeamRole, Viewer } from "./types";

// Team ids are never slugs (decision 0053): these fixtures keep the two apart, so a rule that compares one with the
// other fails here.
const CORAL: SpaceTeam = {
  id: "t_coral",
  slug: "coral-offers",
  name: "Coral Offers",
  icon: "credit-card",
};
const DEPOSITS: SpaceTeam = {
  id: "t_deposits",
  slug: "deposits",
  name: "Deposits",
  icon: "piggy-bank",
};

function person(
  teams: [SpaceTeam, TeamRole[]][],
  platformRole: Viewer["platformRole"] = null,
): Viewer {
  return {
    userId: "u",
    name: "U",
    initials: "U",
    title: "",
    platformRole,
    memberships: teams.map(([team, roles]) => ({
      teamId: team.id,
      teamSlug: team.slug,
      teamName: team.name,
      roles,
      status: "active",
    })),
  };
}

describe("personaLanding", () => {
  it("stays in a space the persona may enter, and names their first space", () => {
    const priya = person([
      [DEPOSITS, ["viewer"]],
      [CORAL, ["author"]],
    ]);
    const landing = personaLanding(priya, DEPOSITS.slug, DEPOSITS);
    expect(landing.space).toMatchObject({
      teamId: DEPOSITS.id,
      slug: DEPOSITS.slug,
    });
    // Their teams by name: Coral Offers before Deposits.
    expect(landing.homeSlug).toBe(CORAL.slug);
  });

  it("leaves a space they may not enter, or a slug no team has, for their first space", () => {
    const maya = person([[CORAL, ["author"]]]);
    expect(personaLanding(maya, DEPOSITS.slug, DEPOSITS)).toEqual({
      space: null,
      homeSlug: CORAL.slug,
    });
    expect(personaLanding(maya, "nowhere", undefined)).toEqual({
      space: null,
      homeSlug: CORAL.slug,
    });
  });

  it("lands someone with no team yet nowhere: they ask for access", () => {
    expect(personaLanding(person([]), CORAL.slug, CORAL)).toEqual({
      space: null,
      homeSlug: null,
    });
  });

  it("lands a platform role in All teams first, and lets them stay in any team", () => {
    const riley = person([], "platform_admin");
    const landing = personaLanding(riley, CORAL.slug, CORAL);
    expect(landing.space).toMatchObject({ teamId: CORAL.id });
    expect(landing.homeSlug).toBe("all");
    expect(personaLanding(riley, "all", undefined).space).toMatchObject({
      teamId: null,
      kind: "all",
    });
  });

  it("decides no space for a URL that names none", () => {
    expect(
      personaLanding(person([[CORAL, ["author"]]]), null, undefined),
    ).toEqual({
      space: null,
      homeSlug: CORAL.slug,
    });
  });
});

describe("advanceDaysRefusal", () => {
  it.each([1, 30, DEMO_ADVANCE_MAX_DAYS])("moves the clock %i days", (days) => {
    expect(advanceDaysRefusal(days)).toBeNull();
  });

  it.each([0, -1, 1.5, DEMO_ADVANCE_MAX_DAYS + 1, Number.NaN])(
    "refuses %s days as input it can't use",
    (days) => {
      expect(advanceDaysRefusal(days)).toEqual({
        code: "invalid_input",
        reason: "Enter 1 to 3,650 days.",
      });
    },
  );
});

describe("demoToolsRefusal", () => {
  it("lets the tools run in demo mode", () => {
    expect(demoToolsRefusal(true)).toBeNull();
  });

  it("refuses them otherwise, with a code of its own", () => {
    expect(demoToolsRefusal(false)).toEqual({
      ok: false,
      code: "demo_mode_off",
      reason: "The demo tools are turned off.",
    });
    expect(DEMO_REFUSALS.off.code).toBe("demo_mode_off");
  });
});

describe("isLocalDatabaseFile", () => {
  it.each([
    "file:./data/ucomp.db",
    "file:/Users/someone/stencil/data/ucomp.db",
    "file:///tmp/ucomp.db",
    "FILE:./data/ucomp.db",
    "  file:./data/e2e-0.db ",
  ])("accepts %s", (url) => {
    expect(isLocalDatabaseFile(url)).toBe(true);
  });

  it.each([
    "libsql://stencil-prod.turso.io",
    "libsql://localhost:8080",
    "https://stencil-prod.turso.io",
    "http://127.0.0.1:8080",
    "wss://stencil-prod.turso.io",
    "ws://127.0.0.1:8080",
    ":memory:",
    "./data/ucomp.db",
    "",
  ])("rejects %s", (url) => {
    expect(isLocalDatabaseFile(url)).toBe(false);
  });
});

describe("resetRefusal", () => {
  it("lets a local file be reset", () => {
    expect(resetRefusal("file:./data/ucomp.db")).toBeNull();
  });

  it("refuses a remote database, with a code of its own", () => {
    expect(resetRefusal("libsql://stencil-prod.turso.io")).toEqual({
      ok: false,
      code: "reset_needs_local_file",
      reason: "The demo reset only runs on a local database file.",
    });
    expect(DEMO_REFUSALS.notLocalFile.code).toBe("reset_needs_local_file");
  });
});
