import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_AUDIT_SEARCH, parseCsv } from "@/domain/audit";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Person } from "@/domain/review-types";
import type { RequestContext } from "@/server/context/request";
import type {
  AuditEventFacts,
  AuditExportFacts,
  AuditPageFacts,
} from "@/server/services/audit";
import {
  auditExport,
  auditPageData,
  auditSearch,
  getAuditExport,
} from "./audit";

// The Audit page and its export as the BFF builds them: facts in (what the audit service answers), the rows,
// menus and CSV out. The shaping functions are pure, so these tests hand them facts directly; what the service
// decides (which events a space holds, the filters and their counts, who may read the log) is the contract
// suite's (src/server/services/contract/audit.ts). `getAuditExport` is checked for what it adds: the
// slugs resolved to ids, the refusals passed through.

const env = vi.hoisted(() => ({
  space: undefined as unknown,
  shell: undefined as unknown,
  exportRows: undefined as unknown,
  asked: [] as unknown[],
}));
vi.mock("@/server/services", () => ({
  services: () => ({
    identity: {
      space: async () => env.space,
      shell: async () => env.shell,
    },
    audit: {
      exportRows: async (_ctx: unknown, input: unknown) => {
        env.asked.push(input);
        return env.exportRows;
      },
    },
  }),
}));
vi.mock("./spaces", () => ({ requireSpace: vi.fn(), getShellFacts: vi.fn() }));

const ASOF = "2026-10-04T12:00:00.000Z";
const CORAL = { id: "t_coral", slug: "coral-offers", name: "Coral Offers" };
const DEPOSITS = { id: "t_deposits", slug: "deposits", name: "Deposits" };
const person = (id: string, name: string): Person => ({
  id,
  name,
  initials: name
    .split(" ")
    .map((w) => w[0])
    .join(""),
  hue: 10,
});
const PEOPLE = [
  person("alex", "Alex Kim"),
  person("devon", "Devon Lin"),
  person("riley", "Riley Brooks"),
];

function event(
  over: Partial<AuditEventFacts> & Pick<AuditEventFacts, "id" | "action">,
): AuditEventFacts {
  return {
    at: "2026-10-03T15:42:00.000Z",
    actorId: "alex",
    teamId: CORAL.id,
    templateId: null,
    templateName: null,
    templateCurrentName: null,
    details: null,
    version: null,
    ...over,
  };
}

const EVENTS: AuditEventFacts[] = [
  event({
    id: "e1",
    action: "version.submitted",
    at: "2026-10-04T09:00:00.000Z",
    templateId: "UC-4F7K2Q",
    templateName: "Cash Back — Card Terms",
    templateCurrentName: "Cash Back — Card Terms",
    version: { number: 3, round: 2, state: "in_review" },
    details: { note: "Ready." },
  }),
  event({
    id: "e2",
    action: "access.flagged_inactive",
    at: "2026-09-29T12:00:00.000Z",
    actorId: null,
    details: {
      userId: "devon",
      userName: "Devon Lin",
      suspendsAt: "2026-10-29T12:00:00.000Z",
    },
  }),
  event({
    id: "e3",
    action: "platform.config_changed",
    at: "2026-09-10T12:00:00.000Z",
    actorId: "riley",
    teamId: null,
    details: { area: "business_zone", from: "America/New_York", to: "UTC" },
  }),
  event({
    id: "e4",
    action: "template.created",
    at: "2026-09-01T12:00:00.000Z",
    teamId: DEPOSITS.id,
    templateId: "UC-9ZZZZZ",
    templateName: "Fee Schedule",
    templateCurrentName: "Fee Schedule",
  }),
];

