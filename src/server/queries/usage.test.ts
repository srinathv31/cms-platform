import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HEATMAP_WEEKS, HISTORY_DAYS, TREND_WEEKS, USAGE_WINDOW_DAYS } from "@/domain/golive-types";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { getTemplateUsage, getUsageDashboard } from "./usage";

// The Usage read models against a temporary database filled by the real seed (~27k render_log rows):
//   - Balance Transfer v1 is Superseded with a sunset in 21 days and Coral still renders it; v2 Active;
//   - Holiday Points v1 is Revoked (its renders stopped 34 days ago);
//   - a handful of failed renders (Cash Back v2, Rate Change, High-Yield Savings v2).

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-usage-queries-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
  for (const id of ["maya", "riley", "eli"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

function as(userId: string) {
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
}

/** Direct SQL: one number from render_log, usage rows only, for a team (or every team). */
async function direct(where: string, team: string | null, args: (string | number)[] = []): Promise<number> {
  const teamClause = team ? "and template_id in (select id from templates where team_id = ?)" : "";
  const result = await libsql.execute({
    sql: `select count(*) as n from render_log where is_preview = 0 and consumer_id is not null and coalesce(error_code, '') <> 'unknown_consumer' and at <= ? ${teamClause} and ${where}`,
    args: [env.now.getTime(), ...(team ? [team] : []), ...args],
  });
  return Number(result.rows[0]!.n);
}

const since = () => env.now.getTime() - USAGE_WINDOW_DAYS * DAY;

/** Insert render_log rows for a test and remove them after. */
async function withRows(rows: (typeof schema.renderLog.$inferInsert)[], run: () => Promise<void>) {
  await db.insert(schema.renderLog).values(rows);
  try {
    await run();
  } finally {
    await db.delete(schema.renderLog).where(inArray(schema.renderLog.id, rows.map((r) => r.id)));
  }
}

async function versionIdOf(templateId: string, number: number): Promise<string> {
  const result = await libsql.execute({ sql: "select id from versions where template_id = ? and number = ?", args: [templateId, number] });
  return String(result.rows[0]!.id);
}

function logRow(o: { id: string; at: number; templateId: string; versionId: string; versionNumber: number | null; consumerId: string | null; isPreview?: boolean; outcome?: "ok" | "error"; errorCode?: string }) {
  return {
    id: o.id,
    at: new Date(o.at),
    templateId: o.templateId,
    versionId: o.versionId,
    versionNumber: o.versionNumber,
    consumerId: o.consumerId,
    channel: "pdf" as const,
    isPreview: o.isPreview ?? false,
    correlationId: `req_${o.id}`,
    outcome: o.outcome ?? ("ok" as const),
    errorCode: o.outcome === "error" ? (o.errorCode ?? "invalid_values") : null,
    durationMs: 100,
  };
}

describe("getUsageDashboard", () => {
  it("Coral Offers: the numbers match direct SQL", async () => {
    as("maya");
    const d = await getUsageDashboard("coral-offers");
    const s = since();
    const prev = s - USAGE_WINDOW_DAYS * DAY;
    // One denominator: a render is an attempt, succeeded or failed.
    const ok = await direct("outcome = 'ok' and at >= ?", "coral-offers", [s]);
    const errors = await direct("outcome = 'error' and at >= ?", "coral-offers", [s]);
    const renders = ok + errors;
    const previous = await direct("at >= ? and at < ?", "coral-offers", [prev, s]);

    expect(d.space).toEqual({ slug: "coral-offers", name: "Coral Offers", isAll: false });
    expect(d.today).toBe("2026-10-04");
    expect(ok).toBeGreaterThan(1000);
    expect(d.stats.renders).toMatchObject({ value: renders, previous });
    expect(d.stats.renders.trendPct).toBe(Math.round(((renders - previous) / previous) * 1000) / 10);
    expect(d.stats.renders.display).toMatch(/^\d+(\.\d)?k$/);
    expect(d.success).toEqual({ ok, errors, pct: Math.round((ok / renders) * 1000) / 10 });
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
    expect(d.byTemplate.map((t) => t.renders)).toEqual([...d.byTemplate.map((t) => t.renders)].sort((a, b) => b - a));

    const consumers = await libsql.execute({
      sql: "select count(distinct consumer_id) as n from render_log where is_preview = 0 and consumer_id is not null and at >= ? and at <= ? and template_id in (select id from templates where team_id = 'coral-offers')",
      args: [s, env.now.getTime()],
    });
    expect(d.stats.consumers.value).toBe(Number(consumers.rows[0]!.n));
    expect(d.byConsumer.map((c) => c.consumer.name)).toEqual(["Coral"]);
  });

  it("Balance Transfer v1 is nearing sunset in 21 days, tagged on Coral's row, and is the gauge's 'other' share", async () => {
    as("maya");
    const d = await getUsageDashboard("coral-offers");
    expect(d.stats.nearingSunset).toMatchObject({
      value: 1,
      display: "1",
      soonest: { templateName: "Balance Transfer Intro — Terms", versionNumber: 1, daysAway: 21 },
    });
    const v1 = d.rows.find((r) => r.template.id === ids["balance-transfer"] && r.versionNumber === 1)!;
    // The sunset is a day in the business time zone: October 25, 00:00 Eastern.
    expect(v1).toMatchObject({ consumer: { id: "coral", name: "Coral" }, versionState: "superseded", sunsetDay: "2026-10-25" });
    expect(v1.tags).toEqual([{ tone: "warning", text: "sunset in 21 days" }]);
    expect(v1.spark).toHaveLength(USAGE_WINDOW_DAYS);
    expect(v1.spark.at(-1)).toBeGreaterThan(0); // the seed's latest v1 render was 37 minutes ago
    expect(d.onActive.otherVersions).toEqual([{ template: { id: ids["balance-transfer"], name: "Balance Transfer Intro — Terms" }, versionNumber: 1, renders: v1.renders30d }]);

    // Tagged rows first: danger (failed renders), then the warning, then the rest by renders.
    const ranks = d.rows.map((r) => (r.tags.some((t) => t.tone === "danger") ? 0 : r.tags.some((t) => t.tone === "warning") ? 1 : 2));
    expect(ranks).toEqual([...ranks].sort());
    expect(d.rows[0]!.tags[0]).toMatchObject({ tone: "danger", text: expect.stringMatching(/^\d+ failed renders?$/) });
    // The revoked Holiday Points v1 stopped rendering 34 days ago: not in the last 30 days.
    expect(d.rows.some((r) => r.template.id === ids["holiday-points"] && r.versionNumber === 1)).toBe(false);
  });

  it("series: an 18-week heatmap with levels 0–4, 13 weeks, 90 days, all matching SQL", async () => {
    as("maya");
    const d = await getUsageDashboard("coral-offers");
    expect(d.heatmap.weeks).toHaveLength(HEATMAP_WEEKS);
    const cells = d.heatmap.weeks.flat();
    expect(new Set(cells.map((c) => c.level))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(cells.at(-1)!.date >= d.today).toBe(true);
    const first = Date.parse(`${cells[0]!.date}T00:00:00Z`);
    expect(d.heatmap.total).toBe(await direct("at >= ?", "coral-offers", [first]));
    expect(d.heatmap.busiest!.count).toBe(Math.max(...cells.map((c) => c.count)));

    expect(d.weekly).toHaveLength(TREND_WEEKS);
    expect(d.daily).toHaveLength(HISTORY_DAYS);
    expect(d.daily.at(-1)!.date).toBe(d.today);
    const day = d.daily.find((x) => x.date === "2026-09-12")!; // the Cash Back burst of failures (22.3 days ago)
    const start = Date.parse("2026-09-12T00:00:00Z");
    expect(day.errors).toBe(await direct("outcome = 'error' and at >= ? and at < ?", "coral-offers", [start, start + DAY]));
    expect(day.count).toBe(await direct("at >= ? and at < ?", "coral-offers", [start, start + DAY]));
    expect(day.errors).toBeLessThanOrEqual(day.count);
    const week = d.weekly.at(-2)!;
    const ws = Date.parse(`${week.weekStart}T00:00:00Z`);
    expect(week.count).toBe(await direct("at >= ? and at < ?", "coral-offers", [ws, ws + 7 * DAY]));
    expect(week.channels.pdf + week.channels.web + week.channels.email).toBe(week.count);
  });

  it("previews and consumer-less rows never count", async () => {
    as("maya");
    const before = await getUsageDashboard("coral-offers");
    const bt = ids["balance-transfer"]!;
    const v2 = await versionIdOf(bt, 2);
    const t = env.now.getTime() - 3_600_000;
    await withRows(
      [
        logRow({ id: "rl_test_preview", at: t, templateId: bt, versionId: v2, versionNumber: 2, consumerId: null, isPreview: true }),
        logRow({ id: "rl_test_preview_c", at: t, templateId: bt, versionId: v2, versionNumber: 2, consumerId: "coral", isPreview: true }),
        logRow({ id: "rl_test_noconsumer", at: t, templateId: bt, versionId: v2, versionNumber: 2, consumerId: null }),
        logRow({ id: "rl_test_noconsumer_err", at: t, templateId: bt, versionId: v2, versionNumber: 2, consumerId: null, outcome: "error" }),
      ],
      async () => {
        const after = await getUsageDashboard("coral-offers");
        expect(after).toEqual(before);
      },
    );
  });

  it("a caller refused as an unknown consumer is not a consumer: no row, no count, no recent error", async () => {
    as("maya");
    const before = await getUsageDashboard("coral-offers");
    const bt = ids["balance-transfer"]!;
    const v2 = await versionIdOf(bt, 2);
    const t = env.now.getTime() - 3_600_000;
    const typo = (id: string) => logRow({ id, at: t, templateId: bt, versionId: v2, versionNumber: 2, consumerId: "corall", outcome: "error", errorCode: "unknown_consumer" });
    await withRows([typo("rl_test_typo_1"), typo("rl_test_typo_2"), typo("rl_test_typo_3")], async () => {
      expect(await getUsageDashboard("coral-offers")).toEqual(before);
      const usage = await getTemplateUsage("coral-offers", bt);
      expect(JSON.stringify(usage)).not.toContain("orall");
    });
  });

  it("window boundaries follow the demo clock: exactly 30 days ago is in, a millisecond earlier is the previous window, the future is out", async () => {
    as("maya");
    const before = await getUsageDashboard("coral-offers");
    const rc = ids["rate-change-notice"]!;
    const v1 = await versionIdOf(rc, 1);
    const s = since();
    await withRows(
      [
        logRow({ id: "rl_test_edge_in", at: s, templateId: rc, versionId: v1, versionNumber: 1, consumerId: "coral" }),
        logRow({ id: "rl_test_edge_prev", at: s - 1, templateId: rc, versionId: v1, versionNumber: 1, consumerId: "coral" }),
        logRow({ id: "rl_test_future", at: env.now.getTime() + 60_000, templateId: rc, versionId: v1, versionNumber: 1, consumerId: "coral" }),
      ],
      async () => {
        const after = await getUsageDashboard("coral-offers");
        expect(after.stats.renders.value).toBe(before.stats.renders.value + 1);
        expect(after.stats.renders.previous).toBe(before.stats.renders.previous + 1);
        expect(after.daily.at(-1)).toEqual(before.daily.at(-1));
      },
    );
  });

  it("advancing the clock past the sunset turns the tag to danger and empties 'nearing sunset'", async () => {
    as("maya");
    env.now = new Date(BASE.getTime() + 22 * DAY);
    try {
      const d = await getUsageDashboard("coral-offers");
      expect(d.today).toBe("2026-10-26");
      expect(d.stats.nearingSunset).toMatchObject({ value: 0, soonest: null });
      const v1 = d.rows.find((r) => r.template.id === ids["balance-transfer"] && r.versionNumber === 1)!;
      expect(v1.tags).toEqual([{ tone: "danger", text: "renders fail" }]);
      expect(d.stats.renders.value).toBe(await direct("at >= ?", "coral-offers", [since()]));
    } finally {
      env.now = BASE;
    }
  });

  it("'all' spans every team (Riley, platform admin)", async () => {
    as("riley");
    const d = await getUsageDashboard("all");
    expect(d.space).toEqual({ slug: "all", name: "All teams", isAll: true });
    expect(d.stats.renders.value).toBe(await direct("at >= ?", null, [since()]));
    expect(d.byConsumer.map((c) => c.consumer.name).sort()).toEqual(["Coral", "Deposits Online"]);
  });

  // Speed, deterministically: a wall-clock budget failed under full-suite load (the machine, not the code).
  // What keeps these fast is that each read model aggregates in a fixed number of SQL statements, however
  // many render_log rows there are (~27k in the seed), never one per template, consumer or day. So count
  // the statements; the time is logged for information only. Each count includes one read of the business
  // time zone (a sunset's day and the days to it are read there).
  it("reads in a fixed number of SQL statements, whatever the volume", async () => {
    as("riley");
    await getUsageDashboard("all");
    const execute = vi.spyOn(libsql, "execute");
    const batch = vi.spyOn(libsql, "batch");
    try {
      for (const [name, run, most] of [
        ["dashboard, all teams", () => getUsageDashboard("all"), 7],
        ["dashboard, one team", () => getUsageDashboard("coral-offers"), 8],
        ["template", () => getTemplateUsage("coral-offers", ids["balance-transfer"]!), 9],
      ] as const) {
        execute.mockClear();
        batch.mockClear();
        const t0 = performance.now();
        await run();
        const statements = execute.mock.calls.length + batch.mock.calls.length;
        console.info(`usage read model (${name}): ${statements} statements, ${(performance.now() - t0).toFixed(1)} ms`);
        expect(statements, name).toBeLessThanOrEqual(most);
      }
    } finally {
      execute.mockRestore();
      batch.mockRestore();
    }
  });
});

describe("getTemplateUsage", () => {
  it("Balance Transfer: both versions, Coral on each, 'still on v1', weekly by version", async () => {
    as("maya");
    const bt = ids["balance-transfer"]!;
    const u = await getTemplateUsage("coral-offers", bt);
    const s = since();
    const ok = await direct("at >= ? and template_id = ?", null, [s, bt]);
    const v1ok = await direct("at >= ? and template_id = ? and version_number = 1", null, [s, bt]);

    expect(u.template).toEqual({ id: bt, name: "Balance Transfer Intro — Terms", teamSlug: "coral-offers" });
    expect(u.stats.renders.value).toBe(ok);
    expect(u.stats.consumers.value).toBe(1);
    expect(u.versions.map((v) => [v.number, v.state])).toEqual([
      [2, "active"],
      [1, "superseded"],
    ]);
    const v1 = u.versions[1]!;
    expect(v1).toMatchObject({ sunsetPassed: false, revokedAt: null, tags: [{ tone: "warning", text: "sunset in 21 days" }] });
    expect(v1.consumers).toEqual([{ id: "coral", name: "Coral", renders30d: v1ok, errors30d: 0, lastRenderAt: new Date(BASE.getTime() - 37 * 60_000).toISOString() }]);
    expect(u.stillOn).toEqual([{ versionNumber: 1, state: "superseded", renders: v1ok, pct: Math.round((v1ok / ok) * 100) }]);

    expect(u.weeklyVersions).toEqual([1, 2]);
    expect(u.weekly).toHaveLength(TREND_WEEKS);
    for (const w of u.weekly) expect(w.byVersion[1]! + w.byVersion[2]!).toBe(w.count);
    expect(u.daily).toHaveLength(HISTORY_DAYS);
    expect(u.rows.map((r) => r.versionNumber).sort()).toEqual([1, 2]);

    // The two failed v1 renders 31 days ago: outside the window, still the most recent errors.
    expect(u.stats.errors.value).toBe(0);
    expect(u.recentErrors).toHaveLength(2);
    expect(u.recentErrors[0]).toMatchObject({ consumer: { id: "coral", name: "Coral" }, versionNumber: 1, channel: "web", code: "invalid_values", text: "A value had the wrong format." });
  });

  it("Holiday Points: the revoked v1 keeps its consumer (all time) and its danger tag", async () => {
    as("maya");
    const u = await getTemplateUsage("coral-offers", ids["holiday-points"]!);
    const v1 = u.versions.find((v) => v.number === 1)!;
    expect(v1.state).toBe("revoked");
    expect(v1.revokedAt).not.toBeNull();
    expect(v1.tags).toEqual([{ tone: "danger", text: "renders fail" }]);
    expect(v1.consumers.map((c) => [c.name, c.renders30d])).toEqual([["Coral", 0]]);
    expect(u.stillOn).toEqual([]);
  });

  it("High-Yield Savings: v2, sent back twice before its release, is its released row, never a sent-back round", async () => {
    as("eli");
    const templateId = ids["high-yield-savings"]!;
    const u = await getTemplateUsage("deposits", templateId);
    expect(u.versions.map((v) => [v.number, v.state])).toEqual([
      [2, "active"],
      [1, "superseded"],
    ]);
    const released = await libsql.execute({
      sql: "select activated_at from versions where template_id = ? and number = 2 and state = 'active'",
      args: [templateId],
    });
    expect(u.versions[0]!.activatedAt).toBe(new Date(Number(released.rows[0]!.activated_at)).toISOString());
    expect(u.versions[0]!.consumers.map((c) => c.name)).toEqual(["Deposits Online"]);
    expect(new Set(u.rows.filter((r) => r.versionNumber === 2).map((r) => r.versionState))).toEqual(new Set(["active"]));
  });

  it("one denominator: a template whose only render failed reads 1 render, 0% succeeded, 1 failed; with no renders there is no rate", async () => {
    as("maya");
    // A clock long before any seeded render: both windows are empty.
    const templateId = ids["holiday-points"]!;
    const versionId = await versionIdOf(templateId, 1);
    env.now = new Date(BASE.getTime() - 400 * DAY);
    try {
      const none = await getTemplateUsage("coral-offers", templateId);
      expect(none.success).toEqual({ ok: 0, errors: 0, pct: null });
      expect(none.stats.renders.value).toBe(0);
      await withRows(
        [logRow({ id: "rl_test_only_failure", at: env.now.getTime() - 3_600_000, templateId, versionId, versionNumber: 1, consumerId: "coral", outcome: "error" })],
        async () => {
          const u = await getTemplateUsage("coral-offers", templateId);
          expect(u.success).toEqual({ ok: 0, errors: 1, pct: 0 });
          expect(u.stats.renders.value).toBe(1);
          expect(u.rows.map((r) => [r.renders30d, r.errors30d])).toEqual([[1, 1]]);
          expect(u.daily.at(-1)).toMatchObject({ count: 1, errors: 1 });
        },
      );
    } finally {
      env.now = BASE;
    }
  });

  it("404s for a template outside the space", async () => {
    as("maya");
    await expect(getTemplateUsage("coral-offers", ids["checking-fees"]!)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
