import { describe, expect, it } from "vitest";
import { daysBetween } from "../dates";
import {
  HEATMAP_WEEKS,
  HISTORY_DAYS,
  NEARING_SUNSET_DAYS,
  TREND_WEEKS,
  USAGE_WINDOW_DAYS,
  type UsageRow,
} from "../golive-types";
import type { Channel, VersionState } from "../types";
import {
  compareUsageRows,
  consumerLabel,
  countsAsUsage,
  errorText,
  heatmap,
  percent,
  templateUsage,
  trendPct,
  usageDashboard,
  usageSunset,
  usageTags,
  usageWindows,
  weekStartOf,
  windowOf,
  type DashboardUsageFacts,
  type TemplateUsageFacts,
  type UsageCell,
  type UsageSunset,
  type UsageTemplateFacts,
  type UsageVersionFacts,
} from "./usage";

const NOW = new Date("2026-10-04T12:00:00.000Z"); // a Sunday
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

describe("trendPct", () => {
  it("is the change in percent, rounded to one decimal", () => {
    expect(trendPct(110, 100)).toBe(10);
    expect(trendPct(27_412, 25_000)).toBe(9.6);
    expect(trendPct(90, 100)).toBe(-10);
    expect(trendPct(1, 3)).toBe(-66.7);
  });
  it("is null when there is nothing to compare with", () => {
    expect(trendPct(50, 0)).toBeNull();
    expect(trendPct(0, 0)).toBeNull();
  });
  it("percent: null over zero", () => {
    expect(percent(1, 0)).toBeNull();
    expect(percent(997, 1000)).toBe(99.7);
    expect(percent(58, 100, 0)).toBe(58);
  });
});

describe("windows on the demo clock", () => {
  const w = usageWindows(NOW);
  it("the current window is the last 30 days up to now, the previous one the 30 before", () => {
    expect(windowOf(NOW, w)).toBe("current");
    expect(windowOf(at(30), w)).toBe("current"); // exactly 30 days ago is in
    expect(windowOf(at(30).getTime() - 1, w)).toBe("previous");
    expect(windowOf(at(60), w)).toBe("previous");
    expect(windowOf(at(60).getTime() - 1, w)).toBeNull();
    expect(windowOf(NOW.getTime() + 1, w)).toBeNull(); // never after the clock
  });
  it("moves with the clock: advancing 5 days shifts every boundary", () => {
    const later = usageWindows(new Date(NOW.getTime() + 5 * DAY));
    expect(windowOf(at(27), later)).toBe("previous");
    expect(later.today).toBe("2026-10-09");
  });
  it("day ranges end today, weeks start on Sunday", () => {
    expect(w.today).toBe("2026-10-04");
    expect(w.sparkFrom).toBe("2026-09-05");
    expect(w.historyFrom).toBe("2026-07-07");
    expect(w.trendFrom).toBe(weekStartOf("2026-07-12"));
    expect(w.heatFrom).toBe("2026-06-07");
    expect(w.seriesFromMs).toBe(Date.parse("2026-06-07T00:00:00Z"));
  });
  it("previews and consumer-less rows never count", () => {
    expect(countsAsUsage({ isPreview: true, consumerId: null })).toBe(false);
    expect(countsAsUsage({ isPreview: true, consumerId: "coral" })).toBe(false);
    expect(countsAsUsage({ isPreview: false, consumerId: null })).toBe(false);
    expect(countsAsUsage({ isPreview: false, consumerId: "coral" })).toBe(true);
  });
  it("a caller refused as an unknown consumer never counts, whatever else the row says", () => {
    const refused = { isPreview: false, errorCode: "unknown_consumer" };
    expect(countsAsUsage({ ...refused, consumerId: "corall" })).toBe(false);
    expect(countsAsUsage({ ...refused, consumerId: null })).toBe(false);
    // Any other failure is an attempt by a registered consumer, and counts; so does a row with no code.
    expect(
      countsAsUsage({
        isPreview: false,
        consumerId: "coral",
        errorCode: "invalid_values",
      }),
    ).toBe(true);
    expect(
      countsAsUsage({ isPreview: false, consumerId: "coral", errorCode: null }),
    ).toBe(true);
  });
  it("calendar days count UTC days, not 24-hour spans", () => {
    expect(daysBetween(NOW, new Date("2026-10-05T00:00:00Z"))).toBe(1);
    expect(daysBetween(NOW, new Date("2026-10-04T23:59:00Z"))).toBe(0);
    expect(daysBetween(NOW, new Date("2026-10-25T12:00:00Z"))).toBe(21);
  });
});