const page = (over: Partial<AuditPageFacts> = {}): AuditPageFacts => ({
  asOf: ASOF,
  teams: [CORAL, DEPOSITS],
  applied: { ...NO_AUDIT_SEARCH },
  total: EVENTS.length,
  events: EVENTS,
  options: {
    teams: [
      { id: CORAL.id, count: 2 },
      { id: DEPOSITS.id, count: 1 },
    ],
    people: [
      { id: "system", count: 1 },
      { id: "riley", count: 1 },
      { id: "devon", count: 1 },
      { id: "alex", count: 2 },
    ],
    categories: [
      { category: "templates", count: 2 },
      { category: "access", count: 1 },
      { category: "platform", count: 1 },
    ],
    actions: [
      { action: "version.submitted", count: 1 },
      { action: "access.flagged_inactive", count: 1 },
      { action: "platform.config_changed", count: 1 },
      { action: "template.created", count: 1 },
      { action: "version.fancy_thing", count: 4 },
    ],
    templates: [
      { id: "UC-9ZZZZZ", name: "Fee Schedule", teamId: DEPOSITS.id, count: 1 },
      {
        id: "UC-4F7K2Q",
        name: "Cash Back — Card Terms",
        teamId: CORAL.id,
        count: 1,
      },
    ],
  },
  people: PEOPLE,
  ...over,
});
const ALL = { slug: "all", isAll: true, name: "All teams" };

describe("auditPageData: the rows", () => {
  it("words each event: a sentence, the labels, and its times counted from asOf", () => {
    const { rows } = auditPageData(page(), ALL);
    expect(rows.map((r) => r.id)).toEqual(["e1", "e2", "e3", "e4"]);
    for (const r of rows) {
      expect(r.summary, r.action).toMatch(/[.]$/);
      expect(r.actionLabel).toBeTruthy();
      // UTC, labelled; the year only when it isn't the as-of year.
      expect(r.when).toMatch(
        /^[A-Z][a-z]{2} \d{1,2}, (20\d\d, )?\d{1,2}:\d\d [AP]M UTC$/,
      );
    }
    expect(rows[1]).toMatchObject({
      actor: null,
      subject: { id: "devon", name: "Devon Lin" },
      category: "access",
      actionLabel: "Flagged inactive",
      ago: "5 days ago",
    });
    expect(rows[1]!.summary).toBe(
      "Devon Lin hasn't signed in for 90 days: suspends automatically on October 29, 2026.",
    );
    expect(rows[2]).toMatchObject({
      category: "platform",
      team: null,
      actionLabel: "Configuration changed",
    });
  });

  it("names a row's team by slug and name, its template as its version had it, and its version", () => {
    const [submitted, , , created] = auditPageData(page(), ALL).rows;
    expect(submitted).toMatchObject({
      team: { slug: "coral-offers", name: "Coral Offers" },
      template: { id: "UC-4F7K2Q", name: "Cash Back — Card Terms" },
      versionLabel: "v3 · Round 2",
      actor: { id: "alex" },
    });
    expect(created).toMatchObject({
      team: { slug: "deposits" },
      template: { id: "UC-9ZZZZZ", name: "Fee Schedule" },
      versionLabel: null,
    });
  });

  it("names an event's template by the name its version had, not today's", () => {
    const renamed = event({
      id: "e5",
      action: "version.submitted",
      templateId: "UC-4F7K2Q",
      templateName: "Cash Back — Terms",
      templateCurrentName: "Cash Back — Card Terms",
      version: { number: 1, round: 1, state: "superseded" },
    });
    const data = auditPageData(page({ events: [renamed] }), ALL);
    expect(data.rows[0]!.template!.name).toBe("Cash Back — Terms");
    // The Template menu lists the template by the name it has now.
    expect(data.options.templates.find((t) => t.id === "UC-4F7K2Q")!.name).toBe(
      "Cash Back — Card Terms",
    );
  });
});

