import { describe, expect, it } from "vitest";
import { formatRelative } from "@/components/versions/format";
import { relativeTime } from "./format";

const NOW = Date.parse("2027-02-18T15:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("reads like a person would say it, in the long form the review header uses", () => {
    expect(relativeTime(ago(20_000), NOW)).toBe("just now");
    expect(relativeTime(ago(MIN), NOW)).toBe("1 minute ago");
    expect(relativeTime(ago(12 * MIN), NOW)).toBe("12 minutes ago");
    expect(relativeTime(ago(2 * HOUR), NOW)).toBe("2 hours ago");
    expect(relativeTime(ago(30 * HOUR), NOW)).toBe("1 day ago");
    expect(relativeTime(ago(3 * DAY), NOW)).toBe("3 days ago");
  });

  it("says exactly what the header says for the same instant", () => {
    for (const age of [10_000, 3 * MIN, 59 * MIN, 5 * HOUR, 20 * HOUR, 2 * DAY, 9 * DAY]) {
      expect(relativeTime(ago(age), NOW)).toBe(formatRelative(ago(age), new Date(NOW)));
    }
  });

  it("is never capitalised and never abbreviated", () => {
    for (const age of [0, 20_000, 12 * MIN, 3 * HOUR, DAY, 3 * DAY]) {
      const text = relativeTime(ago(age), NOW);
      expect(text).toBe(text.toLowerCase());
      expect(text).not.toMatch(/\d(m|h|d) ago/);
    }
  });

  it("falls back to a date after two weeks, with the year only when it differs", () => {
    expect(relativeTime("2027-01-20T10:00:00Z", NOW)).toBe("Jan 20");
    expect(relativeTime("2026-11-02T10:00:00Z", NOW)).toBe("Nov 2, 2026");
  });

  it("never says a time in the future, and survives a bad one", () => {
    expect(relativeTime(new Date(NOW + HOUR).toISOString(), NOW)).toBe("just now");
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});