describe("heatmap", () => {
  it("has HEATMAP_WEEKS Sunday-first columns ending with today's week; days after today are out of range", () => {
    const map = heatmap(new Map(), "2026-10-07"); // a Wednesday
    expect(map.weeks).toHaveLength(HEATMAP_WEEKS);
    for (const week of map.weeks) expect(week).toHaveLength(7);
    expect(new Date(map.weeks[0]![0]!.date).getUTCDay()).toBe(0);
    const last = map.weeks.at(-1)!;
    expect(last[0]!.date).toBe("2026-10-04");
    expect(last.map((c) => c.inRange)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(map.total).toBe(0);
    expect(map.busiest).toBeNull();
    expect(map.thresholds).toEqual([0, 0, 0, 0]);
  });

  it("levels 1–4 by quartiles of the non-zero days; zero is level 0", () => {
    const counts = new Map<string, number>();
    const days = [
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-09-27",
    ];
    [10, 20, 30, 40, 50, 60, 70, 80].forEach((n, i) => counts.set(days[i]!, n));
    counts.set("2026-10-10", 999); // after today: ignored
    const map = heatmap(counts, "2026-10-07");
    expect(map.thresholds).toEqual([20, 40, 60, 80]);
    const cells = new Map(map.weeks.flat().map((c) => [c.date, c]));
    expect(cells.get("2026-09-28")!.level).toBe(1); // 10
    expect(cells.get("2026-09-29")!.level).toBe(1); // 20
    expect(cells.get("2026-09-30")!.level).toBe(2); // 30
    expect(cells.get("2026-10-02")!.level).toBe(3); // 50
    expect(cells.get("2026-10-04")!.level).toBe(4); // 70
    expect(cells.get("2026-09-27")!.level).toBe(4); // 80
    expect(cells.get("2026-10-05")!.level).toBe(0);
    expect(cells.get("2026-10-10")!).toMatchObject({
      count: 0,
      level: 0,
      inRange: false,
    });
    expect(map.total).toBe(360);
    expect(map.busiest).toEqual({ date: "2026-09-27", count: 80 });
    for (const cell of map.weeks.flat())
      expect([0, 1, 2, 3, 4]).toContain(cell.level);
  });

  it("labels the first week that starts in each month", () => {
    const map = heatmap(new Map(), "2026-10-07");
    // Columns start Sun Jun 7 2026: Jun 7 (≤ 7) is labelled, then Jul 5, Aug 2, Sep 6, Oct 4.
    expect(map.months).toEqual([
      { label: "Jun", week: 0 },
      { label: "Jul", week: 4 },
      { label: "Aug", week: 8 },
      { label: "Sep", week: 13 },
      { label: "Oct", week: 17 },
    ]);
  });
});

describe("usageSunset", () => {
  it("is null while no sunset is set", () => {
    expect(usageSunset(null, NOW, "UTC")).toBeNull();
  });

  it("reads the instant, its day in the zone, whether it has come and the days away", () => {
    expect(usageSunset(new Date("2026-10-25T12:00:00Z"), NOW, "UTC")).toEqual({
      at: "2026-10-25T12:00:00.000Z",
      day: "2026-10-25",
      passed: false,
      daysAway: 21,
    });
  });

  it("counts calendar days: tomorrow is 1, any time later today is 0", () => {
    expect(
      usageSunset(new Date("2026-10-05T00:00:00Z"), NOW, "UTC"),
    ).toMatchObject({ day: "2026-10-05", daysAway: 1, passed: false });
    expect(
      usageSunset(new Date("2026-10-04T20:00:00Z"), NOW, "UTC"),
    ).toMatchObject({ day: "2026-10-04", daysAway: 0, passed: false });
  });

  it("has passed at exactly the sunset instant, and not a millisecond before", () => {
    expect(usageSunset(new Date(NOW.getTime() + 1), NOW, "UTC")!.passed).toBe(
      false,
    );
    expect(usageSunset(NOW, NOW, "UTC")).toMatchObject({
      passed: true,
      daysAway: 0,
    });
    // Days before today read as negative days away.
    expect(
      usageSunset(new Date("2026-10-01T00:00:00Z"), NOW, "UTC"),
    ).toMatchObject({ passed: true, daysAway: -3 });
  });

  it("counts the days in the business time zone, where the sunset's day is", () => {
    // 21:00 Eastern on October 4 is already October 5 in UTC; the sunset is 00:00 Eastern on October 6.
    const evening = new Date("2026-10-05T01:00:00Z");
    const sunsetAt = new Date("2026-10-06T04:00:00Z");
    expect(usageSunset(sunsetAt, evening, "America/New_York")).toEqual({
      at: "2026-10-06T04:00:00.000Z",
      day: "2026-10-06",
      passed: false,
      daysAway: 2,
    });
    expect(usageSunset(sunsetAt, evening, "UTC")).toMatchObject({
      day: "2026-10-06",
      daysAway: 1,
    });
  });

  it("reads the day where the zone is, which is not always the UTC day", () => {
    // 22:00 Eastern on October 5 is 02:00 UTC on October 6. NOW is October 4 in both zones.
    const sunsetAt = new Date("2026-10-06T02:00:00Z");
    expect(usageSunset(sunsetAt, NOW, "America/New_York")).toMatchObject({
      day: "2026-10-05",
      daysAway: 1,
    });
    expect(usageSunset(sunsetAt, NOW, "UTC")).toMatchObject({
      day: "2026-10-06",
      daysAway: 2,
    });
  });
});

describe("usageTags", () => {
  const base = { sunset: null, errors30d: 0 };
  /** A sunset not yet come, as the backend decides it: a row reads only whether it passed and the days away. */
  const ahead = (daysAway: number) => ({ passed: false, daysAway });
  /** A superseded version's tags, on a sunset decided by `usageSunset`. */
  const superseded = (
    sunsetAt: Date | null,
    opts: { now?: Date; zone?: string; errors30d?: number } = {},
  ) =>
    usageTags({
      state: "superseded",
      sunset: usageSunset(sunsetAt, opts.now ?? NOW, opts.zone ?? "UTC"),
      errors30d: opts.errors30d ?? 0,
    });

  it("active rows get none, whatever a sunset says", () => {
    expect(usageTags({ ...base, state: "active" })).toEqual([]);
    expect(usageTags({ ...base, state: "active", sunset: ahead(5) })).toEqual(
      [],
    );
  });
  it("superseded with a sunset ahead: warning, counted in calendar days", () => {
    expect(superseded(new Date("2026-10-25T12:00:00Z"))).toEqual([
      { tone: "warning", text: "sunset in 21 days" },
    ]);
    expect(superseded(new Date("2026-10-05T00:00:00Z"))[0]!.text).toBe(
      "sunset tomorrow",
    );
    expect(superseded(new Date("2026-10-04T20:00:00Z"))[0]!.text).toBe(
      "sunset today",
    );
  });
  it("counts the days in the business time zone, where the sunset's day is", () => {
    // 21:00 Eastern on October 4 is already October 5 in UTC; the sunset is 00:00 Eastern on October 6.
    const evening = new Date("2026-10-05T01:00:00Z");
    const sunsetAt = new Date("2026-10-06T04:00:00Z");
    expect(
      superseded(sunsetAt, { now: evening, zone: "America/New_York" })[0]!.text,
    ).toBe("sunset in 2 days");
    expect(superseded(sunsetAt, { now: evening, zone: "UTC" })[0]!.text).toBe(
      "sunset tomorrow",
    );
  });
  it("a sunset warns up to the nearing window and stays neutral beyond it", () => {
    expect(
      usageTags({
        ...base,
        state: "superseded",
        sunset: ahead(NEARING_SUNSET_DAYS),
      }),
    ).toEqual([
      { tone: "warning", text: `sunset in ${NEARING_SUNSET_DAYS} days` },
    ]);
    expect(
      usageTags({
        ...base,
        state: "superseded",
        sunset: ahead(NEARING_SUNSET_DAYS + 1),
      }),
    ).toEqual([
      { tone: "neutral", text: `sunset in ${NEARING_SUNSET_DAYS + 1} days` },
    ]);
    expect(superseded(new Date("2027-03-01T00:00:00Z"))).toEqual([
      { tone: "neutral", text: "sunset in 148 days" },
    ]);
  });
  it("superseded with no sunset: no note (the Version badge says it)", () => {
    expect(usageTags({ ...base, state: "superseded" })).toEqual([]);
    expect(superseded(null)).toEqual([]);
  });
  it("a passed sunset or a revoke fails renders: danger, and no separate failure count", () => {
    expect(
      superseded(new Date("2026-10-01T00:00:00Z"), { errors30d: 4 }),
    ).toEqual([{ tone: "danger", text: "renders fail" }]);
    // The sunset instant itself has passed.
    expect(superseded(NOW)[0]!.tone).toBe("danger");
    expect(usageTags({ ...base, state: "revoked", errors30d: 2 })).toEqual([
      { tone: "danger", text: "renders fail" },
    ]);
    // A revoked version fails whatever sunset it once had.
    expect(usageTags({ ...base, state: "revoked", sunset: ahead(5) })).toEqual([
      { tone: "danger", text: "renders fail" },
    ]);
  });
  it("failed renders tag any version that still renders", () => {
    expect(usageTags({ ...base, state: "active", errors30d: 3 })).toEqual([
      { tone: "danger", text: "3 failed renders" },
    ]);
    expect(usageTags({ ...base, state: "active", errors30d: 1 })).toEqual([
      { tone: "danger", text: "1 failed render" },
    ]);
    expect(
      superseded(new Date("2026-10-25T12:00:00Z"), { errors30d: 2 }),
    ).toEqual([
      { tone: "warning", text: "sunset in 21 days" },
      { tone: "danger", text: "2 failed renders" },
    ]);
  });
});

describe("compareUsageRows", () => {
  const row = (
    name: string,
    renders30d: number,
    tones: ("danger" | "warning" | "neutral")[],
  ): UsageRow => ({
    consumer: { id: name, name },
    template: { id: "UC-1", name: "T", teamSlug: "coral-offers" },
    versionNumber: 1,
    versionState: "active",
    renders30d,
    errors30d: 0,
    lastRenderAt: NOW.toISOString(),
    tags: tones.map((tone) => ({ tone, text: tone })),
    sunsetDay: null,
    sunsetPassed: false,
    spark: [],
  });
  it("danger first, then warning, then other tags, then renders desc", () => {
    const rows = [
      row("a", 900, []),
      row("b", 5, ["warning"]),
      row("c", 1, ["danger"]),
      row("d", 50, ["neutral"]),
      row("e", 10, ["warning"]),
    ];
    expect(rows.sort(compareUsageRows).map((r) => r.consumer.name)).toEqual([
      "c",
      "e",
      "b",
      "d",
      "a",
    ]);
  });
});

describe("display", () => {
  it("errorText reads every code as a sentence", () => {
    expect(errorText("missing_variables")).toBe("Missing required variables.");
    expect(errorText("invalid_values")).toBe("A value had the wrong format.");
    expect(errorText("version_sunset")).toBe("The version was sunset.");
  });
});

// ── The screens, from facts built by hand ────────────────────────────────────
//
// `usageDashboard` and `templateUsage` only add up, order, lay out and word what the backend counted, so they
// are tested on small facts with the numbers worked out by hand. The instant is AS_OF, a Sunday, so today is
// 2026-10-04 and the windows are the ones `usageWindows` gives in the tests above.

const AS_OF = "2026-10-04T12:00:00.000Z";
const SPACE = { slug: "coral-offers", name: "Coral Offers", isAll: false };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const channelCounts = (
  over: Partial<Record<Channel, number>> = {},
): Record<Channel, number> => ({
  pdf: 0,
  web: 0,
  email: 0,
  push: 0,
  sms: 0,
  ...over,
});

/** The sparkline of USAGE_WINDOW_DAYS days, by index (0 is the first day, 29 is today). */
const spark = (points: Record<number, number> = {}): number[] =>
  Array.from({ length: USAGE_WINDOW_DAYS }, (_, i) => points[i] ?? 0);

const template = (id: string, name: string): UsageTemplateFacts => ({
  id,
  name,
  teamId: "t_coral",
  teamSlug: "coral-offers",
});

/** A sunset as `usageSunset` decides it at AS_OF. */
const sunset = (
  at: string,
  day: string,
  daysAway: number,
  passed = false,
): UsageSunset => ({ at, day, passed, daysAway });

const version = (
  templateId: string,
  number: number,
  state: VersionState,
  over: Partial<UsageVersionFacts> = {},
): UsageVersionFacts => ({
  templateId,
  number,
  state,
  activatedAt: null,
  sunset: null,
  revokedAt: null,
  ...over,
});

/** One cell of renders: the counts default to 0. */
const cell = (o: {
  template: string;
  consumer: string;
  version: number;
  channel: Channel;
  platform?: UsageCell["platform"];
  ok?: number;
  err?: number;
  prev?: number;
  last: string;
}): UsageCell => ({
  templateId: o.template,
  consumerId: o.consumer,
  versionNumber: o.version,
  channel: o.channel,
  platform: o.platform ?? null,
  ok30: o.ok ?? 0,
  err30: o.err ?? 0,
  prev: o.prev ?? 0,
  lastAt: o.last,
});

/** Facts with nothing in them: a test fills in only what it is about. */
function bareDashboard(
  over: Partial<DashboardUsageFacts> = {},
): DashboardUsageFacts {
  return {
    asOf: AS_OF,
    templates: [],
    versions: [],
    consumers: [],
    cells: [],
    sparks: [],
    series: [],
    ...over,
  };
}

/**
 * A dashboard with a bit of everything, in no particular order. Totals, worked out by hand:
 *   ok 263, failed 15, so 278 attempts; 117 in the window before
 *   by channel: web 108, pdf 50, email 95, push 25
 *   coral (the registry names it "Coral Mobile") 213, deposits-online (left the registry) 65
 *   Balance Transfer 193, Cash Back 85, Holiday Points none
 *   on an Active version 210, on others 68
 */
function facts(over: Partial<DashboardUsageFacts> = {}): DashboardUsageFacts {
  return {
    asOf: AS_OF,
    templates: [
      template("UC-3", "Holiday Points"),
      template("UC-1", "Balance Transfer"),
      template("UC-2", "Cash Back"),
    ],
    versions: [
      version("UC-1", 1, "superseded", {
        sunset: sunset("2026-10-25T04:00:00.000Z", "2026-10-25", 21),
      }),
      version("UC-1", 2, "active", { activatedAt: "2026-09-01T00:00:00.000Z" }),
      // A sunset beyond the nearing window.
      version("UC-1", 3, "superseded", {
        sunset: sunset("2027-03-01T05:00:00.000Z", "2027-03-01", 148),
      }),
      // Set under another zone: the same day as UC-3's v2, but a later instant.
      version("UC-2", 1, "superseded", {
        sunset: sunset("2026-10-14T18:00:00.000Z", "2026-10-14", 10),
      }),
      version("UC-2", 2, "active"),
      version("UC-2", 3, "superseded"),
      // Revoked, with the sunset it had before: not a version that is nearing one.
      version("UC-3", 1, "revoked", {
        revokedAt: "2026-09-25T00:00:00.000Z",
        sunset: sunset("2026-10-09T04:00:00.000Z", "2026-10-09", 5),
      }),
      version("UC-3", 2, "superseded", {
        sunset: sunset("2026-10-14T04:00:00.000Z", "2026-10-14", 10),
      }),
      version("UC-3", 3, "superseded", {
        sunset: sunset("2026-09-30T04:00:00.000Z", "2026-09-30", -4, true),
      }),
    ],
    consumers: [
      { id: "coral", name: "Coral Mobile" },
      { id: "unused", name: "Unused" },
    ],
    cells: [
      cell({
        template: "UC-1",
        consumer: "coral",
        version: 2,
        channel: "web",
        ok: 100,
        prev: 50,
        last: "2026-10-04T10:00:00.000Z",
      }),
      cell({
        template: "UC-1",
        consumer: "coral",
        version: 2,
        channel: "pdf",
        ok: 40,
        err: 10,
        prev: 30,
        last: "2026-10-03T08:00:00.000Z",
      }),
      cell({
        template: "UC-1",
        consumer: "coral",
        version: 1,
        channel: "email",
        ok: 30,
        prev: 20,
        last: "2026-10-02T09:00:00.000Z",
      }),
      cell({
        template: "UC-1",
        consumer: "deposits-online",
        version: 1,
        channel: "email",
        ok: 5,
        last: "2026-10-03T00:00:00.000Z",
      }),
      cell({
        template: "UC-2",
        consumer: "deposits-online",
        version: 2,
        channel: "email",
        ok: 60,
        last: "2026-10-04T11:00:00.000Z",
      }),
      cell({
        template: "UC-2",
        consumer: "coral",
        version: 1,
        channel: "push",
        platform: "ios",
        ok: 20,
        err: 5,
        prev: 10,
        last: "2026-10-01T00:00:00.000Z",
      }),
      // v9 has no entry in `versions`.
      cell({
        template: "UC-1",
        consumer: "coral",
        version: 9,
        channel: "web",
        ok: 8,
        last: "2026-09-20T00:00:00.000Z",
      }),
      // Rendered only in the window before: it counts toward the trend and is no row.
      cell({
        template: "UC-3",
        consumer: "coral",
        version: 1,
        channel: "web",
        prev: 7,
        last: "2026-08-20T00:00:00.000Z",
      }),
    ],
    sparks: [
      {
        templateId: "UC-1",
        consumerId: "coral",
        versionNumber: 2,
        day: "2026-09-05",
        count: 3,
      },
      {
        templateId: "UC-1",
        consumerId: "coral",
        versionNumber: 2,
        day: "2026-10-04",
        count: 12,
      },
      // The day before the sparkline starts: not drawn.
      {
        templateId: "UC-1",
        consumerId: "coral",
        versionNumber: 2,
        day: "2026-09-04",
        count: 99,
      },
      {
        templateId: "UC-1",
        consumerId: "coral",
        versionNumber: 1,
        day: "2026-10-02",
        count: 4,
      },
    ],
    // The series is counted apart from the cells: the heatmap, the weeks and the days are built from it alone.
    series: [
      { day: "2026-10-04", channel: "web", outcome: "ok", count: 12 },
      { day: "2026-10-04", channel: "pdf", outcome: "error", count: 3 },
      { day: "2026-09-30", channel: "email", outcome: "ok", count: 7 },
      { day: "2026-09-28", channel: "push", outcome: "ok", count: 2 },
      // The first of the TREND_WEEKS weeks (Sunday July 12).
      { day: "2026-07-13", channel: "web", outcome: "ok", count: 4 },
      // In the 90 days and the heatmap, but the week before the weekly columns start.
      { day: "2026-07-08", channel: "web", outcome: "ok", count: 6 },
      // In the heatmap only: before the 90 days.
      { day: "2026-06-10", channel: "sms", outcome: "ok", count: 9 },
    ],
    ...over,
  };
}

const brief = (r: UsageRow) => [
  r.consumer.id,
  r.template.id,
  r.versionNumber,
  r.renders30d,
  r.errors30d,
];

describe("usageDashboard", () => {
  const dashboard = (over: Partial<DashboardUsageFacts> = {}) =>
    usageDashboard(facts(over), SPACE);

  it("echoes the instant and passes the space through", () => {
    const d = dashboard();
    expect(d.asOf).toBe(AS_OF);
    expect(d.today).toBe("2026-10-04");
    expect(d.space).toEqual(SPACE);
    expect(
      usageDashboard(facts(), { slug: "all", name: "All teams", isAll: true })
        .space,
    ).toEqual({ slug: "all", name: "All teams", isAll: true });
  });

  it("reads today as the UTC day of the instant, not the business day", () => {
    // 02:00 UTC on October 5 is still 22:00 on October 4 in New York.
    const d = usageDashboard(
      facts({
        asOf: "2026-10-05T02:00:00.000Z",
        series: [
          { day: "2026-10-05", channel: "web", outcome: "ok", count: 3 },
        ],
      }),
      SPACE,
    );
    expect(d.today).toBe("2026-10-05");
    expect(d.daily).toHaveLength(HISTORY_DAYS);
    expect(d.daily.at(-1)).toEqual({ date: "2026-10-05", count: 3, errors: 0 });
    // Monday: the last weekly column is still the week that began on Sunday the 4th.
    expect(d.weekly.at(-1)!.weekStart).toBe("2026-10-04");
    expect(d.weekly.at(-1)!.count).toBe(3);
  });

  it("every breakdown adds up to the same total", () => {
    const d = dashboard();
    expect(d.stats.renders.value).toBe(278);
    expect(d.success.ok + d.success.errors).toBe(278);
    expect(sum(Object.values(d.byChannel))).toBe(278);
    expect(sum(d.byTemplate.map((t) => t.renders))).toBe(278);
    expect(sum(d.byConsumer.map((c) => c.renders))).toBe(278);
    expect(sum(d.rows.map((r) => r.renders30d))).toBe(278);
    expect(sum(d.rows.map((r) => r.errors30d))).toBe(d.success.errors);
    expect(d.onActive.active + d.onActive.other).toBe(278);
    expect(sum(d.onActive.otherVersions.map((o) => o.renders))).toBe(
      d.onActive.other,
    );
    expect(sum(d.byConsumer.map((c) => c.share))).toBeCloseTo(1, 10);
    expect(sum(d.byTemplate.map((t) => t.share))).toBeCloseTo(1, 10);
  });

  it("counts renders against the window before, and the success rate over one denominator", () => {
    const d = dashboard();
    expect(d.stats.renders).toEqual({
      value: 278,
      display: "278",
      previous: 117, // includes the 7 of Holiday Points, which has no row
      trendPct: 137.6, // (278 - 117) / 117
    });
    expect(d.success).toEqual({ ok: 263, errors: 15, pct: 94.6 });
    expect(d.byChannel).toEqual(
      channelCounts({ web: 108, pdf: 50, email: 95, push: 25 }),
    );
    expect(d.stats.activeTemplates).toEqual({ value: 2, display: "2" });
    expect(d.stats.consumers).toEqual({ value: 2, display: "2" });
  });

  it("a falling count reads as a negative trend, and no earlier renders as no trend", () => {
    const falling = usageDashboard(
      bareDashboard({
        templates: [template("UC-1", "Balance Transfer")],
        versions: [version("UC-1", 1, "active")],
        cells: [
          cell({
            template: "UC-1",
            consumer: "coral",
            version: 1,
            channel: "web",
            ok: 50,
            prev: 100,
            last: "2026-10-04T00:00:00.000Z",
          }),
        ],
      }),
      SPACE,
    );
    expect(falling.stats.renders).toMatchObject({
      value: 50,
      previous: 100,
      trendPct: -50,
    });
    const fresh = usageDashboard(
      bareDashboard({
        templates: [template("UC-1", "Balance Transfer")],
        versions: [version("UC-1", 1, "active")],
        cells: [
          cell({
            template: "UC-1",
            consumer: "coral",
            version: 1,
            channel: "web",
            ok: 5,
            last: "2026-10-04T00:00:00.000Z",
          }),
        ],
      }),
      SPACE,
    );
    expect(fresh.stats.renders).toMatchObject({ previous: 0, trendPct: null });
  });

  it("one denominator: a template whose only render failed reads 1 render, 0% succeeded, 1 failed", () => {
    const d = usageDashboard(
      bareDashboard({
        templates: [template("UC-1", "Balance Transfer")],
        versions: [version("UC-1", 1, "active")],
        cells: [
          cell({
            template: "UC-1",
            consumer: "coral",
            version: 1,
            channel: "web",
            err: 1,
            last: "2026-10-04T08:00:00.000Z",
          }),
        ],
      }),
      SPACE,
    );
    expect(d.success).toEqual({ ok: 0, errors: 1, pct: 0 });
    expect(d.stats.renders.value).toBe(1);
    expect(d.byChannel).toEqual(channelCounts({ web: 1 }));
    expect(d.rows.map(brief)).toEqual([["coral", "UC-1", 1, 1, 1]]);
    expect(d.rows[0]!.tags).toEqual([
      { tone: "danger", text: "1 failed render" },
    ]);
    expect(d.onActive).toMatchObject({ active: 1, other: 0, pct: 100 });
  });

  it("with no renders there is no rate, no trend and nothing listed", () => {
    const d = usageDashboard(
      bareDashboard({
        templates: [template("UC-1", "Balance Transfer")],
        versions: [version("UC-1", 1, "active")],
      }),
      SPACE,
    );
    expect(d.success).toEqual({ ok: 0, errors: 0, pct: null });
    expect(d.stats.renders).toEqual({
      value: 0,
      display: "0",
      previous: 0,
      trendPct: null,
    });
    expect(d.stats.consumers.value).toBe(0);
    expect(d.stats.activeTemplates.value).toBe(1);
    expect(d.rows).toEqual([]);
    expect(d.byConsumer).toEqual([]);
    expect(d.byTemplate).toEqual([]);
    expect(d.byChannel).toEqual(channelCounts());
    expect(d.onActive).toEqual({
      active: 0,
      other: 0,
      pct: null,
      otherVersions: [],
    });
    expect(d.heatmap.total).toBe(0);
    expect(d.heatmap.busiest).toBeNull();
  });

  it("rows: danger first, then warning, then the rest, most renders first within each", () => {
    const d = dashboard();
    expect(d.rows.map(brief)).toEqual([
      ["coral", "UC-1", 2, 150, 10], // danger, 150 renders
      ["coral", "UC-2", 1, 25, 5], // danger and warning: still danger, fewer renders
      ["coral", "UC-1", 1, 30, 0], // warning, 30 renders
      ["deposits-online", "UC-1", 1, 5, 0], // warning, 5 renders
      ["deposits-online", "UC-2", 2, 60, 0], // no tag, more renders than a tagged row, still after it
      ["coral", "UC-1", 9, 8, 0],
    ]);
  });

  it("a row is the consumer, template and version, with the version's sunset and the notes on it", () => {
    const d = dashboard();
    // One row for the web and the pdf cells of the same consumer, template and version.
    expect(d.rows[0]).toEqual({
      consumer: { id: "coral", name: "Coral Mobile" },
      template: {
        id: "UC-1",
        name: "Balance Transfer",
        teamSlug: "coral-offers",
      },
      versionNumber: 2,
      versionState: "active",
      renders30d: 150,
      errors30d: 10,
      lastRenderAt: "2026-10-04T10:00:00.000Z", // the later of the two cells
      tags: [{ tone: "danger", text: "10 failed renders" }],
      sunsetDay: null,
      sunsetPassed: false,
      spark: spark({ 0: 3, 29: 12 }),
    });
    expect(d.rows[1]).toEqual({
      consumer: { id: "coral", name: "Coral Mobile" },
      template: { id: "UC-2", name: "Cash Back", teamSlug: "coral-offers" },
      versionNumber: 1,
      versionState: "superseded",
      renders30d: 25,
      errors30d: 5,
      lastRenderAt: "2026-10-01T00:00:00.000Z",
      tags: [
        { tone: "warning", text: "sunset in 10 days" },
        { tone: "danger", text: "5 failed renders" },
      ],
      sunsetDay: "2026-10-14",
      sunsetPassed: false,
      spark: spark(),
    });
  });

  it("a sparkline has USAGE_WINDOW_DAYS days, today last: the facts' days filled, zero elsewhere", () => {
    const d = dashboard();
    for (const row of d.rows) expect(row.spark).toHaveLength(USAGE_WINDOW_DAYS);
    const byKey = (consumer: string, tpl: string, v: number) =>
      d.rows.find(
        (r) =>
          r.consumer.id === consumer &&
          r.template.id === tpl &&
          r.versionNumber === v,
      )!;
    // September 5 is the first day, October 4 is today; September 4 is before the sparkline.
    expect(byKey("coral", "UC-1", 2).spark).toEqual(spark({ 0: 3, 29: 12 }));
    // October 2 is the 28th day.
    expect(byKey("coral", "UC-1", 1).spark).toEqual(spark({ 27: 4 }));
    // No facts for the row: all zero.
    expect(byKey("deposits-online", "UC-2", 2).spark).toEqual(spark());
  });

  it("names a consumer by the registry, and one that left it by its id", () => {
    const d = dashboard();
    expect(d.byConsumer.map((c) => c.consumer)).toEqual([
      { id: "coral", name: "Coral Mobile" },
      { id: "deposits-online", name: "Deposits Online" },
    ]);
    expect(consumerLabel("deposits-online")).toBe("Deposits Online");
    const left = d.rows.filter((r) => r.consumer.id === "deposits-online");
    expect(left).toHaveLength(2);
    expect(left.map((r) => r.consumer.name)).toEqual([
      "Deposits Online",
      "Deposits Online",
    ]);
    // A registered consumer with no renders is not listed.
    expect(d.byConsumer.some((c) => c.consumer.id === "unused")).toBe(false);
  });

  it("byConsumer and byTemplate: most renders first, with each one's share; a template with none is left out", () => {
    const d = dashboard();
    expect(d.byConsumer).toEqual([
      {
        consumer: { id: "coral", name: "Coral Mobile" },
        renders: 213,
        share: 213 / 278,
      },
      {
        consumer: { id: "deposits-online", name: "Deposits Online" },
        renders: 65,
        share: 65 / 278,
      },
    ]);
    expect(d.byTemplate).toEqual([
      {
        template: {
          id: "UC-1",
          name: "Balance Transfer",
          teamSlug: "coral-offers",
        },
        renders: 193,
        share: 193 / 278,
      },
      {
        template: { id: "UC-2", name: "Cash Back", teamSlug: "coral-offers" },
        renders: 85,
        share: 85 / 278,
      },
    ]);
    // Holiday Points rendered only in the window before.
    expect(d.byTemplate.some((t) => t.template.id === "UC-3")).toBe(false);
    expect(d.rows.some((r) => r.template.id === "UC-3")).toBe(false);
  });

  it("equal renders order by name", () => {
    const d = usageDashboard(
      bareDashboard({
        templates: [
          template("UC-1", "Beta Notice"),
          template("UC-2", "Alpha Notice"),
        ],
        versions: [version("UC-1", 1, "active"), version("UC-2", 1, "active")],
        consumers: [
          { id: "zeta", name: "Zeta" },
          { id: "alpha", name: "Alpha" },
        ],
        cells: [
          cell({
            template: "UC-1",
            consumer: "zeta",
            version: 1,
            channel: "web",
            ok: 5,
            last: AS_OF,
          }),
          cell({
            template: "UC-2",
            consumer: "alpha",
            version: 1,
            channel: "web",
            ok: 5,
            last: AS_OF,
          }),
        ],
      }),
      SPACE,
    );
    expect(d.byTemplate.map((t) => t.template.name)).toEqual([
      "Alpha Notice",
      "Beta Notice",
    ]);
    expect(d.byConsumer.map((c) => c.consumer.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("the gauge: renders on an Active version against the rest, and which versions the rest is made of", () => {
    const d = dashboard();
    expect(d.onActive).toEqual({
      active: 210, // coral on UC-1 v2 (150) and deposits-online on UC-2 v2 (60)
      other: 68,
      pct: 75.5,
      // Most first; UC-1 v1 adds up both consumers (30 + 5).
      otherVersions: [
        {
          template: { id: "UC-1", name: "Balance Transfer" },
          versionNumber: 1,
          renders: 35,
        },
        {
          template: { id: "UC-2", name: "Cash Back" },
          versionNumber: 1,
          renders: 25,
        },
        {
          template: { id: "UC-1", name: "Balance Transfer" },
          versionNumber: 9,
          renders: 8,
        },
      ],
    });
  });

  it("a version with no entry in the facts is treated as superseded, with no sunset", () => {
    const d = dashboard();
    const v9 = d.rows.find((r) => r.versionNumber === 9)!;
    expect(v9).toMatchObject({
      versionState: "superseded",
      tags: [],
      sunsetDay: null,
      sunsetPassed: false,
    });
    expect(d.onActive.otherVersions.some((o) => o.versionNumber === 9)).toBe(
      true,
    );
  });

  it("nearing sunset: only superseded versions with a sunset ahead within the window, and the soonest one", () => {
    const d = dashboard();
    // Counted: UC-1 v1 (21 days), UC-2 v1 (10) and UC-3 v2 (10). Not counted: UC-1 v3 (148 days), UC-2 v3 (no
    // sunset), UC-3 v1 (revoked), UC-3 v3 (passed) and the Active versions.
    expect(d.stats.nearingSunset).toEqual({
      value: 3,
      display: "3",
      // UC-2 v1 and UC-3 v2 are both 10 days away; UC-3 v2's instant is the earlier.
      soonest: {
        templateName: "Holiday Points",
        versionNumber: 2,
        daysAway: 10,
      },
    });
  });

  it("nearing sunset: the window includes its last day, and a version without a nearing sunset leaves no soonest", () => {
    const at = (daysAway: number, passed = false) =>
      sunset("2026-11-01T04:00:00.000Z", "2026-11-01", daysAway, passed);
    const nearing = usageDashboard(
      bareDashboard({
        templates: [template("UC-1", "Balance Transfer")],
        versions: [
          version("UC-1", 1, "superseded", { sunset: at(NEARING_SUNSET_DAYS) }),
          version("UC-1", 2, "superseded", {
            sunset: at(NEARING_SUNSET_DAYS + 1),
          }),
        ],
      }),
      SPACE,
    );
    expect(nearing.stats.nearingSunset).toEqual({
      value: 1,
      display: "1",
      soonest: {
        templateName: "Balance Transfer",
        versionNumber: 1,
        daysAway: NEARING_SUNSET_DAYS,
      },
    });
    const none = usageDashboard(
      bareDashboard({
        templates: [template("UC-1", "Balance Transfer")],
        versions: [
          version("UC-1", 1, "superseded", { sunset: at(-2, true) }),
          version("UC-1", 2, "active"),
        ],
      }),
      SPACE,
    );
    expect(none.stats.nearingSunset).toEqual({
      value: 0,
      display: "0",
      soonest: null,
    });
  });

  it("the heatmap is built from the series: every outcome counts, days in the 18 weeks only", () => {
    const d = dashboard();
    expect(d.heatmap.weeks).toHaveLength(HEATMAP_WEEKS);
    expect(d.heatmap.weeks[0]![0]!.date).toBe("2026-06-07");
    // 15 + 7 + 2 + 4 + 6 + 9: the failed renders of October 4 are in its 15.
    expect(d.heatmap.total).toBe(43);
    expect(d.heatmap.busiest).toEqual({ date: "2026-10-04", count: 15 });
    expect(d.heatmap.thresholds).toEqual([4, 6, 9, 15]);
    const cells = new Map(d.heatmap.weeks.flat().map((c) => [c.date, c]));
    expect(cells.get("2026-10-04")).toMatchObject({ count: 15, level: 4 });
    expect(cells.get("2026-06-10")).toMatchObject({ count: 9, level: 3 });
    expect(cells.get("2026-10-03")).toMatchObject({ count: 0, level: 0 });
  });

  it("weekly: TREND_WEEKS Sunday-first weeks with the counts, failures and channels of the series; a day before the weeks is left out", () => {
    const d = dashboard();
    expect(d.weekly).toHaveLength(TREND_WEEKS);
    expect(d.weekly[0]!.weekStart).toBe("2026-07-12");
    expect(d.weekly.at(-1)!.weekStart).toBe("2026-10-04");
    const byStart = new Map(d.weekly.map((w) => [w.weekStart, w]));
    expect(byStart.get("2026-07-12")).toEqual({
      weekStart: "2026-07-12",
      count: 4,
      errors: 0,
      channels: channelCounts({ web: 4 }),
    });
    expect(byStart.get("2026-09-27")).toEqual({
      weekStart: "2026-09-27",
      count: 9,
      errors: 0,
      channels: channelCounts({ email: 7, push: 2 }),
    });
    expect(byStart.get("2026-10-04")).toEqual({
      weekStart: "2026-10-04",
      count: 15,
      errors: 3,
      channels: channelCounts({ web: 12, pdf: 3 }),
    });
    // July 8 (the week of July 5) and June 10 fall before the first week: 4 + 9 + 15 and no more.
    expect(sum(d.weekly.map((w) => w.count))).toBe(28);
    expect(byStart.has("2026-07-05")).toBe(false);
  });

  it("daily: HISTORY_DAYS days, today last, zeros included; a day before them is left out", () => {
    const d = dashboard();
    expect(d.daily).toHaveLength(HISTORY_DAYS);
    expect(d.daily[0]!.date).toBe("2026-07-07");
    expect(d.daily.at(-1)).toEqual({
      date: "2026-10-04",
      count: 15,
      errors: 3,
    });
    expect(d.daily.filter((x) => x.count > 0)).toEqual([
      { date: "2026-07-08", count: 6, errors: 0 },
      { date: "2026-07-13", count: 4, errors: 0 },
      { date: "2026-09-28", count: 2, errors: 0 },
      { date: "2026-09-30", count: 7, errors: 0 },
      { date: "2026-10-04", count: 15, errors: 3 },
    ]);
  });
});

describe("templateUsage", () => {
  /** A template page with nothing in it: a test fills in only what it is about. */
  function bareTemplate(
    over: Partial<TemplateUsageFacts> = {},
  ): TemplateUsageFacts {
    return {
      asOf: AS_OF,
      template: template("UC-1", "Balance Transfer"),
      allowedChannels: ["pdf", "web", "email"],
      versions: [],
      consumers: [],
      cells: [],
      sparks: [],
      series: [],
      recentErrors: [],
      ...over,
    };
  }

  /**
   * A document template with six rows, in no particular order, and its consumers. Totals, worked out by hand:
   *   ok 170, failed 7, so 177 attempts; 59 in the window before
   *   by channel: pdf 22, web 65, email 90
   *   v3 (Active) 162, v2 (Superseded) 11, v1 (Revoked) 4
   */
  function tfacts(over: Partial<TemplateUsageFacts> = {}): TemplateUsageFacts {
    return bareTemplate({
      // The content type's channels, not in CHANNELS order.
      allowedChannels: ["email", "web", "pdf"],
      versions: [
        version("UC-1", 2, "superseded", {
          activatedAt: "2026-07-01T00:00:00.000Z",
          sunset: sunset("2026-10-25T04:00:00.000Z", "2026-10-25", 21),
        }),
        version("UC-1", 4, "in_review"),
        version("UC-1", 1, "revoked", {
          activatedAt: "2026-06-01T00:00:00.000Z",
          revokedAt: "2026-07-01T00:00:00.000Z",
        }),
        version("UC-1", 3, "active", {
          activatedAt: "2026-09-15T00:00:00.000Z",
        }),
        version("UC-1", 6, "draft"),
        version("UC-1", 5, "changes_requested"),
      ],
      consumers: [
        { id: "coral", name: "Coral Mobile" },
        { id: "alpha", name: "Alpha" },
        { id: "zeta", name: "Zeta" },
      ],
      cells: [
        cell({
          template: "UC-1",
          consumer: "coral",
          version: 3,
          channel: "web",
          ok: 50,
          prev: 10,
          last: "2026-10-04T09:00:00.000Z",
        }),
        cell({
          template: "UC-1",
          consumer: "coral",
          version: 3,
          channel: "pdf",
          ok: 20,
          err: 2,
          prev: 5,
          last: "2026-10-03T00:00:00.000Z",
        }),
        cell({
          template: "UC-1",
          consumer: "zeta",
          version: 3,
          channel: "email",
          ok: 30,
          last: "2026-10-04T10:00:00.000Z",
        }),
        cell({
          template: "UC-1",
          consumer: "alpha",
          version: 3,
          channel: "email",
          ok: 30,
          last: "2026-10-04T09:00:00.000Z",
        }),
        // Left the registry.
        cell({
          template: "UC-1",
          consumer: "deposits-online",
          version: 3,
          channel: "email",
          ok: 30,
          last: "2026-10-04T09:00:00.000Z",
        }),
        cell({
          template: "UC-1",
          consumer: "coral",
          version: 2,
          channel: "web",
          ok: 10,
          err: 1,
          prev: 20,
          last: "2026-10-02T00:00:00.000Z",
        }),
        // Stopped rendering v2: rendered it only in the window before.
        cell({
          template: "UC-1",
          consumer: "alpha",
          version: 2,
          channel: "email",
          prev: 15,
          last: "2026-08-30T00:00:00.000Z",
        }),
        // v1 was revoked: every attempt since fails.
        cell({
          template: "UC-1",
          consumer: "coral",
          version: 1,
          channel: "web",
          err: 4,
          last: "2026-10-03T00:00:00.000Z",
        }),
        // Rendered v3 only in the window before.
        cell({
          template: "UC-1",
          consumer: "gamma",
          version: 3,
          channel: "email",
          prev: 9,
          last: "2026-08-15T00:00:00.000Z",
        }),
      ],
      series: [
        { day: "2026-10-04", versionNumber: 3, outcome: "ok", count: 20 },
        { day: "2026-10-04", versionNumber: 3, outcome: "error", count: 2 },
        // No version number: in the day's totals, in no version's column.
        { day: "2026-10-04", versionNumber: null, outcome: "error", count: 1 },
        { day: "2026-09-28", versionNumber: 2, outcome: "ok", count: 5 },
        { day: "2026-09-29", versionNumber: 3, outcome: "ok", count: 7 },
        // The week before the first of the weekly columns, but inside the 90 days.
        { day: "2026-07-08", versionNumber: 1, outcome: "ok", count: 6 },
        { day: "2026-07-14", versionNumber: 2, outcome: "ok", count: 3 },
      ],
      recentErrors: [
        {
          at: "2026-10-04T08:00:00.000Z",
          consumerId: "coral",
          versionNumber: 3,
          channel: "pdf",
          platform: null,
          code: "missing_variables",
        },
        {
          at: "2026-10-03T00:00:00.000Z",
          consumerId: "deposits-online",
          versionNumber: null,
          channel: "web",
          platform: null,
          code: "version_not_found",
        },
      ],
      ...over,
    });
  }

  it("echoes the instant, today and the template (without its team id)", () => {
    const u = templateUsage(tfacts());
    expect(u.asOf).toBe(AS_OF);
    expect(u.today).toBe("2026-10-04");
    expect(u.template).toEqual({
      id: "UC-1",
      name: "Balance Transfer",
      teamSlug: "coral-offers",
    });
  });

  it("counts renders against the window before, the success rate over one denominator and the failures", () => {
    const u = templateUsage(tfacts());
    expect(u.stats.renders).toEqual({
      value: 177,
      display: "177",
      previous: 59, // the 15 + 9 of consumers that stopped rendering count
      trendPct: 200, // (177 - 59) / 59
    });
    expect(u.stats.errors).toEqual({ value: 7, display: "7" });
    expect(u.success).toEqual({ ok: 170, errors: 7, pct: 96 });
    expect(u.byChannel).toEqual(channelCounts({ pdf: 22, web: 65, email: 90 }));
    expect(sum(Object.values(u.byChannel))).toBe(177);
  });

  it("stats.consumers counts the distinct consumers with renders in the current window", () => {
    const u = templateUsage(tfacts());
    // coral, alpha, zeta and deposits-online: gamma rendered only in the window before.
    expect(u.stats.consumers).toEqual({ value: 4, display: "4" });
    expect(new Set(u.rows.map((r) => r.consumer.id))).toEqual(
      new Set(["coral", "alpha", "zeta", "deposits-online"]),
    );
  });

  it("one denominator: a template whose only render failed reads 1 render, 0% succeeded, 1 failed; with no renders there is no rate", () => {
    const failed = templateUsage(
      bareTemplate({
        versions: [version("UC-1", 1, "active")],
        cells: [
          cell({
            template: "UC-1",
            consumer: "coral",
            version: 1,
            channel: "web",
            err: 1,
            last: "2026-10-04T08:00:00.000Z",
          }),
        ],
        series: [
          { day: "2026-10-04", versionNumber: 1, outcome: "error", count: 1 },
        ],
      }),
    );
    expect(failed.success).toEqual({ ok: 0, errors: 1, pct: 0 });
    expect(failed.stats.renders.value).toBe(1);
    expect(failed.stats.errors.value).toBe(1);
    expect(failed.rows.map((r) => [r.renders30d, r.errors30d])).toEqual([
      [1, 1],
    ]);
    expect(failed.daily.at(-1)).toEqual({
      date: "2026-10-04",
      count: 1,
      errors: 1,
    });

    const none = templateUsage(
      bareTemplate({ versions: [version("UC-1", 1, "active")] }),
    );
    expect(none.success).toEqual({ ok: 0, errors: 0, pct: null });
    expect(none.stats.renders).toEqual({
      value: 0,
      display: "0",
      previous: 0,
      trendPct: null,
    });
    expect(none.stillOn).toEqual([]);
    expect(none.rows).toEqual([]);
  });

  it("lists released versions only, newest first", () => {
    const u = templateUsage(tfacts());
    // in_review, changes_requested and draft rows are not released: consumers never see them.
    expect(u.versions.map((v) => [v.number, v.state])).toEqual([
      [3, "active"],
      [2, "superseded"],
      [1, "revoked"],
    ]);
  });

  it("each version lists every consumer that rendered it, most renders first, then the latest render, then the name", () => {
    const u = templateUsage(tfacts());
    const v3 = u.versions[0]!;
    expect(v3.consumers).toEqual([
      {
        id: "coral",
        name: "Coral Mobile",
        renders30d: 72,
        errors30d: 2,
        lastRenderAt: "2026-10-04T09:00:00.000Z",
      },
      // 30 renders each: zeta rendered last; alpha and deposits-online tie on the instant, so the name decides.
      {
        id: "zeta",
        name: "Zeta",
        renders30d: 30,
        errors30d: 0,
        lastRenderAt: "2026-10-04T10:00:00.000Z",
      },
      {
        id: "alpha",
        name: "Alpha",
        renders30d: 30,
        errors30d: 0,
        lastRenderAt: "2026-10-04T09:00:00.000Z",
      },
      {
        id: "deposits-online",
        name: "Deposits Online",
        renders30d: 30,
        errors30d: 0,
        lastRenderAt: "2026-10-04T09:00:00.000Z",
      },
      // A consumer that only rendered it before the window is still one of its consumers (all-time cells).
      {
        id: "gamma",
        name: "Gamma",
        renders30d: 0,
        errors30d: 0,
        lastRenderAt: "2026-08-15T00:00:00.000Z",
      },
    ]);
    expect(u.versions[1]!.consumers).toEqual([
      {
        id: "coral",
        name: "Coral Mobile",
        renders30d: 11,
        errors30d: 1,
        lastRenderAt: "2026-10-02T00:00:00.000Z",
      },
      {
        id: "alpha",
        name: "Alpha",
        renders30d: 0,
        errors30d: 0,
        lastRenderAt: "2026-08-30T00:00:00.000Z",
      },
    ]);
    expect(u.versions[2]!.consumers).toEqual([
      {
        id: "coral",
        name: "Coral Mobile",
        renders30d: 4,
        errors30d: 4,
        lastRenderAt: "2026-10-03T00:00:00.000Z",
      },
    ]);
  });

  it("a version passes its dates through and carries the notes its sunset and failures call for", () => {
    const [v3, v2, v1] = templateUsage(tfacts()).versions;
    expect(v3).toMatchObject({
      number: 3,
      state: "active",
      activatedAt: "2026-09-15T00:00:00.000Z",
      sunsetAt: null,
      sunsetPassed: false,
      revokedAt: null,
      tags: [{ tone: "danger", text: "2 failed renders" }],
    });
    expect(v2).toMatchObject({
      activatedAt: "2026-07-01T00:00:00.000Z",
      sunsetAt: "2026-10-25T04:00:00.000Z",
      sunsetPassed: false,
      revokedAt: null,
      tags: [
        { tone: "warning", text: "sunset in 21 days" },
        { tone: "danger", text: "1 failed render" },
      ],
    });
    // A revoked version fails: that note stands for its 4 failed renders.
    expect(v1).toMatchObject({
      activatedAt: "2026-06-01T00:00:00.000Z",
      sunsetAt: null,
      revokedAt: "2026-07-01T00:00:00.000Z",
      tags: [{ tone: "danger", text: "renders fail" }],
    });
  });

  it("a superseded version past its sunset reads as failing, with its sunset passed", () => {
    const u = templateUsage(
      bareTemplate({
        versions: [
          version("UC-1", 1, "superseded", {
            sunset: sunset("2026-09-30T04:00:00.000Z", "2026-09-30", -4, true),
          }),
        ],
        cells: [
          cell({
            template: "UC-1",
            consumer: "coral",
            version: 1,
            channel: "web",
            err: 3,
            last: "2026-10-03T00:00:00.000Z",
          }),
        ],
      }),
    );
    expect(u.versions[0]).toMatchObject({
      sunsetAt: "2026-09-30T04:00:00.000Z",
      sunsetPassed: true,
      tags: [{ tone: "danger", text: "renders fail" }],
    });
    expect(u.rows[0]).toMatchObject({
      sunsetDay: "2026-09-30",
      sunsetPassed: true,
      tags: [{ tone: "danger", text: "renders fail" }],
    });
  });

  it("a released version nobody rendered is listed with no consumers", () => {
    const u = templateUsage(
      bareTemplate({ versions: [version("UC-1", 1, "active")] }),
    );
    expect(u.versions).toEqual([
      {
        number: 1,
        state: "active",
        activatedAt: null,
        sunsetAt: null,
        sunsetPassed: false,
        revokedAt: null,
        consumers: [],
        tags: [],
      },
    ]);
  });

  it("'who renders it': the dashboard's rows for this template, with the same order", () => {
    const u = templateUsage(tfacts());
    expect(u.rows.map(brief)).toEqual([
      ["coral", "UC-1", 3, 72, 2], // danger, most renders
      ["coral", "UC-1", 2, 11, 1], // danger and warning
      ["coral", "UC-1", 1, 4, 4], // danger
      ["alpha", "UC-1", 3, 30, 0], // no tag: 30 renders each, by name
      ["deposits-online", "UC-1", 3, 30, 0],
      ["zeta", "UC-1", 3, 30, 0],
    ]);
    expect(sum(u.rows.map((r) => r.renders30d))).toBe(177);
    expect(u.rows[0]!.consumer.name).toBe("Coral Mobile");
    // The v2 row: a sunset ahead and a failure.
    expect(u.rows[1]).toMatchObject({
      versionState: "superseded",
      sunsetDay: "2026-10-25",
      sunsetPassed: false,
      tags: [
        { tone: "warning", text: "sunset in 21 days" },
        { tone: "danger", text: "1 failed render" },
      ],
    });
    expect(u.rows[0]!.spark).toEqual(spark());
  });

  it("'still on': whole percentages of the window's renders on each version that is not Active, most first", () => {
    expect(templateUsage(tfacts()).stillOn).toEqual([
      { versionNumber: 2, state: "superseded", renders: 11, pct: 6 }, // 11 / 177
      { versionNumber: 1, state: "revoked", renders: 4, pct: 2 }, // 4 / 177
    ]);
  });

  it("a version missing from the facts is treated as superseded in 'still on', and is no listed version", () => {
    const u = templateUsage(
      bareTemplate({
        versions: [version("UC-1", 2, "active")],
        cells: [
          cell({
            template: "UC-1",
            consumer: "coral",
            version: 9,
            channel: "web",
            ok: 3,
            last: AS_OF,
          }),
          cell({
            template: "UC-1",
            consumer: "coral",
            version: 2,
            channel: "web",
            ok: 7,
            last: AS_OF,
          }),
        ],
      }),
    );
    expect(u.stillOn).toEqual([
      { versionNumber: 9, state: "superseded", renders: 3, pct: 30 },
    ]);
    expect(u.versions.map((v) => v.number)).toEqual([2]);
    expect(u.rows.find((r) => r.versionNumber === 9)).toMatchObject({
      versionState: "superseded",
      tags: [],
    });
  });

  it("channels follow the CHANNELS order, from the content type's allowed channels", () => {
    expect(templateUsage(tfacts()).channels).toEqual(["pdf", "web", "email"]);
    expect(
      templateUsage(bareTemplate({ allowedChannels: ["sms", "push"] }))
        .channels,
    ).toEqual(["push", "sms"]);
  });

  it("an alert splits its pushes by phone; a push logged with no phone is 'unrecorded'", () => {
    const push = (
      consumer: string,
      platform: UsageCell["platform"],
      counts: { ok?: number; err?: number },
    ) =>
      cell({
        template: "UC-1",
        consumer,
        version: 1,
        channel: "push",
        platform,
        ...counts,
        last: AS_OF,
      });
    const u = templateUsage(
      bareTemplate({
        allowedChannels: ["sms", "push"],
        versions: [version("UC-1", 1, "active")],
        cells: [
          push("coral", "ios", { ok: 4, err: 1 }),
          push("zeta", "ios", { ok: 3 }),
          push("coral", "android", { ok: 2 }),
          push("coral", null, { ok: 1, err: 1 }),
          cell({
            template: "UC-1",
            consumer: "coral",
            version: 1,
            channel: "sms",
            ok: 6,
            last: AS_OF,
          }),
        ],
      }),
    );
    expect(u.channels).toEqual(["push", "sms"]);
    // Failed pushes count as renders, as every other count does.
    expect(u.byChannel).toEqual(channelCounts({ push: 12, sms: 6 }));
    expect(u.pushByPlatform).toEqual({ ios: 8, android: 2, unrecorded: 2 });
    expect(sum(Object.values(u.pushByPlatform))).toBe(u.byChannel.push);
  });

  it("a document has no pushes to split", () => {
    expect(templateUsage(tfacts()).pushByPlatform).toEqual({
      ios: 0,
      android: 0,
      unrecorded: 0,
    });
  });

  it("recent failures keep their order, with the sentence for the code and the consumer's name", () => {
    const u = templateUsage(tfacts());
    expect(u.recentErrors).toEqual([
      {
        at: "2026-10-04T08:00:00.000Z",
        consumer: { id: "coral", name: "Coral Mobile" },
        versionNumber: 3,
        channel: "pdf",
        platform: null,
        code: "missing_variables",
        text: errorText("missing_variables"),
      },
      {
        at: "2026-10-03T00:00:00.000Z",
        consumer: { id: "deposits-online", name: "Deposits Online" },
        versionNumber: null,
        channel: "web",
        platform: null,
        code: "version_not_found",
        text: "The version wasn't found.",
      },
    ]);
  });

  it("a failed push names its phone", () => {
    const u = templateUsage(
      bareTemplate({
        recentErrors: [
          {
            at: AS_OF,
            consumerId: "coral",
            versionNumber: 1,
            channel: "push",
            platform: "android",
            code: "push_payload_too_large",
          },
        ],
      }),
    );
    expect(u.recentErrors[0]).toMatchObject({
      channel: "push",
      platform: "android",
      text: "The push was over 4,096 bytes.",
    });
  });

  it("weekly by version: the versions of the series ascending, every week zero-filled; rows with no version are left out of the columns", () => {
    const u = templateUsage(tfacts());
    // v1's only day (July 8) is before the first week, so it is no column.
    expect(u.weeklyVersions).toEqual([2, 3]);
    expect(u.weekly).toHaveLength(TREND_WEEKS);
    expect(u.weekly[0]!.weekStart).toBe("2026-07-12");
    const byStart = new Map(u.weekly.map((w) => [w.weekStart, w]));
    expect(byStart.get("2026-07-12")).toEqual({
      weekStart: "2026-07-12",
      count: 3,
      byVersion: { 2: 3, 3: 0 },
    });
    expect(byStart.get("2026-09-27")).toEqual({
      weekStart: "2026-09-27",
      count: 12,
      byVersion: { 2: 5, 3: 7 },
    });
    // 20 + 2 of v3; the failure with no version number is in no week.
    expect(byStart.get("2026-10-04")).toEqual({
      weekStart: "2026-10-04",
      count: 22,
      byVersion: { 2: 0, 3: 22 },
    });
    expect(byStart.get("2026-08-02")).toEqual({
      weekStart: "2026-08-02",
      count: 0,
      byVersion: { 2: 0, 3: 0 },
    });
    for (const week of u.weekly)
      expect(sum(Object.values(week.byVersion))).toBe(week.count);
  });

  it("daily: HISTORY_DAYS days with every row of the series, and the failures of each", () => {
    const u = templateUsage(tfacts());
    expect(u.daily).toHaveLength(HISTORY_DAYS);
    expect(u.daily[0]!.date).toBe("2026-07-07");
    expect(u.daily.at(-1)!.date).toBe("2026-10-04");
    expect(u.daily.filter((x) => x.count > 0)).toEqual([
      { date: "2026-07-08", count: 6, errors: 0 },
      { date: "2026-07-14", count: 3, errors: 0 },
      { date: "2026-09-28", count: 5, errors: 0 },
      { date: "2026-09-29", count: 7, errors: 0 },
      // 20 + 2 + 1; the failures are 2 + 1.
      { date: "2026-10-04", count: 23, errors: 3 },
    ]);
  });

  it("reads today as the UTC day of the instant", () => {
    const u = templateUsage(
      tfacts({
        asOf: "2026-10-05T02:00:00.000Z",
        series: [
          { day: "2026-10-05", versionNumber: 3, outcome: "ok", count: 2 },
        ],
      }),
    );
    expect(u.today).toBe("2026-10-05");
    expect(u.daily.at(-1)).toEqual({ date: "2026-10-05", count: 2, errors: 0 });
  });
});
