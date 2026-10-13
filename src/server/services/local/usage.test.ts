import type { Client } from "@libsql/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { templateUsage, usageDashboard } from "@/domain/golive/usage";
import {
  HEATMAP_WEEKS,
  HISTORY_DAYS,
  TREND_WEEKS,
  USAGE_WINDOW_DAYS,
} from "@/domain/golive-types";
import { CHANNELS, type Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { RequestContext } from "../types";
import { localServices } from "./index";

// The local usage service against a temporary database filled by the real seed (~27k render_log rows), read
// the way the BFF reads it: the service answers the counts, the domain's `usageDashboard` and `templateUsage`
// lay them out, and every number is compared with direct SQL.
//   - Balance Transfer v1 is Superseded with a sunset in 21 days and Coral still renders it; v2 Active;
//   - Holiday Points v1 is Revoked (its renders stopped 34 days ago);
//   - a handful of failed renders (Cash Back v2, Rate Change, High-Yield Savings v2).

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-usage-local-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;

/** The backend's clock: every test starts at the seed's base and may move it. */
let now = BASE;
const services = localServices({ clock: async () => now });

let db: Db;
let libsql: Client;
const people: Record<string, Viewer> = {};

const ids = seededDatabasePerTest({ base: BASE });

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  for (const id of ["maya", "riley", "eli"])
    people[id] = await loadPersona(db, id);
});

beforeEach(() => {
  now = BASE;
});

function as(userId: string): RequestContext {
  return {
    viewer: people[userId]!,
    correlationId: "req_test",
    credential: { kind: "in_process", userId },
  };
}

/** The spaces the BFF resolves a URL slug to: a team by id, or every team. */
const SPACES = {
  "coral-offers": { teamId: "t_coral", name: "Coral Offers" },
  deposits: { teamId: "t_deposits", name: "Deposits" },
  all: { teamId: null, name: "All teams" },
} as const;

/** The dashboard as the BFF lays it out: the service's counts through `usageDashboard`. */
async function dashboard(userId: string, slug: keyof typeof SPACES) {
  const space = SPACES[slug];
  const facts = await services.usage.dashboard(as(userId), {
    teamId: space.teamId,
  });
  if (!facts.ok) throw new Error(`${slug}: ${facts.reason}`);
  return usageDashboard(facts, {
    slug,
    name: space.name,
    isAll: space.teamId === null,
  });
}

/** One template's Usage tab as the BFF lays it out: the service's counts through `templateUsage`. */
async function templateTab(userId: string, templateId: string) {
  const facts = await services.usage.template(as(userId), { templateId });
  if (!facts.ok) throw new Error(`${templateId}: ${facts.reason}`);
  return templateUsage(facts);
}

/** Direct SQL: one number from render_log, usage rows only, for a team (or every team). */
async function direct(
  where: string,
  team: string | null,
  args: (string | number)[] = [],
): Promise<number> {
  const teamClause = team
    ? "and template_id in (select id from templates where team_id = ?)"
    : "";
  const result = await libsql.execute({
    sql: `select count(*) as n from render_log where is_preview = 0 and consumer_id is not null and coalesce(error_code, '') <> 'unknown_consumer' and at <= ? ${teamClause} and ${where}`,
    args: [now.getTime(), ...(team ? [team] : []), ...args],
  });
  return Number(result.rows[0]!.n);
}

const since = () => now.getTime() - USAGE_WINDOW_DAYS * DAY;

async function insertRows(rows: (typeof schema.renderLog.$inferInsert)[]) {
  await db.insert(schema.renderLog).values(rows);
}

async function versionIdOf(
  templateId: string,
  number: number,
): Promise<string> {
  const result = await libsql.execute({
    sql: "select id from versions where template_id = ? and number = ?",
    args: [templateId, number],
  });
  return String(result.rows[0]!.id);
}

