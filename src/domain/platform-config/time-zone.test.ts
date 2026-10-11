import { describe, expect, it } from "vitest";
import { PLATFORM_REFUSALS } from "./refusals";
import { describeZoneChange, setBusinessZone, zoneChangeConsequences } from "./time-zone";

describe("the business time zone (decision 0017)", () => {
  const riley = { id: "riley", name: "Riley Brooks" };
  const NOW = new Date("2026-10-04T12:00:00.000Z");

  it("describes the zone picked, as the admin picks it: nothing until it differs, a refusal off the list", () => {
    expect(describeZoneChange({ current: "America/New_York", next: "America/New_York" })).toEqual({ problem: null, changed: false, lines: [] });
    expect(describeZoneChange({ current: "America/New_York", next: "UTC" })).toEqual({
      problem: null,
      changed: true,
      lines: ["New sunset dates end at 00:00 UTC."],
    });
    expect(describeZoneChange({ current: "America/New_York", next: "Europe/London" })).toEqual({
      problem: PLATFORM_REFUSALS.pickZone,
      changed: true,
      lines: [],
    });
  });

  it("says what stays put: the sunsets already set, in the singular and the plural, and nothing with none", () => {
    expect(zoneChangeConsequences(0)).toEqual([]);
    expect(zoneChangeConsequences(1)).toEqual(["1 sunset already set doesn't move: its consumers have been told when it ends."]);
    expect(zoneChangeConsequences(3)).toEqual(["3 sunsets already set don't move: their consumers have been told when they end."]);
  });

  it("sets a zone on the list with one audit row, records nothing for the same zone, and refuses as the screen does", () => {
    expect(setBusinessZone({ current: "America/New_York", next: "America/Chicago", pendingSunsets: 2, actor: riley, now: NOW })).toEqual({
      ok: true,
      zone: "America/Chicago",
      effects: [
        {
          kind: "audit",
          action: "platform.config_changed",
          teamId: null,
          details: {
            area: "business_zone",
            summary: "Set the business time zone to Central (America/Chicago)",
            from: "America/New_York",
            to: "America/Chicago",
            pendingSunsets: 2,
          },
        },
      ],
    });
    expect(setBusinessZone({ current: "UTC", next: "UTC", pendingSunsets: 0, actor: riley, now: NOW })).toEqual({ ok: true, zone: "UTC", effects: [] });
    expect(setBusinessZone({ current: "UTC", next: "Mars/Olympus", pendingSunsets: 0, actor: riley, now: NOW })).toEqual({
      ok: false,
      ...describeZoneChange({ current: "UTC", next: "Mars/Olympus" }).problem,
    });
  });
});
