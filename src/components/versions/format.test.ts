import { beforeAll, describe, expect, it, vi } from "vitest";

// Every absolute date on the Versions and Activity tabs reads in UTC, like the render API's and the domain's
// sentences ("October 5"), whatever the server's time zone. These run with the zone set to New York (UTC-4
// in October), where the demo clock's evening is already the next UTC day.

vi.hoisted(() => {
  process.env.TZ = "America/New_York";
});

const { formatDate, formatSunset, formatStamp, formatWhen, formatRelative } = await import("./format");
const { dayGroups, dayLabel } = await import("../activity/day-groups");
const { formatLongDate } = await import("@/domain/render/errors");
import type { ActivityItem } from "@/domain/review-types";

// 22:29 on October 4 in New York; 02:29 on October 5 in UTC.
const BOUNDARY = "2026-10-05T02:29:00.000Z";
const NOW = new Date("2026-10-05T10:00:00.000Z");

beforeAll(() => {
  // The zone really is New York: the same instant has two different days.
  const at = new Date(BOUNDARY);
  expect(at.getDate()).toBe(4);
  expect(at.getUTCDate()).toBe(5);
});

describe("absolute dates are UTC days", () => {
  it("reads an evening in New York as the next UTC day, like the domain's long date", () => {
    expect(formatDate(BOUNDARY, NOW)).toBe("Oct 5");
    expect(formatLongDate(new Date(BOUNDARY))).toBe("October 5, 2026");
    expect(formatDate("2026-10-05T00:00:00.000Z", NOW)).toBe("Oct 5");
    expect(formatDate("2026-10-04T23:59:59.000Z", NOW)).toBe("Oct 4");
  });

  it("adds the year when the UTC year isn't this one, and not before", () => {
    // 21:00 on December 31 in New York is already January 1, 2027 in UTC.
    expect(formatDate("2027-01-01T02:00:00.000Z", new Date("2026-12-31T23:00:00.000Z"))).toBe("Jan 1, 2027");
    expect(formatDate("2026-12-31T23:00:00.000Z", new Date("2027-01-01T02:00:00.000Z"))).toBe("Dec 31, 2026");
    expect(formatDate("2026-03-05T12:00:00.000Z", NOW)).toBe("Mar 5");
  });

  it("reads a sunset day (YYYY-MM-DD, in the business time zone) as that day, as the header's badge does", () => {
    // Read as a local date, New York would say Nov 20: the day must not move with the viewer's zone.
    expect(formatSunset("2026-11-21", NOW)).toBe("Nov 21");
    expect(formatSunset("2027-03-01", NOW)).toBe("Mar 1, 2027");
  });

  it("puts the absolute time of a stamp in UTC, and says so", () => {
    expect(formatStamp(BOUNDARY)).toBe("Mon, Oct 5, 2026, 2:29 AM UTC");
  });

  it("leaves relative times alone", () => {
    expect(formatRelative("2026-10-05T09:55:00.000Z", NOW)).toBe("5 minutes ago");
    expect(formatWhen(NOW.toISOString(), NOW)).toBe("today");
    // Past two weeks it falls back to the (UTC) date.
    expect(formatWhen("2026-09-01T02:00:00.000Z", NOW)).toBe("Sep 1");
  });
});

describe("the Activity tab's days are UTC days", () => {
  const item = (id: string, at: string): ActivityItem => ({
    id,
    at,
    actor: null,
    action: "draft.edited",
    versionNumber: null,
    summary: id,
  });

  it("labels a UTC day with its UTC date, not the local one", () => {
    expect(dayLabel(new Date("2026-10-03T23:30:00.000Z"), NOW)).toBe("Oct 3");
    expect(dayLabel(new Date("2026-10-04T23:30:00.000Z"), NOW)).toBe("Yesterday");
    expect(dayLabel(new Date(BOUNDARY), NOW)).toBe("Today");
  });

  it("splits at midnight UTC, not at midnight in the server's zone", () => {
    // Both are October 4 in New York (22:29 and 19:30), but October 5 and October 4 in UTC.
    const groups = dayGroups([item("later", BOUNDARY), item("earlier", "2026-10-04T23:30:00.000Z"), item("older", "2026-10-03T10:00:00.000Z")], NOW);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["later"]],
      ["Yesterday", ["earlier"]],
      ["Oct 3", ["older"]],
    ]);
  });

  it("keeps one UTC day together, however the local clock splits it", () => {
    // 20:00 UTC on October 4 is 16:00 in New York, 00:30 UTC on October 4 is 20:30 on October 3 there.
    const groups = dayGroups([item("a", "2026-10-04T20:00:00.000Z"), item("b", "2026-10-04T00:30:00.000Z")], NOW);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([["Yesterday", ["a", "b"]]]);
  });
});
