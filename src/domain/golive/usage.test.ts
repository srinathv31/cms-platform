import { describe, expect, it } from "vitest";
import { HEATMAP_WEEKS, type UsageRow } from "../golive-types";
import {
  calendarDaysUntil,
  compactCount,
  compareUsageRows,
  countsAsUsage,
  errorText,
  heatmap,
  percent,
  trendPct,
  usageTags,
  usageWindows,
  weekStartOf,
  windowOf,
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
  it("calendar days count UTC days, not 24-hour spans", () => {
    expect(calendarDaysUntil(new Date("2026-10-05T00:00:00Z"), NOW)).toBe(1);
    expect(calendarDaysUntil(new Date("2026-10-04T23:59:00Z"), NOW)).toBe(0);
    expect(calendarDaysUntil(new Date("2026-10-25T12:00:00Z"), NOW)).toBe(21);
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
    expect(last.map((c) => c.inRange)).toEqual([true, true, true, true, false, false, false]);
    expect(map.total).toBe(0);
    expect(map.busiest).toBeNull();
    expect(map.thresholds).toEqual([0, 0, 0, 0]);
  });

  it("levels 1–4 by quartiles of the non-zero days; zero is level 0", () => {
    const counts = new Map<string, number>();
    const days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-09-27"];
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
    expect(cells.get("2026-10-10")!).toMatchObject({ count: 0, level: 0, inRange: false });
    expect(map.total).toBe(360);
    expect(map.busiest).toEqual({ date: "2026-09-27", count: 80 });
    for (const cell of map.weeks.flat()) expect([0, 1, 2, 3, 4]).toContain(cell.level);
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

describe("usageTags", () => {
  const base = { versionNumber: 1, sunsetAt: null, revokedAt: null, errors30d: 0 };

  it("active rows get none", () => {
    expect(usageTags({ ...base, state: "active" }, NOW, "UTC")).toEqual([]);
  });
  it("superseded with a sunset ahead: warning, counted in calendar days", () => {
    expect(usageTags({ ...base, state: "superseded", sunsetAt: new Date("2026-10-25T12:00:00Z") }, NOW, "UTC")).toEqual([
      { tone: "warning", text: "sunset in 21 days" },
    ]);
    expect(usageTags({ ...base, state: "superseded", sunsetAt: new Date("2026-10-05T00:00:00Z") }, NOW, "UTC")[0]!.text).toBe(
      "sunset tomorrow",
    );
    expect(usageTags({ ...base, state: "superseded", sunsetAt: new Date("2026-10-04T20:00:00Z") }, NOW, "UTC")[0]!.text).toBe(
      "sunset today",
    );
  });
  it("counts the days in the business time zone, where the sunset's day is", () => {
    // 21:00 Eastern on October 4 is already October 5 in UTC; the sunset is 00:00 Eastern on October 6.
    const evening = new Date("2026-10-05T01:00:00Z");
    const sunsetAt = new Date("2026-10-06T04:00:00Z");
    expect(usageTags({ ...base, state: "superseded", sunsetAt }, evening, "America/New_York")[0]!.text).toBe("sunset in 2 days");
    expect(usageTags({ ...base, state: "superseded", sunsetAt }, evening, "UTC")[0]!.text).toBe("sunset tomorrow");
  });
  it("a sunset beyond the nearing window stays neutral", () => {
    expect(usageTags({ ...base, state: "superseded", sunsetAt: new Date("2027-03-01T00:00:00Z") }, NOW, "UTC")).toEqual([
      { tone: "neutral", text: "sunset in 148 days" },
    ]);
  });
  it("superseded with no sunset: no note (the Version badge says it)", () => {
    expect(usageTags({ ...base, versionNumber: 2, state: "superseded" }, NOW, "UTC")).toEqual([]);
  });
  it("a passed sunset or a revoke fails renders: danger, and no separate failure count", () => {
    expect(usageTags({ ...base, state: "superseded", sunsetAt: new Date("2026-10-01T00:00:00Z"), errors30d: 4 }, NOW, "UTC")).toEqual([
      { tone: "danger", text: "renders fail" },
    ]);
    expect(usageTags({ ...base, state: "superseded", sunsetAt: NOW }, NOW, "UTC")[0]!.tone).toBe("danger");
    expect(usageTags({ ...base, state: "revoked", revokedAt: at(3), errors30d: 2 }, NOW, "UTC")).toEqual([
      { tone: "danger", text: "renders fail" },
    ]);
  });
  it("failed renders tag any version that still renders", () => {
    expect(usageTags({ ...base, versionNumber: 2, state: "active", errors30d: 3 }, NOW, "UTC")).toEqual([{ tone: "danger", text: "3 failed renders" }]);
    expect(usageTags({ ...base, state: "active", errors30d: 1 }, NOW, "UTC")).toEqual([{ tone: "danger", text: "1 failed render" }]);
    expect(usageTags({ ...base, state: "superseded", sunsetAt: new Date("2026-10-25T12:00:00Z"), errors30d: 2 }, NOW, "UTC")).toEqual([
      { tone: "warning", text: "sunset in 21 days" },
      { tone: "danger", text: "2 failed renders" },
    ]);
  });
});

describe("compareUsageRows", () => {
  const row = (name: string, renders30d: number, tones: ("danger" | "warning" | "neutral")[]): UsageRow => ({
    consumer: { id: name, name },
    template: { id: "UC-1", name: "T", teamSlug: "coral-offers" },
    versionNumber: 1,
    versionState: "active",
    renders30d,
    errors30d: 0,
    lastRenderAt: NOW.toISOString(),
    tags: tones.map((tone) => ({ tone, text: tone })),
    sunsetDay: null,
    spark: [],
  });
  it("danger first, then warning, then other tags, then renders desc", () => {
    const rows = [row("a", 900, []), row("b", 5, ["warning"]), row("c", 1, ["danger"]), row("d", 50, ["neutral"]), row("e", 10, ["warning"])];
    expect(rows.sort(compareUsageRows).map((r) => r.consumer.name)).toEqual(["c", "e", "b", "d", "a"]);
  });
});

describe("display", () => {
  it("compactCount", () => {
    expect(compactCount(1)).toBe("1");
    expect(compactCount(812)).toBe("812");
    expect(compactCount(1_234)).toBe("1.2k");
    expect(compactCount(27_412)).toBe("27.4k");
    expect(compactCount(1_300_000)).toBe("1.3m");
  });
  it("errorText reads every code as a sentence", () => {
    expect(errorText("missing_variables")).toBe("Missing required variables.");
    expect(errorText("invalid_values")).toBe("A value had the wrong format.");
    expect(errorText("version_sunset")).toBe("The version was sunset.");
  });
});
