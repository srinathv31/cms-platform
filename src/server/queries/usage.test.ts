import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type {
  DashboardUsageFacts,
  TemplateUsageFacts,
  UsageCell,
  UsageVersionFacts,
} from "@/server/services/usage";
import { getTemplateUsage, getUsageDashboard } from "./usage";

// The Usage read models as the BFF builds them: the usage service answers counts (DashboardUsageFacts,
// TemplateUsageFacts); `usageDashboard` and `templateUsage` (src/domain/golive/usage.ts, tested there on facts
// built by hand) add them up and word them. These tests check what the read models add: the question they put to
// the service (the space's team by id, null for all teams), the space they pass through, the assembled screens,
// and Not found: a refused read, and a template of another team than the URL's space. What the backend counts (the
// windows, what counts as usage, the sunset's day) is the contract suite's.

const env = vi.hoisted(() => ({
  dashboard: undefined as unknown,
  template: undefined as unknown,
  asked: [] as { method: string; input: unknown }[],
}));
vi.mock("@/server/context/request", () => ({
  requireRequestContext: async () => ({
    viewer: { userId: "maya" },
    correlationId: "req_test",
  }),
}));
vi.mock("@/server/services", () => ({
  services: () => ({
    usage: {
      dashboard: async (_ctx: unknown, input: unknown) => {
        env.asked.push({ method: "dashboard", input });
        return env.dashboard;
      },
      template: async (_ctx: unknown, input: unknown) => {
        env.asked.push({ method: "template", input });
        return env.template;
      },
    },
  }),
}));
// A team's id is never its slug (decision 0053).
vi.mock("./spaces", () => {
  const spaces: Record<string, { name: string; teamId: string | null }> = {
    "coral-offers": { name: "Coral Offers", teamId: "t_coral" },
    deposits: { name: "Deposits", teamId: "t_deposits" },
    all: { name: "All teams", teamId: null },
  };
  return {
    requireSpace: async (slug: string) => ({
      slug,
      isAll: slug === "all",
      teamId: spaces[slug]!.teamId,
      name: spaces[slug]!.name,
    }),
  };
});

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const ASOF = "2026-10-04T12:00:00.000Z";
const BALANCE_TRANSFER = "UC-AAAAAA";

const template = {
  id: BALANCE_TRANSFER,
  name: "Balance Transfer Intro — Terms",
  teamId: "t_coral",
  teamSlug: "coral-offers",
};

const v2: UsageVersionFacts = {
  templateId: BALANCE_TRANSFER,
  number: 2,
  state: "active",
  activatedAt: "2026-09-01T12:00:00.000Z",
  sunset: null,
  revokedAt: null,
};
const v1: UsageVersionFacts = {
  templateId: BALANCE_TRANSFER,
  number: 1,
  state: "superseded",
  activatedAt: "2026-08-01T12:00:00.000Z",
  sunset: {
    at: "2026-10-25T04:00:00.000Z",
    day: "2026-10-25",
    passed: false,
    daysAway: 21,
  },
  revokedAt: null,
};

/** Coral's renders of the template's v2 over the web: 90 succeeded and 10 failed in the window, 50 before it. */
const cell: UsageCell = {
  templateId: BALANCE_TRANSFER,
  consumerId: "coral",
  versionNumber: 2,
  channel: "web",
  platform: null,
  ok30: 90,
  err30: 10,
  prev: 50,
  lastAt: "2026-10-04T09:00:00.000Z",
};

const dashboardFacts = (
  over: Partial<DashboardUsageFacts> = {},
): { ok: true } & DashboardUsageFacts => ({
  ok: true,
  asOf: ASOF,
  templates: [template],
  versions: [v2, v1],
  consumers: [{ id: "coral", name: "Coral" }],
  cells: [cell],
  sparks: [],
  series: [],
  ...over,
});

const templateFacts = (
  over: Partial<TemplateUsageFacts> = {},
): { ok: true } & TemplateUsageFacts => ({
  ok: true,
  asOf: ASOF,
  template,
  allowedChannels: ["pdf", "web", "email"],
  versions: [v2, v1],
  consumers: [{ id: "coral", name: "Coral" }],
  cells: [cell],
  sparks: [],
  series: [],
  recentErrors: [],
  ...over,
});

const unavailable = (code: "space" | "template") => ({
  ok: false as const,
  status: 404 as const,
  ...(code === "space"
    ? REQUEST_REFUSALS.spaceUnavailable
    : REQUEST_REFUSALS.templateUnavailable),
});

beforeEach(() => {
  env.asked = [];
  env.dashboard = dashboardFacts();
  env.template = templateFacts();
});

