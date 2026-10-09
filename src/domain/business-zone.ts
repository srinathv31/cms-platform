// The platform's business time zone, and what a sunset date means in it (decision 0017). Pure TypeScript:
// only `Intl`, so it runs on the server and in the browser alike.
//
// A sunset date is a calendar day. Renders of the version stop at 00:00 on that day in the business time
// zone: one zone for the whole platform, chosen in Settings > Platform > Time zone, `America/New_York`
// until someone changes it. "Sunset on March 1" stops renders at 00:00 Eastern on March 1. Every other date
// the UI shows stays UTC (`./dates.ts`).
//
//   sunsetInstant("2027-03-01", "America/New_York")   2027-03-01T05:00:00.000Z, 00:00 EST
//   sunsetDay(instant, zone)                          "2027-03-01": the day an instant falls on in the zone
//   todayIn(now, zone)                                the zone's date at `now` (the picker's today)
//   daysUntilSunset(sunsetAt, now, zone)              whole days from today to the sunset's day, in the zone
//
// What is stored is the instant (`versions.sunset_at`), and it doesn't move: changing the business zone
// later leaves every sunset already set where it is, because consumers have been told when it ends.
//
// For a port: `sunsetInstant` is Java's `LocalDate.parse(day).atStartOfDay(ZoneId.of(zone)).toInstant()`.
// When the zone's clocks skip midnight (a spring-forward at 00:00, as in America/Santiago), the day starts
// at the first instant after the gap; when they repeat it (a fall-back to 00:00), at the earlier one.
// `sunsetDay` is `instant.atZone(zone).toLocalDate()`. The US zones change at 02:00, so their midnight
// always exists once.

const DAY_MS = 86_400_000;

/** Until a Platform Admin chooses another. */
export const DEFAULT_BUSINESS_ZONE = "America/New_York";

/**
 * The zones a Platform Admin may choose: the US time zones and UTC. A short list on purpose: each is a
 * zone the platform's teams work in, named the way people say it ("Eastern"), with its IANA id beside it.
 */
export const BUSINESS_ZONES = [
  { id: "America/New_York", name: "Eastern" },
  { id: "America/Chicago", name: "Central" },
  { id: "America/Denver", name: "Mountain" },
  { id: "America/Phoenix", name: "Arizona" },
  { id: "America/Los_Angeles", name: "Pacific" },
  { id: "America/Anchorage", name: "Alaska" },
  { id: "Pacific/Honolulu", name: "Hawaii" },
  { id: "UTC", name: "UTC" },
] as const;

export type BusinessZone = (typeof BUSINESS_ZONES)[number]["id"];

export function isBusinessZone(value: unknown): value is BusinessZone {
  return typeof value === "string" && BUSINESS_ZONES.some((z) => z.id === value);
}

/** "Eastern (America/New_York)", "UTC". A zone off the list is named by its id. */
export function zoneLabel(zone: string): string {
  const known = BUSINESS_ZONES.find((z) => z.id === zone);
  if (!known) return zone;
  return known.name === known.id ? known.id : `${known.name} (${known.id})`;
}

// ── Calendar days ────────────────────────────────────────────────────────────

/** Whether `value` is a real calendar day written YYYY-MM-DD ("2027-02-30" isn't). */
export function isCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(ms).toISOString().slice(0, 10) === value;
}

/** Whole days from one calendar day to another: 1 from "2026-10-09" to "2026-10-10". */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}

// ── Wall clocks ──────────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone (making one is the slow part). An unknown zone throws a RangeError. */
function wallFormat(zone: string): Intl.DateTimeFormat {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, format);
  }
  return format;
}

interface Wall {
  day: string;
  /** Milliseconds since that day's 00:00 on the wall clock. */
  sinceMidnight: number;
  /** The wall clock read as if it were UTC, in ms: the instant plus the zone's offset at it. */
  asUtc: number;
}

/** What a clock on the wall in `zone` shows at `ms` (to the second). */
function wallAt(ms: number, zone: string): Wall {
  const parts: Record<string, number> = {};
  for (const part of wallFormat(zone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts;
  const midnight = Date.UTC(year, month - 1, day);
  const sinceMidnight = ((hour * 60 + minute) * 60 + second) * 1000;
  return { day: new Date(midnight).toISOString().slice(0, 10), sinceMidnight, asUtc: midnight + sinceMidnight };
}

/** The zone's offset from UTC at `ms`, in ms (-5 h in New York in winter). */
function offsetAt(ms: number, zone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return wallAt(whole, zone).asUtc - whole;
}

// ── The rule ─────────────────────────────────────────────────────────────────

/** The calendar day a stored sunset falls on in `zone`, the day people read: "2027-03-01". */
export function sunsetDay(sunsetAt: Date, zone: string): string {
  return wallAt(sunsetAt.getTime(), zone).day;
}

/** Today's date in `zone` at `now` (the demo clock): the day the sunset picker marks, and the one a sunset must come after. */
export function todayIn(now: Date, zone: string): string {
  return wallAt(now.getTime(), zone).day;
}

/**
 * The instant a sunset on `day` stops renders: 00:00 on that day in `zone`. A zone's offset at its own
 * midnight is one of the offsets in force around it, so each is tried and a wall clock that reads 00:00 on
 * the day wins (the earlier, when a fall-back shows midnight twice). When none does, the clocks skipped
 * midnight that day, and the day starts at the first instant after the gap.
 */
export function sunsetInstant(day: string, zone: string): Date {
  if (!isCalendarDay(day)) throw new RangeError(`Not a calendar day: ${day}`);
  const midnight = Date.parse(`${day}T00:00:00.000Z`);
  const candidates = [midnight - DAY_MS, midnight, midnight + DAY_MS]
    .map((probe) => midnight - offsetAt(probe, zone))
    .sort((a, b) => a - b);
  const exact = candidates.find((ms) => {
    const wall = wallAt(ms, zone);
    return wall.day === day && wall.sinceMidnight === 0;
  });
  if (exact !== undefined) return new Date(exact);
  return new Date(firstInstantOf(day, zone, midnight));
}

/**
 * The first second whose wall clock reads `day`: a binary search between a moment certainly on the day
 * before (no zone is ahead of UTC by 15 hours) and one certainly on or after the day (nor behind it by 15).
 */
function firstInstantOf(day: string, zone: string, midnight: number): number {
  let before = midnight - 15 * 3_600_000;
  let onOrAfter = midnight + 15 * 3_600_000;
  while (onOrAfter - before > 1000) {
    const mid = Math.floor((before + onOrAfter) / 2000) * 1000;
    if (wallAt(mid, zone).day >= day) onOrAfter = mid;
    else before = mid;
  }
  return onOrAfter;
}

/**
 * Whole days from today to the day a sunset falls on, both in the zone: 1 the day before (renders stop at
 * midnight tonight), 0 or less once that day has come.
 */
export function daysUntilSunset(sunsetAt: Date, now: Date, zone: string): number {
  return daysBetween(todayIn(now, zone), sunsetDay(sunsetAt, zone));
}

/**
 * The sunset day a stored record names (an audit row's details, a notice's payload): its `sunsetDay`, or,
 * in a record written before the business zone, the UTC date of its `sunsetAt`, which is what a sunset
 * date meant then. Null when it names neither.
 */
export function recordedSunsetDay(record: { sunsetDay?: unknown; sunsetAt?: unknown }): string | null {
  if (typeof record.sunsetDay === "string" && isCalendarDay(record.sunsetDay)) return record.sunsetDay;
  if (typeof record.sunsetAt !== "string") return null;
  const at = new Date(record.sunsetAt);
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10);
}