function logRow(o: {
  id: string;
  at: number;
  templateId: string;
  versionId: string;
  versionNumber: number | null;
  consumerId: string | null;
  channel?: (typeof schema.renderLog.$inferInsert)["channel"];
  platform?: (typeof schema.renderLog.$inferInsert)["platform"];
  isPreview?: boolean;
  outcome?: "ok" | "error";
  errorCode?: string;
}) {
  return {
    id: o.id,
    at: new Date(o.at),
    templateId: o.templateId,
    versionId: o.versionId,
    versionNumber: o.versionNumber,
    consumerId: o.consumerId,
    channel: o.channel ?? ("pdf" as const),
    platform: o.platform ?? null,
    isPreview: o.isPreview ?? false,
    correlationId: `req_${o.id}`,
    outcome: o.outcome ?? ("ok" as const),
    errorCode: o.outcome === "error" ? (o.errorCode ?? "invalid_values") : null,
    durationMs: 100,
  };
}

describe("usage.dashboard", () => {
  it("Coral Offers: the numbers match direct SQL", async () => {
    const d = await dashboard("maya", "coral-offers");
    const s = since();
    const prev = s - USAGE_WINDOW_DAYS * DAY;
    // One denominator: a render is an attempt, succeeded or failed.
    const ok = await direct("outcome = 'ok' and at >= ?", "t_coral", [s]);
    const errors = await direct("outcome = 'error' and at >= ?", "t_coral", [
      s,
    ]);
    const renders = ok + errors;
    const previous = await direct("at >= ? and at < ?", "t_coral", [prev, s]);

    expect(d.space).toEqual({
      slug: "coral-offers",
      name: "Coral Offers",
      isAll: false,
    });
    expect(d.today).toBe("2026-10-04");
    expect(ok).toBeGreaterThan(1000);
    expect(d.stats.renders).toMatchObject({ value: renders, previous });
    expect(d.stats.renders.trendPct).toBe(
      Math.round(((renders - previous) / previous) * 1000) / 10,
    );
    expect(d.stats.renders.display).toMatch(/^\d+(\.\d)?k$/);
    expect(d.success).toEqual({
      ok,
      errors,
      pct: Math.round((ok / renders) * 1000) / 10,
    });
    expect(errors).toBeGreaterThan(0);

    // Every breakdown adds up to the same total.
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(Object.values(d.byChannel))).toBe(renders);
    expect(sum(d.byTemplate.map((t) => t.renders))).toBe(renders);
    expect(sum(d.byConsumer.map((c) => c.renders))).toBe(renders);
    expect(sum(d.rows.map((r) => r.renders30d))).toBe(renders);
    expect(sum(d.rows.map((r) => r.errors30d))).toBe(errors);
    expect(d.onActive.active + d.onActive.other).toBe(renders);
    // Failures reconcile: no row has more failures than renders, and the Failures card's rate is the same ratio.
    expect(d.rows.every((r) => r.errors30d <= r.renders30d)).toBe(true);
    expect(d.byTemplate.map((t) => t.renders)).toEqual(
      [...d.byTemplate.map((t) => t.renders)].sort((a, b) => b - a),
    );

    const consumers = await libsql.execute({
      sql: "select count(distinct consumer_id) as n from render_log where is_preview = 0 and consumer_id is not null and at >= ? and at <= ? and template_id in (select id from templates where team_id = 't_coral')",
      args: [s, now.getTime()],
    });
    expect(d.stats.consumers.value).toBe(Number(consumers.rows[0]!.n));
    expect(d.byConsumer.map((c) => c.consumer.name)).toEqual(["Coral"]);
  });

  it("Balance Transfer v1 is nearing sunset in 21 days, tagged on Coral's row, and is the gauge's 'other' share", async () => {
    const d = await dashboard("maya", "coral-offers");
    expect(d.stats.nearingSunset).toMatchObject({
      value: 1,
      display: "1",
      soonest: {
        templateName: "Balance Transfer Intro — Terms",
        versionNumber: 1,
        daysAway: 21,
      },
    });
    const v1 = d.rows.find(
      (r) => r.template.id === ids["balance-transfer"] && r.versionNumber === 1,
    )!;
    // The sunset is a day in the business time zone: October 25, 00:00 Eastern.
    expect(v1).toMatchObject({
      consumer: { id: "coral", name: "Coral" },
      versionState: "superseded",
      sunsetDay: "2026-10-25",
      sunsetPassed: false,
    });
    expect(v1.tags).toEqual([{ tone: "warning", text: "sunset in 21 days" }]);
    expect(v1.spark).toHaveLength(USAGE_WINDOW_DAYS);
    expect(v1.spark.at(-1)).toBeGreaterThan(0); // the seed's latest v1 render was 37 minutes ago
    expect(d.onActive.otherVersions).toEqual([
      {
        template: {
          id: ids["balance-transfer"],
          name: "Balance Transfer Intro — Terms",
        },
        versionNumber: 1,
        renders: v1.renders30d,
      },
    ]);

    // Tagged rows first: danger (failed renders), then the warning, then the rest by renders.
    const ranks = d.rows.map((r) =>
      r.tags.some((t) => t.tone === "danger")
        ? 0
        : r.tags.some((t) => t.tone === "warning")
          ? 1
          : 2,
    );
    expect(ranks).toEqual([...ranks].sort());
    expect(d.rows[0]!.tags[0]).toMatchObject({
      tone: "danger",
      text: expect.stringMatching(/^\d+ failed renders?$/),
    });
    // The revoked Holiday Points v1 stopped rendering 34 days ago: not in the last 30 days.
    expect(
      d.rows.some(
        (r) => r.template.id === ids["holiday-points"] && r.versionNumber === 1,
      ),
    ).toBe(false);
  });

  it("series: an 18-week heatmap with levels 0–4, 13 weeks, 90 days, all matching SQL", async () => {
    const d = await dashboard("maya", "coral-offers");
    expect(d.heatmap.weeks).toHaveLength(HEATMAP_WEEKS);
    const cells = d.heatmap.weeks.flat();
    expect(new Set(cells.map((c) => c.level))).toEqual(
      new Set([0, 1, 2, 3, 4]),
    );
    expect(cells.at(-1)!.date >= d.today).toBe(true);
    const first = Date.parse(`${cells[0]!.date}T00:00:00Z`);
    expect(d.heatmap.total).toBe(await direct("at >= ?", "t_coral", [first]));
    expect(d.heatmap.busiest!.count).toBe(
      Math.max(...cells.map((c) => c.count)),
    );

    expect(d.weekly).toHaveLength(TREND_WEEKS);
    expect(d.daily).toHaveLength(HISTORY_DAYS);
    expect(d.daily.at(-1)!.date).toBe(d.today);
    const day = d.daily.find((x) => x.date === "2026-09-12")!; // the Cash Back burst of failures (22.3 days ago)
    const start = Date.parse("2026-09-12T00:00:00Z");
    expect(day.errors).toBe(
      await direct("outcome = 'error' and at >= ? and at < ?", "t_coral", [
        start,
        start + DAY,
      ]),
    );
    expect(day.count).toBe(
      await direct("at >= ? and at < ?", "t_coral", [start, start + DAY]),
    );
    expect(day.errors).toBeLessThanOrEqual(day.count);
    const week = d.weekly.at(-2)!;
    const ws = Date.parse(`${week.weekStart}T00:00:00Z`);
    expect(week.count).toBe(
      await direct("at >= ? and at < ?", "t_coral", [ws, ws + 7 * DAY]),
    );
    // Every channel's renders, the Payment Due Reminder alert's push and SMS among them.
    expect(
      CHANNELS.reduce((sum, channel) => sum + week.channels[channel], 0),
    ).toBe(week.count);
    expect(week.channels.push).toBeGreaterThan(0);
    expect(week.channels.sms).toBeGreaterThan(0);
  });

  it("previews and consumer-less rows never count", async () => {
    const before = await dashboard("maya", "coral-offers");
    const bt = ids["balance-transfer"]!;
    const v2 = await versionIdOf(bt, 2);
    const t = now.getTime() - 3_600_000;
    await insertRows([
      logRow({
        id: "rl_test_preview",
        at: t,
        templateId: bt,
        versionId: v2,
        versionNumber: 2,
        consumerId: null,
        isPreview: true,
      }),
      logRow({
        id: "rl_test_preview_c",
        at: t,
        templateId: bt,
        versionId: v2,
        versionNumber: 2,
        consumerId: "coral",
        isPreview: true,
      }),
      logRow({
        id: "rl_test_noconsumer",
        at: t,
        templateId: bt,
        versionId: v2,
        versionNumber: 2,
        consumerId: null,
      }),
      logRow({
        id: "rl_test_noconsumer_err",
        at: t,
        templateId: bt,
        versionId: v2,
        versionNumber: 2,
        consumerId: null,
        outcome: "error",
      }),
    ]);
    expect(await dashboard("maya", "coral-offers")).toEqual(before);
  });

  it("a caller refused as an unknown consumer is not a consumer: no row, no count, no recent error", async () => {
    const before = await dashboard("maya", "coral-offers");
    const bt = ids["balance-transfer"]!;
    const v2 = await versionIdOf(bt, 2);
    const t = now.getTime() - 3_600_000;
    const typo = (id: string) =>
      logRow({
        id,
        at: t,
        templateId: bt,
        versionId: v2,
        versionNumber: 2,
        consumerId: "corall",
        outcome: "error",
        errorCode: "unknown_consumer",
      });
    await insertRows([
      typo("rl_test_typo_1"),
      typo("rl_test_typo_2"),
      typo("rl_test_typo_3"),
    ]);
    expect(await dashboard("maya", "coral-offers")).toEqual(before);
    const usage = await templateTab("maya", bt);
    expect(JSON.stringify(usage)).not.toContain("orall");
  });

  it("window boundaries follow the clock: exactly 30 days ago is in, a millisecond earlier is the previous window, the future is out", async () => {
    const before = await dashboard("maya", "coral-offers");
    const rc = ids["rate-change-notice"]!;
    const v1 = await versionIdOf(rc, 1);
    const s = since();
    await insertRows([
      logRow({
        id: "rl_test_edge_in",
        at: s,
        templateId: rc,
        versionId: v1,
        versionNumber: 1,
        consumerId: "coral",
      }),
      logRow({
        id: "rl_test_edge_prev",
        at: s - 1,
        templateId: rc,
        versionId: v1,
        versionNumber: 1,
        consumerId: "coral",
      }),
      logRow({
        id: "rl_test_future",
        at: now.getTime() + 60_000,
        templateId: rc,
        versionId: v1,
        versionNumber: 1,
        consumerId: "coral",
      }),
    ]);
    const after = await dashboard("maya", "coral-offers");
    expect(after.stats.renders.value).toBe(before.stats.renders.value + 1);
    expect(after.stats.renders.previous).toBe(
      before.stats.renders.previous + 1,
    );
    expect(after.daily.at(-1)).toEqual(before.daily.at(-1));
  });

  it("advancing the clock past the sunset turns the tag to danger and empties 'nearing sunset'", async () => {
    now = new Date(BASE.getTime() + 22 * DAY);
    const d = await dashboard("maya", "coral-offers");
    expect(d.today).toBe("2026-10-26");
    expect(d.stats.nearingSunset).toMatchObject({ value: 0, soonest: null });
    const v1 = d.rows.find(
      (r) => r.template.id === ids["balance-transfer"] && r.versionNumber === 1,
    )!;
    expect(v1.tags).toEqual([{ tone: "danger", text: "renders fail" }]);
    expect(v1).toMatchObject({ sunsetDay: "2026-10-25", sunsetPassed: true });
    expect(d.stats.renders.value).toBe(
      await direct("at >= ?", "t_coral", [since()]),
    );
  });

  it("answers the instant it counted at", async () => {
    now = new Date(BASE.getTime() + 3 * DAY);
    const facts = await services.usage.dashboard(as("maya"), {
      teamId: "t_coral",
    });
    expect(facts).toMatchObject({ ok: true, asOf: now.toISOString() });
  });

  it("'all' spans every team (Riley, platform admin)", async () => {
    const d = await dashboard("riley", "all");
    expect(d.space).toEqual({ slug: "all", name: "All teams", isAll: true });
    expect(d.stats.renders.value).toBe(
      await direct("at >= ?", null, [since()]),
    );
    expect(d.byConsumer.map((c) => c.consumer.name).sort()).toEqual([
      "Coral",
      "Deposits Online",
    ]);
  });

  it("only the templates of the viewer's team count in a team space", async () => {
    const facts = await services.usage.dashboard(as("eli"), {
      teamId: "t_deposits",
    });
    if (!facts.ok) throw new Error(facts.reason);
    expect(facts.templates.length).toBeGreaterThan(0);
    expect(new Set(facts.templates.map((t) => t.teamId))).toEqual(
      new Set(["t_deposits"]),
    );
    expect(facts.templates.map((t) => t.id)).toContain(
      ids["high-yield-savings"],
    );
    expect(facts.templates.map((t) => t.id)).not.toContain(
      ids["balance-transfer"],
    );
    const counted = new Set(facts.templates.map((t) => t.id));
    expect(facts.cells.length).toBeGreaterThan(0);
    expect(facts.cells.every((c) => counted.has(c.templateId))).toBe(true);
    expect(facts.versions.every((v) => counted.has(v.templateId))).toBe(true);
  });

  it("refuses 404 space_unavailable for a space the viewer can't enter", async () => {
    // Eli is on Deposits only; Maya is on Coral Offers only, so All teams isn't hers either.
    expect(
      await services.usage.dashboard(as("eli"), { teamId: "t_coral" }),
    ).toMatchObject({ ok: false, status: 404, code: "space_unavailable" });
    expect(
      await services.usage.dashboard(as("maya"), { teamId: null }),
    ).toMatchObject({ ok: false, status: 404, code: "space_unavailable" });
  });

  // Speed, deterministically: a wall-clock budget failed under full-suite load (the machine, not the code).
  // What keeps these fast is that each read aggregates in a fixed number of SQL statements, however many
  // render_log rows there are (~27k in the seed), never one per template, consumer or day. So count the
  // statements; the time is logged for information only. Each count includes one read of the business time
  // zone (a sunset's day and the days to it are read there).
  it("reads in a fixed number of SQL statements, whatever the volume", async () => {
    await dashboard("riley", "all");
    // The client drizzle runs its statements on: `libsql` is a stand-in that follows the test's database, and
    // a spy on it never sees them.
    const client = (db as unknown as { $client: Client }).$client;
    const execute = vi.spyOn(client, "execute");
    const batch = vi.spyOn(client, "batch");
    try {
      for (const [name, run, most] of [
        ["dashboard, all teams", () => dashboard("riley", "all"), 7],
        ["dashboard, one team", () => dashboard("maya", "coral-offers"), 7],
        ["template", () => templateTab("maya", ids["balance-transfer"]!), 8],
      ] as const) {
        execute.mockClear();
        batch.mockClear();
        const t0 = performance.now();
        await run();
        const statements = execute.mock.calls.length + batch.mock.calls.length;
        console.info(
          `usage service (${name}): ${statements} statements, ${(performance.now() - t0).toFixed(1)} ms`,
        );
        expect(statements, `${name}: statements counted`).toBeGreaterThan(0);
        expect(statements, name).toBeLessThanOrEqual(most);
      }
    } finally {
      execute.mockRestore();
      batch.mockRestore();
    }
  });
});