describe("auditPageData: the menus", () => {
  const { options, ...rest } = auditPageData(page(), ALL);

  it("lists the teams by name, with their slugs and counts", () => {
    expect(options.teams).toEqual([
      { slug: "coral-offers", name: "Coral Offers", count: 2 },
      { slug: "deposits", name: "Deposits", count: 1 },
    ]);
    expect(
      auditPageData(page({ options: { ...page().options, teams: [] } }), {
        slug: "deposits",
        isAll: false,
        name: "Deposits",
      }).options.teams,
    ).toEqual([]);
  });

  it("lists people by name with the system last, and the categories and actions by their labels", () => {
    expect(options.people.map((p) => [p.id, p.name, p.count])).toEqual([
      ["alex", "Alex Kim", 2],
      ["devon", "Devon Lin", 1],
      ["riley", "Riley Brooks", 1],
      ["system", "Stencil", 1],
    ]);
    expect(options.categories).toEqual([
      { value: "templates", label: "Templates", count: 2 },
      { value: "access", label: "Access", count: 1 },
      { value: "platform", label: "Platform", count: 1 },
    ]);
    // The catalog's order and labels; an action it doesn't know isn't offered.
    expect(options.actions.map((a) => [a.value, a.label, a.count])).toEqual([
      ["template.created", "Template created", 1],
      ["version.submitted", "Submitted", 1],
      ["access.flagged_inactive", "Flagged inactive", 1],
      ["platform.config_changed", "Configuration changed", 1],
    ]);
  });

  it("lists templates by name with their team's slug, and the date presets ending at asOf's day", () => {
    expect(options.templates).toEqual([
      {
        id: "UC-4F7K2Q",
        name: "Cash Back — Card Terms",
        teamSlug: "coral-offers",
        count: 1,
      },
      { id: "UC-9ZZZZZ", name: "Fee Schedule", teamSlug: "deposits", count: 1 },
    ]);
    expect(options.datePresets.map((p) => [p.days, p.from, p.to])).toEqual([
      [7, "2026-09-28", "2026-10-04"],
      [30, "2026-09-05", "2026-10-04"],
      [90, "2026-07-07", "2026-10-04"],
    ]);
    expect(rest.today).toBe("2026-10-04");
  });
});

describe("auditPageData: the applied filters", () => {
  it("puts the search the service applied back in the URL's terms: team slugs, comma lists", () => {
    const data = auditPageData(
      page({
        applied: {
          teamIds: [CORAL.id, DEPOSITS.id],
          personIds: ["alex"],
          actions: ["access"],
          templateIds: ["UC-4F7K2Q"],
          from: "2026-09-01",
          to: "2026-10-04",
        },
        total: 12,
      }),
      ALL,
    );
    expect(data.applied).toEqual({
      team: "coral-offers,deposits",
      person: "alex",
      action: "access",
      template: "UC-4F7K2Q",
      from: "2026-09-01",
      to: "2026-10-04",
    });
    expect(data.total).toBe(12);
    expect(data.csvHref).toBe(
      "/all/audit/export?team=coral-offers,deposits&person=alex&action=access&template=UC-4F7K2Q&from=2026-09-01&to=2026-10-04",
    );
    expect(data.space).toEqual(ALL);
  });

  it("has no query when nothing is filtered", () => {
    expect(auditPageData(page(), ALL).csvHref).toBe("/all/audit/export");
  });
});

describe("auditSearch", () => {
  const spaces = [
    { teamId: null, slug: "all" },
    { teamId: CORAL.id, slug: CORAL.slug },
    { teamId: DEPOSITS.id, slug: DEPOSITS.slug },
  ];

  it("resolves the URL's team slugs to ids and keeps the other filters", () => {
    expect(
      auditSearch(
        {
          team: "deposits,coral-offers",
          person: "alex,system",
          action: "access,version.approved",
          template: "UC-4F7K2Q",
          from: "2026-09-01",
          to: "2026-10-04",
        },
        spaces,
      ),
    ).toEqual({
      teamIds: [DEPOSITS.id, CORAL.id],
      personIds: ["alex", "system"],
      actions: ["access", "version.approved"],
      templateIds: ["UC-4F7K2Q"],
      from: "2026-09-01",
      to: "2026-10-04",
    });
  });

  it("drops a slug no team has, and the slug 'all', which is no team", () => {
    expect(auditSearch({ team: "nowhere,all" }, spaces)).toEqual(
      NO_AUDIT_SEARCH,
    );
    expect(auditSearch({}, spaces)).toEqual(NO_AUDIT_SEARCH);
  });
});

