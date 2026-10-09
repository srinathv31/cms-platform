import { afterEach, describe, expect, it } from "vitest";
import { formatValue } from "@/editor/model/variables";
import { BUSINESS_ZONES, daysUntilSunset, sunsetInstant } from "./business-zone";
import {
  DAY_MS,
  addDays,
  dayStartMs,
  daysBetween,
  formatAgo,
  formatDateTime,
  formatLongDate,
  formatRecordedDate,
  formatShortDate,
  formatStamp,
  formatTime,
  formatWeekdayDate,
  isCalendarDay,
  utcDay,
} from "./dates";

const MARCH_1 = new Date("2027-03-01T15:30:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

/** 01:00 UTC on Sunday, October 4, 2026: the D9 case's "now". */
const ONE_AM = new Date("2026-10-04T01:00:00.000Z");
/** Two hours earlier, on the day before. */
const ELEVEN_PM = "2026-10-03T23:00:00.000Z";

describe("absolute dates, in UTC", () => {
  it("writes the long form in words", () => {
    expect(formatLongDate(MARCH_1)).toBe("March 1, 2027");
    expect(formatLongDate(new Date("2027-03-01T23:59:59.999Z"))).toBe("March 1, 2027");
    expect(formatLongDate(new Date("2026-09-30T00:00:00.000Z"))).toBe("September 30, 2026");
    expect(formatLongDate(MARCH_1)).toBe(formatValue("date", "2027-03-01"));
  });

  it("writes the short form, with the year only outside `now`'s year", () => {
    expect(formatShortDate(new Date("2026-10-17T00:00:00.000Z"))).toBe("Oct 17");
    expect(formatShortDate(new Date("2027-03-01T23:59:59.999Z"))).toBe("Mar 1");
    const now = new Date("2026-10-04T12:00:00.000Z");
    expect(formatShortDate("2026-10-17T00:00:00.000Z", now)).toBe("Oct 17");
    expect(formatShortDate("2027-03-01T00:00:00.000Z", now)).toBe("Mar 1, 2027");
  });

  it("reads a calendar day as itself", () => {
    expect(formatShortDate("2026-11-21")).toBe("Nov 21");
    expect(formatLongDate("2027-03-01")).toBe("March 1, 2027");
    expect(formatWeekdayDate("2027-01-14")).toBe("Thu, Jan 14, 2027");
  });

  it("says a time is UTC", () => {
    expect(formatTime(MARCH_1)).toBe("3:30 PM UTC");
    expect(formatDateTime(MARCH_1, MARCH_1)).toBe("Mar 1, 3:30 PM UTC");
    expect(formatDateTime(MARCH_1, "2026-10-04T00:00:00.000Z")).toBe("Mar 1, 2027, 3:30 PM UTC");
    expect(formatStamp("2026-10-05T02:29:00.000Z")).toBe("Mon, Oct 5, 2026, 2:29 AM UTC");
  });

  it("reads a date out of a stored record, or nothing", () => {
    expect(formatRecordedDate("2027-03-01T05:00:00.000Z")).toBe("March 1, 2027");
    expect(formatRecordedDate("not a date")).toBe("");
    expect(formatRecordedDate(undefined)).toBe("");
    expect(formatRecordedDate(1_700_000_000_000)).toBe("");
  });
});

describe("calendar days", () => {
  it("knows a real day", () => {
    expect(isCalendarDay("2027-03-01")).toBe(true);
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2027-02-29")).toBe(false);
    expect(isCalendarDay("2027-3-1")).toBe(false);
    expect(isCalendarDay("")).toBe(false);
  });

  it("reads an instant's UTC day and moves a day by whole days", () => {
    expect(utcDay("2026-10-05T02:29:00.000Z")).toBe("2026-10-05");
    expect(utcDay(new Date("2026-10-04T23:59:59.999Z"))).toBe("2026-10-04");
    expect(utcDay("2026-10-04")).toBe("2026-10-04");
    expect(dayStartMs("2026-10-04")).toBe(Date.UTC(2026, 9, 4));
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(DAY_MS).toBe(24 * HOUR);
  });

  it("counts calendar days between two days, either way", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-09", "2026-10-09")).toBe(0);
    expect(daysBetween("2026-10-10", "2026-10-09")).toBe(-1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("counts an instant as its UTC day, so midnight UTC is where a day ends (D9)", () => {
    // Two hours apart, but on two days: 23:00 yesterday is a day ago at 01:00.
    expect(daysBetween(ELEVEN_PM, ONE_AM)).toBe(1);
    expect(daysBetween("2026-10-04T00:00:00.000Z", ONE_AM)).toBe(0);
    expect(daysBetween("2026-10-03T23:59:59.999Z", ONE_AM)).toBe(1);
    // Almost two whole days apart, and still the day before.
    expect(daysBetween("2026-10-03T00:00:00.000Z", "2026-10-04T23:59:59.999Z")).toBe(1);
    expect(daysBetween(ONE_AM, ELEVEN_PM)).toBe(-1);
  });

  it("isn't moved by a US daylight-saving change: UTC days are always 24 hours", () => {
    // March 8 and November 1, 2026: the US clocks change, UTC's don't.
    expect(daysBetween("2026-03-07T23:00:00.000Z", "2026-03-09T01:00:00.000Z")).toBe(2);
    expect(daysBetween("2026-10-31T23:00:00.000Z", "2026-11-02T01:00:00.000Z")).toBe(2);
  });
});

describe("days in the business time zones (a sunset's)", () => {
  // `daysUntilSunset` hands `daysBetween` the zone's days, so midnight there is where a day ends.
  const days = ["2026-10-10", "2026-03-09", "2026-11-02"]; // an ordinary day, and the days after the US changes

  it.each(BUSINESS_ZONES.map((z) => z.id))("counts calendar days in %s, around midnight and across a DST change", (zone) => {
    for (const day of days) {
      const sunset = sunsetInstant(day, zone);
      const dayBefore = sunsetInstant(addDays(day, -1), zone);
      expect(daysUntilSunset(sunset, new Date(sunset.getTime() - 30 * MIN), zone), `23:30 before ${day}`).toBe(1);
      expect(daysUntilSunset(sunset, new Date(dayBefore.getTime() + 30 * MIN), zone), `00:30 the day before ${day}`).toBe(1);
      expect(daysUntilSunset(sunset, new Date(dayBefore.getTime() - MIN), zone), `23:59 two days before ${day}`).toBe(2);
      expect(daysUntilSunset(sunset, sunset, zone), `00:00 on ${day}`).toBe(0);
    }
  });

  it("counts the day before a spring-forward as one day away, though under 24 hours remain", () => {
    // From 00:30 on March 8 to 00:00 on March 9 in New York is 22.5 hours: the clocks skip 02:00 to 03:00.
    const zone = "America/New_York";
    const sunset = sunsetInstant("2026-03-09", zone);
    const now = new Date(sunsetInstant("2026-03-08", zone).getTime() + 30 * MIN);
    expect(sunset.getTime() - now.getTime()).toBeLessThan(DAY_MS);
    expect(daysUntilSunset(sunset, now, zone)).toBe(1);
  });
});

describe("formatAgo", () => {
  const NOW = new Date("2027-02-18T15:00:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it("says how long ago earlier today, rounded, never abbreviated or capitalized", () => {
    expect(formatAgo(ago(20_000), NOW)).toBe("just now");
    expect(formatAgo(ago(50_000), NOW)).toBe("50 seconds ago");
    expect(formatAgo(ago(MIN), NOW)).toBe("1 minute ago");
    expect(formatAgo(ago(12 * MIN), NOW)).toBe("12 minutes ago");
    expect(formatAgo(ago(90 * MIN), NOW)).toBe("2 hours ago");
    expect(formatAgo(ago(2 * HOUR), NOW)).toBe("2 hours ago");
    expect(formatAgo(ago(15 * HOUR), NOW)).toBe("15 hours ago");
  });

  it("says yesterday for any time on the day before, even an hour ago (D9)", () => {
    expect(formatAgo(ELEVEN_PM, ONE_AM)).toBe("yesterday");
    expect(formatAgo("2026-10-03T00:00:00.000Z", ONE_AM)).toBe("yesterday");
    expect(formatAgo("2026-10-04T00:30:00.000Z", ONE_AM)).toBe("30 minutes ago");
    expect(formatAgo(ago(30 * HOUR), NOW)).toBe("yesterday");
  });

  it("counts calendar days, then months and years", () => {
    expect(formatAgo("2026-10-02T23:59:00.000Z", ONE_AM)).toBe("2 days ago");
    expect(formatAgo(ago(3 * DAY_MS), NOW)).toBe("3 days ago");
    expect(formatAgo(ago(29 * DAY_MS), NOW)).toBe("29 days ago");
    expect(formatAgo(ago(45 * DAY_MS), NOW)).toBe("2 months ago");
    expect(formatAgo(ago(40 * DAY_MS), NOW)).toBe("1 month ago");
    expect(formatAgo(ago(350 * DAY_MS), NOW)).toBe("1 year ago");
    expect(formatAgo(ago(800 * DAY_MS), NOW)).toBe("2 years ago");
  });

  it("with day precision, says today for all of today and never turns days into months", () => {
    const day = { precision: "day" } as const;
    expect(formatAgo(ago(20_000), NOW, day)).toBe("today");
    expect(formatAgo("2026-10-04T00:30:00.000Z", ONE_AM, day)).toBe("today");
    expect(formatAgo(ELEVEN_PM, ONE_AM, day)).toBe("yesterday");
    expect(formatAgo(ago(95 * DAY_MS), NOW, day)).toBe("95 days ago");
  });

  it("gives the date from `dateFrom` days, with the year only when it differs", () => {
    expect(formatAgo(ago(13 * DAY_MS), NOW, { dateFrom: 14 })).toBe("13 days ago");
    expect(formatAgo("2027-01-20T10:00:00Z", NOW, { dateFrom: 14 })).toBe("Jan 20");
    expect(formatAgo("2026-11-02T10:00:00Z", NOW, { dateFrom: 14 })).toBe("Nov 2, 2026");
    expect(formatAgo("2027-02-16T23:00:00Z", NOW, { precision: "day", dateFrom: 2, capitalize: true })).toBe("Feb 16");
  });

  it("capitalizes a label that stands alone", () => {
    expect(formatAgo(ELEVEN_PM, ONE_AM, { capitalize: true })).toBe("Yesterday");
    expect(formatAgo(ago(0), NOW, { capitalize: true })).toBe("Just now");
    expect(formatAgo(ago(0), NOW, { precision: "day", capitalize: true })).toBe("Today");
    expect(formatAgo(ago(5 * DAY_MS), NOW, { capitalize: true })).toBe("5 days ago");
  });

  it("never says a time in the future, and survives a bad one", () => {
    expect(formatAgo(ago(-HOUR), NOW)).toBe("just now");
    expect(formatAgo(ago(-3 * DAY_MS), NOW)).toBe("just now");
    expect(formatAgo(ago(-HOUR), NOW, { precision: "day" })).toBe("today");
    expect(formatAgo("not a date", NOW)).toBe("");
  });

  it("takes a calendar day as `now` (a section's today)", () => {
    expect(formatAgo("2026-10-03T08:00:00.000Z", "2026-10-04", { precision: "day" })).toBe("yesterday");
    expect(formatAgo("2026-10-04T20:00:00.000Z", "2026-10-04", { precision: "day" })).toBe("today");
  });
});

describe("whatever zone the server runs in", () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it.each(["UTC", "America/New_York", "Pacific/Honolulu", "Asia/Tokyo"])("reads the same days in %s", (tz) => {
    process.env.TZ = tz;
    expect(daysBetween(ELEVEN_PM, ONE_AM)).toBe(1);
    expect(formatAgo(ELEVEN_PM, ONE_AM)).toBe("yesterday");
    expect(formatAgo("2026-10-04T00:30:00.000Z", ONE_AM, { precision: "day" })).toBe("today");
    expect(formatShortDate(ELEVEN_PM, ONE_AM)).toBe("Oct 3");
    expect(utcDay(ELEVEN_PM)).toBe("2026-10-03");
  });
});
