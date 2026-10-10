import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ActivityItem } from "@/domain/review-types";
import { dayGroups } from "./day-groups";

// The Activity tab's days are UTC days, like every absolute date on the Versions and Activity tabs,
// whatever the server's time zone. These run with the zone set to New York (UTC-4 in October), where the
// demo clock's evening is already the next UTC day.

vi.hoisted(() => {
  process.env.TZ = "America/New_York";
});

// 22:29 on October 4 in New York; 02:29 on October 5 in UTC.
const BOUNDARY = "2026-10-05T02:29:00.000Z";
const NOW = new Date("2026-10-05T10:00:00.000Z");

const item = (id: string, at: string): ActivityItem => ({
  id,
  at,
  actor: null,
  action: "draft.edited",
  versionLabel: null,
  summary: id,
});

const labels = (items: ActivityItem[], now = NOW) => dayGroups(items, now).map((g) => [g.label, g.items.map((i) => i.id)]);

beforeAll(() => {
  // The zone really is New York: the same instant has two different days.
  const at = new Date(BOUNDARY);
  expect(at.getDate()).toBe(4);
  expect(at.getUTCDate()).toBe(5);
});

describe("dayGroups", () => {
  it("labels a UTC day Today, Yesterday, then its UTC date", () => {
    expect(labels([item("a", BOUNDARY)])).toEqual([["Today", ["a"]]]);
    expect(labels([item("a", "2026-10-04T23:30:00.000Z")])).toEqual([["Yesterday", ["a"]]]);
    expect(labels([item("a", "2026-10-03T23:30:00.000Z")])).toEqual([["Oct 3", ["a"]]]);
    expect(labels([item("a", "2025-12-30T12:00:00.000Z")])).toEqual([["Dec 30, 2025", ["a"]]]);
  });

  it("splits at midnight UTC, not at midnight in the server's zone", () => {
    // Both are October 4 in New York (22:29 and 19:30), but October 5 and October 4 in UTC.
    expect(labels([item("later", BOUNDARY), item("earlier", "2026-10-04T23:30:00.000Z"), item("older", "2026-10-03T10:00:00.000Z")])).toEqual([
      ["Today", ["later"]],
      ["Yesterday", ["earlier"]],
      ["Oct 3", ["older"]],
    ]);
  });

  it("keeps one UTC day together, however the local clock splits it", () => {
    // 20:00 UTC on October 4 is 16:00 in New York, 00:30 UTC on October 4 is 20:30 on October 3 there.
    expect(labels([item("a", "2026-10-04T20:00:00.000Z"), item("b", "2026-10-04T00:30:00.000Z")])).toEqual([["Yesterday", ["a", "b"]]]);
  });

  it("calls 23:00 yesterday Yesterday at 01:00, though only two hours have passed (D9)", () => {
    expect(labels([item("a", "2026-10-04T23:00:00.000Z")], new Date("2026-10-05T01:00:00.000Z"))).toEqual([["Yesterday", ["a"]]]);
  });
});
