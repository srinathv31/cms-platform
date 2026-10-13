// The seed as one language-neutral JSON fixture (decision 0069), for a loader on the Java side. It holds
// what `seedDatabase` writes, table by table in foreign-key order, with the table and column names the database
// has and the ids the spec spells out, and no absolute time: every instant and calendar day the reset's moment
// decides is a marker that a loader resolves against the moment it loads. The shape is described in
// README.md ("The fixture").

import { getTableColumns, getTableName } from "drizzle-orm";
import {
  DEFAULT_BUSINESS_ZONE,
  sunsetInstant,
  todayIn,
} from "@/domain/business-zone";
import { DAY_MS, addDays, daysBetween, isCalendarDay } from "@/domain/dates";
import { SEED_VERSION, buildSeed } from "./index";

/** The version of the fixture's own format. */
export const FIXTURE_FORMAT = 1;

/**
 * The reset moment the fixture is built at, so the file is the same on every run. Only a marker's meaning is
 * relative to a reset; the render history's random times are one realization of it, drawn at this moment.
 */
export const FIXTURE_BASE = new Date("2026-01-01T12:00:00.000Z");

/** The ways a time marker says what it stands for. A marker is an object with exactly these keys. */
export type TimeMarker =
  /** The instant `daysAgo` days (a decimal; negative is the future) before the reset. */
  | { daysAgo: number }
  /** The calendar day `dayOffset` days after (negative: before) the reset's own day in `zone`. */
  | { dayOffset: number; zone: string }
  /** The first instant of that calendar day in `zone`: where a sunset stops renders. */
  | { dayOffset: number; zone: string; startOfDay: true };

export interface SeedFixture {
  format: typeof FIXTURE_FORMAT;
  seedVersion: string;
  /** Template ids by seed key, e.g. "balance-transfer". */
  templates: Record<string, string>;
  /** In the order to insert them: a table's rows refer only to tables before it. */
  tables: { name: string; rows: Record<string, unknown>[] }[];
}

// ── Markers ─────────────────────────────────────────────────────────────────

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a time marker (an object with exactly the keys of one of the kinds above). */
export function isTimeMarker(value: unknown): value is TimeMarker {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const keys = Object.keys(value).sort().join();
  return (
    keys === "daysAgo" ||
    keys === "dayOffset,zone" ||
    keys === "dayOffset,startOfDay,zone"
  );
}

/**
 * What a marker stands for when the reset happens at `resetAt`: a Date for an instant, a `YYYY-MM-DD` string for
 * a calendar day. This is the whole of a loader's time logic. In a column an instant is a timestamp; inside a JSON
 * value it is written as an ISO 8601 string in UTC with milliseconds.
 */
export function resolveMarker(
  marker: TimeMarker,
  resetAt: Date,
): Date | string {
  if ("daysAgo" in marker)
    return new Date(resetAt.getTime() - Math.round(marker.daysAgo * DAY_MS));
  const day = addDays(todayIn(resetAt, marker.zone), marker.dayOffset);
  return "startOfDay" in marker ? sunsetInstant(day, marker.zone) : day;
}

/** A JSON value with every marker in it resolved: instants as ISO strings, days as `YYYY-MM-DD`. */
export function resolveJson(value: unknown, resetAt: Date): unknown {
  if (isTimeMarker(value)) {
    const resolved = resolveMarker(value, resetAt);
    return resolved instanceof Date ? resolved.toISOString() : resolved;
  }
  if (Array.isArray(value)) return value.map((v) => resolveJson(v, resetAt));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveJson(v, resetAt)]),
    );
  }
  return value;
}

const instantMarker = (instant: Date, base: Date): TimeMarker => ({
  daysAgo: (base.getTime() - instant.getTime()) / DAY_MS,
});

const dayMarker = (day: string, zone: string, base: Date): TimeMarker => ({
  dayOffset: daysBetween(todayIn(base, zone), day),
  zone,
});

const startOfDayMarker = (
  instant: Date,
  zone: string,
  base: Date,
): TimeMarker => {
  const day = todayIn(instant, zone);
  return { ...dayMarker(day, zone, base), startOfDay: true } as TimeMarker;
};