describe("getUsageDashboard", () => {
  it("asks the service for the space's team by id, and lays the counts out for that space", async () => {
    const dashboard = await getUsageDashboard("coral-offers");
    expect(env.asked).toEqual([
      { method: "dashboard", input: { teamId: "t_coral" } },
    ]);
    expect(dashboard).toMatchObject({
      space: { slug: "coral-offers", name: "Coral Offers", isAll: false },
      asOf: ASOF,
      today: "2026-10-04",
      stats: {
        renders: { value: 100, previous: 50, trendPct: 100 },
        activeTemplates: { value: 1 },
        consumers: { value: 1 },
        nearingSunset: {
          value: 1,
          soonest: {
            templateName: "Balance Transfer Intro — Terms",
            versionNumber: 1,
            daysAway: 21,
          },
        },
      },
      success: { ok: 90, errors: 10, pct: 90 },
      byChannel: { web: 100, pdf: 0, email: 0, push: 0, sms: 0 },
      rows: [
        {
          consumer: { id: "coral", name: "Coral" },
          template: { id: BALANCE_TRANSFER, teamSlug: "coral-offers" },
          versionNumber: 2,
          renders30d: 100,
          errors30d: 10,
        },
      ],
    });
  });

  it("asks for every team (a null team id) in All teams, and says so in the space", async () => {
    const dashboard = await getUsageDashboard("all");
    expect(env.asked).toEqual([
      { method: "dashboard", input: { teamId: null } },
    ]);
    expect(dashboard.space).toEqual({
      slug: "all",
      name: "All teams",
      isAll: true,
    });
  });

  it("counts nothing for a space with no renders: a zero, no rate, no trend", async () => {
    env.dashboard = dashboardFacts({ templates: [], versions: [], cells: [] });
    const dashboard = await getUsageDashboard("deposits");
    expect(dashboard.stats.renders).toMatchObject({
      value: 0,
      previous: 0,
      trendPct: null,
    });
    expect(dashboard.success.pct).toBeNull();
    expect(dashboard.rows).toEqual([]);
  });

  it("is Not found when the service refuses the space", async () => {
    env.dashboard = unavailable("space");
    await expect(getUsageDashboard("coral-offers")).rejects.toThrow(NOT_FOUND);
  });
});

describe("getTemplateUsage", () => {
  it("asks the service for the template by id, and lays its counts out", async () => {
    const usage = await getTemplateUsage("coral-offers", BALANCE_TRANSFER);
    expect(env.asked).toEqual([
      { method: "template", input: { templateId: BALANCE_TRANSFER } },
    ]);
    expect(usage).toMatchObject({
      template: {
        id: BALANCE_TRANSFER,
        name: "Balance Transfer Intro — Terms",
        teamSlug: "coral-offers",
      },
      asOf: ASOF,
      today: "2026-10-04",
      stats: {
        renders: { value: 100, previous: 50, trendPct: 100 },
        consumers: { value: 1 },
        errors: { value: 10 },
      },
      success: { ok: 90, errors: 10, pct: 90 },
      channels: ["pdf", "web", "email"],
      versions: [
        { number: 2, state: "active" },
        { number: 1, state: "superseded", sunsetPassed: false },
      ],
    });
  });

  it("is found in its team's space and in All teams", async () => {
    await expect(
      getTemplateUsage("coral-offers", BALANCE_TRANSFER),
    ).resolves.toMatchObject({ template: { id: BALANCE_TRANSFER } });
    await expect(
      getTemplateUsage("all", BALANCE_TRANSFER),
    ).resolves.toMatchObject({ template: { id: BALANCE_TRANSFER } });
  });

  it("is Not found in another team's space", async () => {
    await expect(
      getTemplateUsage("deposits", BALANCE_TRANSFER),
    ).rejects.toThrow(NOT_FOUND);
  });

  it("compares the template's team with the space's by id, never by slug", async () => {
    // A slug the URL doesn't use, on the right team's id: found.
    env.template = templateFacts({
      template: { ...template, teamId: "t_deposits", teamSlug: "coral-offers" },
    });
    await expect(
      getTemplateUsage("deposits", BALANCE_TRANSFER),
    ).resolves.toMatchObject({ template: { id: BALANCE_TRANSFER } });
    // The URL's own slug on another team's id: Not found.
    await expect(
      getTemplateUsage("coral-offers", BALANCE_TRANSFER),
    ).rejects.toThrow(NOT_FOUND);
  });

  it("is Not found when the service refuses the template", async () => {
    env.template = unavailable("template");
    await expect(
      getTemplateUsage("coral-offers", BALANCE_TRANSFER),
    ).rejects.toThrow(NOT_FOUND);
    await expect(getTemplateUsage("all", BALANCE_TRANSFER)).rejects.toThrow(
      NOT_FOUND,
    );
  });
});
