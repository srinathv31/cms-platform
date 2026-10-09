import { describe, expect, it } from "vitest";
import {
  BUSINESS_ZONES,
  DEFAULT_BUSINESS_ZONE,
  daysUntilSunset,
  isBusinessZone,
  sunsetDay,
  sunsetInstant,
  todayIn,
  zoneLabel,
} from "./business-zone";

const NY = "America/New_York";
const iso = (d: Date) => d.toISOString();

describe("sunsetInstant: 00:00 on the day, in the zone", () => {
  it("is midnight Eastern: 05:00 UTC in winter, 04:00 in summer", () => {
    expect(iso(sunsetInstant("2027-03-01", NY))).toBe("2027-03-01T05:00:00.000Z");
    expect(iso(sunsetInstant("2026-07-04", NY))).toBe("2026-07-04T04:00:00.000Z");
  });

  it("is right on both sides of the spring-forward day (2026-03-08: clocks jump at 02:00, after midnight)", () => {
    expect(iso(sunsetInstant("2026-03-07", NY))).toBe("2026-03-07T05:00:00.000Z");
    expect(iso(sunsetInstant("2026-03-08", NY))).toBe("2026-03-08T05:00:00.000Z"); // still EST at 00:00
    expect(iso(sunsetInstant("2026-03-09", NY))).toBe("2026-03-09T04:00:00.000Z"); // EDT
  });

  it("is right on both sides of the fall-back day (2026-11-01: clocks go back at 02:00)", () => {
    expect(iso(sunsetInstant("2026-10-31", NY))).toBe("2026-10-31T04:00:00.000Z");
    expect(iso(sunsetInstant("2026-11-01", NY))).toBe("2026-11-01T04:00:00.000Z"); // still EDT at 00:00
    expect(iso(sunsetInstant("2026-11-02", NY))).toBe("2026-11-02T05:00:00.000Z"); // EST
  });

  it("is midnight UTC in UTC, and follows every other US zone", () => {
    expect(iso(sunsetInstant("2026-03-08", "UTC"))).toBe("2026-03-08T00:00:00.000Z");
    expect(iso(sunsetInstant("2026-03-08", "America/Los_Angeles"))).toBe("2026-03-08T08:00:00.000Z");
    expect(iso(sunsetInstant("2026-07-01", "America/Phoenix"))).toBe("2026-07-01T07:00:00.000Z"); // no DST
    expect(iso(sunsetInstant("2026-03-08", "Pacific/Honolulu"))).toBe("2026-03-08T10:00:00.000Z");
  });

  it("starts a day whose midnight the clocks skip at the first instant after the gap (Santiago, 2026-09-06)", () => {
    const start = sunsetInstant("2026-09-06", "America/Santiago");
    expect(iso(start)).toBe("2026-09-06T04:00:00.000Z"); // 01:00 local: 00:00 never happens that day
    expect(sunsetDay(start, "America/Santiago")).toBe("2026-09-06");
    expect(sunsetDay(new Date(start.getTime() - 1000), "America/Santiago")).toBe("2026-09-05");
  });

  it("takes the earlier midnight when the clocks show it twice (Havana, 2026-11-01)", () => {
    expect(iso(sunsetInstant("2026-11-01", "America/Havana"))).toBe("2026-11-01T04:00:00.000Z");
  });

  it("lands on the UTC day before for a zone ahead of UTC", () => {
    expect(iso(sunsetInstant("2026-10-10", "Asia/Kolkata"))).toBe("2026-10-09T18:30:00.000Z");
    expect(sunsetDay(sunsetInstant("2026-10-10", "Asia/Kolkata"), "Asia/Kolkata")).toBe("2026-10-10");
  });

  it("refuses what isn't a calendar day", () => {
    expect(() => sunsetInstant("2027-02-30", NY)).toThrow(RangeError);
    expect(() => sunsetInstant("soon", NY)).toThrow(RangeError);
  });

  it("is the first instant of its day in every offered zone, every day of 2026 and 2027", () => {
    for (const { id } of BUSINESS_ZONES) {
      for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2028, 0, 1); ms += 86_400_000) {
        const day = new Date(ms).toISOString().slice(0, 10);
        const start = sunsetInstant(day, id);
        expect(sunsetDay(start, id), `${day} in ${id}`).toBe(day);
        expect(sunsetDay(new Date(start.getTime() - 1000), id), `the second before ${day} in ${id}`).not.toBe(day);
      }
    }
  });
});

describe("today and the days until a sunset, in the zone", () => {
  it("is still Friday in New York at 23:30, when UTC is already Saturday", () => {
    const now = new Date("2026-10-10T03:30:00.000Z"); // Fri Oct 9, 23:30 EDT
    expect(todayIn(now, NY)).toBe("2026-10-09");
    expect(todayIn(now, "UTC")).toBe("2026-10-10");
  });

  it("counts a sunset tomorrow as one day away until midnight, whatever the UTC date", () => {
    const sunset = sunsetInstant("2026-10-10", NY); // 2026-10-10T04:00Z
    expect(daysUntilSunset(sunset, new Date("2026-10-09T16:00:00.000Z"), NY)).toBe(1);
    expect(daysUntilSunset(sunset, new Date("2026-10-10T03:30:00.000Z"), NY)).toBe(1); // 23:30 EDT
    expect(daysUntilSunset(sunset, sunset, NY)).toBe(0);
  });

  it("reads a stored sunset as its day in the zone", () => {
    expect(sunsetDay(new Date("2027-03-01T05:00:00.000Z"), NY)).toBe("2027-03-01");
    // A sunset at midnight UTC (the rule before the business zone) is the evening before in New York.
    expect(sunsetDay(new Date("2027-03-01T00:00:00.000Z"), NY)).toBe("2027-02-28");
  });
});

describe("the zones on offer", () => {
  it("defaults to Eastern, and offers the US zones and UTC", () => {
    expect(DEFAULT_BUSINESS_ZONE).toBe("America/New_York");
    expect(isBusinessZone(DEFAULT_BUSINESS_ZONE)).toBe(true);
    expect(BUSINESS_ZONES.map((z) => z.id)).toEqual([
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Phoenix",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
      "UTC",
    ]);
    expect(isBusinessZone("Europe/London")).toBe(false);
    expect(isBusinessZone(5)).toBe(false);
  });

  it("names a zone the way people say it, with its id", () => {
    expect(zoneLabel(NY)).toBe("Eastern (America/New_York)");
    expect(zoneLabel("Pacific/Honolulu")).toBe("Hawaii (Pacific/Honolulu)");
    expect(zoneLabel("UTC")).toBe("UTC");
    expect(zoneLabel("Europe/London")).toBe("Europe/London");
  });
});