/** Fails if a marker doesn't resolve, at the base it was made at, to the value it replaced. */
function verified<T extends TimeMarker>(
  marker: T,
  original: Date | string,
  base: Date,
): T {
  const resolved = resolveMarker(marker, base);
  const same =
    original instanceof Date
      ? resolved instanceof Date && resolved.getTime() === original.getTime()
      : resolved === original;
  if (!same)
    throw new Error(
      `Seed fixture: ${JSON.stringify(marker)} resolves to ${String(resolved)}, not ${String(original)}`,
    );
  return marker;
}

// ── Values ──────────────────────────────────────────────────────────────────

/**
 * A JSON column's value with its times made relative: an ISO instant, or a calendar day (the UTC day of a
 * date the seed derived from the reset, as a sample value's is). The sunset a notice or audit event records is
 * written in its business time zone, as an instant and the day it falls on: both stay in step.
 */
function exportJson(value: unknown, base: Date): unknown {
  if (typeof value === "string") {
    if (ISO_INSTANT.test(value))
      return verified(
        instantMarker(new Date(value), base),
        new Date(value),
        base,
      );
    if (CALENDAR_DAY.test(value) && isCalendarDay(value))
      return verified(dayMarker(value, "UTC", base), value, base);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => exportJson(v, base));
  if (typeof value !== "object" || value === null) return value;

  const record = value as Record<string, unknown>;
  const { sunsetAt, sunsetDay, zone } = record;
  const sunset =
    typeof sunsetAt === "string" &&
    typeof sunsetDay === "string" &&
    typeof zone === "string";
  if (sunset && sunsetInstant(sunsetDay, zone).toISOString() !== sunsetAt)
    throw new Error(
      `Seed fixture: ${sunsetAt} isn't the start of ${sunsetDay} in ${zone}`,
    );
  return Object.fromEntries(
    Object.entries(record).map(([key, v]) => {
      if (sunset && key === "sunsetAt")
        return [
          key,
          verified(
            startOfDayMarker(new Date(sunsetAt), zone, base),
            new Date(sunsetAt),
            base,
          ),
        ];
      if (sunset && key === "sunsetDay")
        return [
          key,
          verified(dayMarker(sunsetDay, zone, base), sunsetDay, base),
        ];
      return [key, exportJson(v, base)];
    }),
  );
}

/** A timestamp column's value. A version's `sunset_at` is the start of a day in the business zone. */
function exportInstant(
  instant: Date,
  table: string,
  column: string,
  base: Date,
): TimeMarker {
  if (table === "versions" && column === "sunset_at") {
    const zone = DEFAULT_BUSINESS_ZONE;
    const day = todayIn(instant, zone);
    if (sunsetInstant(day, zone).getTime() === instant.getTime())
      return verified(startOfDayMarker(instant, zone, base), instant, base);
  }
  return verified(instantMarker(instant, base), instant, base);
}

function exportRow(
  table: Parameters<typeof getTableColumns>[0],
  row: object,
  base: Date,
): Record<string, unknown> {
  const name = getTableName(table);
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    const value = (row as Record<string, unknown>)[key] ?? null;
    if (value === null) out[column.name] = null;
    else if (column.dataType === "date")
      out[column.name] = exportInstant(value as Date, name, column.name, base);
    else if (column.dataType === "json")
      out[column.name] = exportJson(value, base);
    else out[column.name] = value;
  }
  return out;
}

/** The seed built at `base`, as a fixture: the same rows `seedDatabase` writes, with every time relative to it. */
export function buildFixture(base: Date = FIXTURE_BASE): SeedFixture {
  const { tables, templates } = buildSeed(base);
  return {
    format: FIXTURE_FORMAT,
    seedVersion: SEED_VERSION,
    templates,
    tables: tables.map(({ table, rows }) => ({
      name: getTableName(table),
      rows: rows.map((row) => exportRow(table, row, base)),
    })),
  };
}

/** The fixture as JSON text, one row to a line, so a change to the seed shows as a short diff. */
export function stringifyFixture(fixture: SeedFixture): string {
  const tables = fixture.tables.map(
    ({ name, rows }) =>
      `  { "name": ${JSON.stringify(name)}, "rows": [\n${rows
        .map((row) => `    ${JSON.stringify(row)}`)
        .join(",\n")}\n  ] }`,
  );
  return [
    "{",
    `  "format": ${fixture.format},`,
    `  "seedVersion": ${JSON.stringify(fixture.seedVersion)},`,
    `  "templates": ${JSON.stringify(fixture.templates)},`,
    `  "tables": [\n${tables.join(",\n")}\n  ]`,
    "}",
    "",
  ].join("\n");
}