describe("auditExport", () => {
  const facts: AuditExportFacts = {
    asOf: ASOF,
    teams: [CORAL, DEPOSITS],
    events: [
      ...EVENTS,
      event({
        id: "e5",
        action: "access.requested",
        details: {
          userId: "morgan",
          userName: "Morgan Lee",
          role: "author",
          reason: "I'm joining the Offers content team next week, for spring.",
        },
      }),
    ],
    people: PEOPLE,
  };

  it("names the file after the space and the day of asOf, and writes one line per event", () => {
    const out = auditExport(facts, "all");
    expect(out.filename).toBe("stencil-audit-all-2026-10-04.csv");
    expect(out.count).toBe(5);
    const lines = parseCsv(out.csv);
    expect(lines[0]).toEqual([
      "When",
      "Who",
      "Team",
      "Template",
      "Version",
      "Action",
      "Details",
    ]);
    expect(lines).toHaveLength(6);
    expect(lines[1]![0]).toBe("2026-10-04T09:00:00.000Z");
    // A platform-wide event has no team; a template cell names the template as its version had it.
    expect(lines[3]![2]).toBe("All teams");
    expect(lines[1]![3]).toBe("Cash Back — Card Terms (UC-4F7K2Q)");
    expect(lines[1]![4]).toBe("v3 · Round 2");
  });

  it("keeps a comma and an apostrophe in a request's reason through the round trip", () => {
    const request = parseCsv(auditExport(facts, "all").csv).find(
      (l) => l[5] === "Access requested",
    )!;
    expect(request[6]).toContain(
      "I'm joining the Offers content team next week, for spring.",
    );
  });
});

describe("getAuditExport", () => {
  const ctx = { viewer: { userId: "taylor" } } as RequestContext;

  beforeEach(() => {
    env.asked = [];
    env.space = {
      ok: true,
      space: { teamId: null, slug: "all", name: "All teams", kind: "all" },
    };
    env.shell = {
      ok: true,
      spaces: [
        { teamId: null, slug: "all" },
        { teamId: CORAL.id, slug: CORAL.slug },
      ],
    };
    env.exportRows = {
      ok: true,
      asOf: ASOF,
      teams: [CORAL],
      events: [],
      people: [],
    };
  });

  it("asks for the space's team by id, with the team filter's slugs resolved", async () => {
    const out = await getAuditExport(ctx, "all", {
      team: "coral-offers",
      action: "access",
    });
    expect(out).toMatchObject({
      ok: true,
      filename: "stencil-audit-all-2026-10-04.csv",
      count: 0,
    });
    expect(env.asked).toEqual([
      {
        teamId: null,
        search: {
          ...NO_AUDIT_SEARCH,
          teamIds: [CORAL.id],
          actions: ["access"],
        },
      },
    ]);
  });

  it("passes the space's refusal through: a team that isn't the viewer's to enter is 404", async () => {
    env.space = {
      ok: false,
      status: 404,
      ...REQUEST_REFUSALS.spaceUnavailable,
    };
    expect(await getAuditExport(ctx, "nowhere", {})).toEqual(env.space);
    expect(env.asked).toEqual([]);
  });

  it("passes the service's refusal through: no audit.view there is 403", async () => {
    env.exportRows = { ok: false, status: 403, ...REASONS.generic };
    expect(await getAuditExport(ctx, "all", {})).toEqual(env.exportRows);
  });
});