describe("usage.template", () => {
  it("Balance Transfer: both versions, Coral on each, 'still on v1', weekly by version", async () => {
    const bt = ids["balance-transfer"]!;
    const u = await templateTab("maya", bt);
    const s = since();
    const ok = await direct("at >= ? and template_id = ?", null, [s, bt]);
    const v1ok = await direct(
      "at >= ? and template_id = ? and version_number = 1",
      null,
      [s, bt],
    );

    expect(u.template).toEqual({
      id: bt,
      name: "Balance Transfer Intro — Terms",
      teamSlug: "coral-offers",
    });
    expect(u.stats.renders.value).toBe(ok);
    expect(u.stats.consumers.value).toBe(1);
    expect(u.versions.map((v) => [v.number, v.state])).toEqual([
      [2, "active"],
      [1, "superseded"],
    ]);
    const v1 = u.versions[1]!;
    expect(v1).toMatchObject({
      sunsetPassed: false,
      revokedAt: null,
      tags: [{ tone: "warning", text: "sunset in 21 days" }],
    });
    expect(v1.consumers).toEqual([
      {
        id: "coral",
        name: "Coral",
        renders30d: v1ok,
        errors30d: 0,
        lastRenderAt: new Date(BASE.getTime() - 37 * 60_000).toISOString(),
      },
    ]);
    expect(u.stillOn).toEqual([
      {
        versionNumber: 1,
        state: "superseded",
        renders: v1ok,
        pct: Math.round((v1ok / ok) * 100),
      },
    ]);

    expect(u.weeklyVersions).toEqual([1, 2]);
    expect(u.weekly).toHaveLength(TREND_WEEKS);
    for (const w of u.weekly)
      expect(w.byVersion[1]! + w.byVersion[2]!).toBe(w.count);
    expect(u.daily).toHaveLength(HISTORY_DAYS);
    expect(u.rows.map((r) => r.versionNumber).sort()).toEqual([1, 2]);

    // The two failed v1 renders 31 days ago: outside the window, still the most recent errors.
    expect(u.stats.errors.value).toBe(0);
    expect(u.recentErrors).toHaveLength(2);
    expect(u.recentErrors[0]).toMatchObject({
      consumer: { id: "coral", name: "Coral" },
      versionNumber: 1,
      channel: "web",
      code: "invalid_values",
      text: "A value had the wrong format.",
    });
  });

  it("Holiday Points: the revoked v1 keeps its consumer (all time) and its danger tag", async () => {
    const u = await templateTab("maya", ids["holiday-points"]!);
    const v1 = u.versions.find((v) => v.number === 1)!;
    expect(v1.state).toBe("revoked");
    expect(v1.revokedAt).not.toBeNull();
    expect(v1.tags).toEqual([{ tone: "danger", text: "renders fail" }]);
    expect(v1.consumers.map((c) => [c.name, c.renders30d])).toEqual([
      ["Coral", 0],
    ]);
    expect(u.stillOn).toEqual([]);
  });

  it("High-Yield Savings: v2, sent back twice before its release, is its released row, never a sent-back round", async () => {
    const templateId = ids["high-yield-savings"]!;
    const u = await templateTab("eli", templateId);
    expect(u.versions.map((v) => [v.number, v.state])).toEqual([
      [2, "active"],
      [1, "superseded"],
    ]);
    const released = await libsql.execute({
      sql: "select activated_at from versions where template_id = ? and number = 2 and state = 'active'",
      args: [templateId],
    });
    expect(u.versions[0]!.activatedAt).toBe(
      new Date(Number(released.rows[0]!.activated_at)).toISOString(),
    );
    expect(u.versions[0]!.consumers.map((c) => c.name)).toEqual([
      "Deposits Online",
    ]);
    expect(
      new Set(
        u.rows.filter((r) => r.versionNumber === 2).map((r) => r.versionState),
      ),
    ).toEqual(new Set(["active"]));
  });

  it("one denominator: a template whose only render failed reads 1 render, 0% succeeded, 1 failed; with no renders there is no rate", async () => {
    // A clock long before any seeded render: both windows are empty.
    const templateId = ids["holiday-points"]!;
    const versionId = await versionIdOf(templateId, 1);
    now = new Date(BASE.getTime() - 400 * DAY);
    const none = await templateTab("maya", templateId);
    expect(none.success).toEqual({ ok: 0, errors: 0, pct: null });
    expect(none.stats.renders.value).toBe(0);
    await insertRows([
      logRow({
        id: "rl_test_only_failure",
        at: now.getTime() - 3_600_000,
        templateId,
        versionId,
        versionNumber: 1,
        consumerId: "coral",
        outcome: "error",
      }),
    ]);
    const u = await templateTab("maya", templateId);
    expect(u.success).toEqual({ ok: 0, errors: 1, pct: 0 });
    expect(u.stats.renders.value).toBe(1);
    expect(u.rows.map((r) => [r.renders30d, r.errors30d])).toEqual([[1, 1]]);
    expect(u.daily.at(-1)).toMatchObject({ count: 1, errors: 1 });
  });

  it("Balance Transfer, a document: renders by channel are PDF, Web and Email, and match direct SQL", async () => {
    const bt = ids["balance-transfer"]!;
    const u = await templateTab("maya", bt);
    const s = since();
    const count = (channel: string) =>
      direct("at >= ? and template_id = ? and channel = ?", null, [
        s,
        bt,
        channel,
      ]);

    expect(u.channels).toEqual(["pdf", "web", "email"]);
    expect(u.byChannel).toEqual({
      pdf: await count("pdf"),
      web: await count("web"),
      email: await count("email"),
      push: 0,
      sms: 0,
    });
    expect(u.byChannel.pdf + u.byChannel.web + u.byChannel.email).toBe(
      u.stats.renders.value,
    );
    expect(u.byChannel.web).toBeGreaterThan(0);
    // No phone for a document.
    expect(u.pushByPlatform).toEqual({ ios: 0, android: 0, unrecorded: 0 });
    expect(u.recentErrors.every((e) => e.platform === null)).toBe(true);
  });

  it("Payment Due Reminder, an alert: renders by channel are Push and SMS, and Push splits into iPhone and Android", async () => {
    const alert = ids["payment-due-reminder"]!;
    const u = await templateTab("maya", alert);
    const s = since();
    const count = (where: string) =>
      direct(`at >= ? and template_id = ? and ${where}`, null, [s, alert]);

    expect(u.channels).toEqual(["push", "sms"]);
    expect(u.byChannel).toEqual({
      pdf: 0,
      web: 0,
      email: 0,
      push: await count("channel = 'push'"),
      sms: await count("channel = 'sms'"),
    });
    expect(u.byChannel.push).toBeGreaterThan(0);
    expect(u.byChannel.sms).toBeGreaterThan(0);
    expect(u.byChannel.push + u.byChannel.sms).toBe(u.stats.renders.value);

    expect(u.pushByPlatform).toEqual({
      ios: await count("channel = 'push' and platform = 'ios'"),
      android: await count("channel = 'push' and platform = 'android'"),
      unrecorded: 0,
    });
    expect(u.pushByPlatform.ios).toBeGreaterThan(0);
    expect(u.pushByPlatform.android).toBeGreaterThan(0);
    expect(u.pushByPlatform.ios + u.pushByPlatform.android).toBe(
      u.byChannel.push,
    );

    // The seeded failures: the Android push is the latest, then the three SMS, which have no phone.
    expect(u.recentErrors.slice(0, 2)).toEqual([
      expect.objectContaining({
        channel: "push",
        platform: "android",
        code: "missing_variables",
      }),
      expect.objectContaining({
        channel: "push",
        platform: "android",
        code: "missing_variables",
      }),
    ]);
    expect(u.recentErrors.slice(2).map((e) => [e.channel, e.platform])).toEqual(
      [
        ["sms", null],
        ["sms", null],
        ["sms", null],
      ],
    );
  });

  it("the channel split counts live renders of the last 30 days only; a push with no recorded phone is its own count", async () => {
    const alert = ids["payment-due-reminder"]!;
    const versionId = await versionIdOf(alert, 1);
    now = new Date(BASE.getTime() - 400 * DAY);
    const at = now.getTime();
    const row = (id: string, o: Partial<Parameters<typeof logRow>[0]>) =>
      logRow({
        id: `rl_split_${id}`,
        at: at - 3_600_000,
        templateId: alert,
        versionId,
        versionNumber: 1,
        consumerId: "coral",
        channel: "push",
        ...o,
      });
    await insertRows([
      row("ios", { platform: "ios" }),
      row("ios-failed", {
        platform: "ios",
        outcome: "error",
        errorCode: "missing_variables",
      }),
      row("android", { platform: "android" }),
      // Logged before the platform was kept.
      row("legacy", {}),
      row("sms", { channel: "sms" }),
      // Not usage, or not in the window: previews, an unregistered caller, 31 days ago.
      row("preview", { platform: "ios", isPreview: true, consumerId: null }),
      row("unknown", {
        platform: "ios",
        outcome: "error",
        errorCode: "unknown_consumer",
      }),
      row("old", { platform: "android", at: at - 31 * DAY }),
    ]);
    const u = await templateTab("maya", alert);
    expect(u.byChannel).toEqual({
      pdf: 0,
      web: 0,
      email: 0,
      push: 4,
      sms: 1,
    });
    expect(u.pushByPlatform).toEqual({ ios: 2, android: 1, unrecorded: 1 });
    // The failed iPhone push names its phone, the earlier SMS failures none.
    expect(u.recentErrors[0]).toMatchObject({
      channel: "push",
      platform: "ios",
      code: "missing_variables",
    });
  });

  it("recent errors: failures at one instant come back the later write first, and only the latest 10 are listed", async () => {
    const holiday = ids["holiday-points"]!;
    const versionId = await versionIdOf(holiday, 2);
    const hour = 3_600_000;
    const failure = (
      id: string,
      hoursAgo: number,
      errorCode: string,
    ): typeof schema.renderLog.$inferInsert =>
      logRow({
        id: `rl_err_${id}`,
        at: now.getTime() - hoursAgo * hour,
        templateId: holiday,
        versionId,
        versionNumber: 2,
        consumerId: "coral",
        outcome: "error",
        errorCode,
      });
    // Ten older failures, then two at one instant written one after the other (ascending rowid).
    await insertRows(
      Array.from({ length: 10 }, (_, i) =>
        failure(`older_${i}`, 2 + i, "invalid_values"),
      ),
    );
    await insertRows([failure("tie_first", 1, "missing_variables")]);
    await insertRows([failure("tie_second", 1, "render_failed")]);

    const facts = await services.usage.template(as("maya"), {
      templateId: holiday,
    });
    if (!facts.ok) throw new Error(facts.reason);
    expect(facts.recentErrors).toHaveLength(10);
    expect(facts.recentErrors.slice(0, 2).map((e) => e.code)).toEqual([
      "render_failed",
      "missing_variables",
    ]);
    // The eight newest of the older ones follow, newest first; the two oldest fall off the list.
    expect(facts.recentErrors.slice(2).map((e) => e.at)).toEqual(
      Array.from({ length: 8 }, (_, i) =>
        new Date(now.getTime() - (2 + i) * hour).toISOString(),
      ),
    );
    expect(templateUsage(facts).recentErrors).toHaveLength(10);
  });

  it("refuses 404 template_unavailable for a template the viewer can't see, as for one that doesn't exist", async () => {
    // Checking Fees is Deposits'; Maya is on Coral Offers only.
    expect(
      await services.usage.template(as("maya"), {
        templateId: ids["checking-fees"]!,
      }),
    ).toMatchObject({ ok: false, status: 404, code: "template_unavailable" });
    expect(
      await services.usage.template(as("maya"), { templateId: "UC-ZZZZZZ" }),
    ).toMatchObject({ ok: false, status: 404, code: "template_unavailable" });
  });

  it("a platform role sees any team's template, and the facts name its team", async () => {
    const facts = await services.usage.template(as("riley"), {
      templateId: ids["checking-fees"]!,
    });
    if (!facts.ok) throw new Error(facts.reason);
    expect(facts.template).toMatchObject({
      id: ids["checking-fees"],
      teamId: "t_deposits",
      teamSlug: "deposits",
    });
  });
});
