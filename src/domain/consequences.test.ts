import { describe, expect, it } from "vitest";
import { breakingKeysOf, consequences } from "./consequences";
import type { ConsumerUsage } from "./review-types";
import type { ContractChange } from "./types";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const MARCH_1 = "2027-03-01T00:00:00.000Z";

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

const row = (consumerName: string, versionNumber: number, lastRenderAt: string, renders30d: number): ConsumerUsage => ({
  consumerId: consumerName.toLowerCase().replace(/\s+/g, "-"),
  consumerName,
  versionNumber,
  lastRenderAt,
  renders30d,
});

const CORAL_V1 = row("Coral", 1, hoursAgo(2), 412);
const DEPOSITS_V1 = row("Deposits Online", 1, daysAgo(3), 12);
const CORAL_V2 = row("Coral", 2, hoursAgo(1), 80);

describe("consequences: approve", () => {
  it("names the consumers that keep rendering the previous version until they relink (the build plan's example)", () => {
    expect(
      consequences({ kind: "approve", newNumber: 2, previousNumber: 1, sunsetAt: null }, [CORAL_V1], NOW),
    ).toEqual(["v2 becomes Active. v1 becomes Superseded; Coral keeps rendering v1 until it relinks."]);
  });

  it("names several consumers, most used first", () => {
    expect(
      consequences({ kind: "approve", newNumber: 2, previousNumber: 1, sunsetAt: null }, [DEPOSITS_V1, CORAL_V1], NOW),
    ).toEqual(["v2 becomes Active. v1 becomes Superseded; Coral and Deposits Online keep rendering v1 until they relink."]);
  });

  it("says when no consumer renders the previous version", () => {
    expect(consequences({ kind: "approve", newNumber: 2, previousNumber: 1, sunsetAt: null }, [], NOW)).toEqual([
      "v2 becomes Active. v1 becomes Superseded.",
      "No consumer renders v1.",
    ]);
  });

  it("counts only renders of the previous version", () => {
    expect(
      consequences({ kind: "approve", newNumber: 3, previousNumber: 2, sunsetAt: null }, [CORAL_V1, DEPOSITS_V1], NOW),
    ).toEqual(["v3 becomes Active. v2 becomes Superseded.", "No consumer renders v2."]);
  });

  it("with a sunset, says until when each consumer keeps working", () => {
    expect(
      consequences({ kind: "approve", newNumber: 2, previousNumber: 1, sunsetAt: MARCH_1 }, [CORAL_V1, DEPOSITS_V1], NOW),
    ).toEqual([
      "v2 becomes Active. v1 becomes Superseded.",
      "Coral still renders v1 (last render today). It will keep working until March 1, 2027.",
      "Deposits Online still renders v1 (last render 3 days ago). It will keep working until March 1, 2027.",
    ]);
  });

  it("with a sunset and no consumers", () => {
    expect(consequences({ kind: "approve", newNumber: 2, previousNumber: 1, sunsetAt: MARCH_1 }, [], NOW)).toEqual([
      "v2 becomes Active. v1 becomes Superseded.",
      "No consumer renders v1.",
    ]);
  });

  it("names the consumers of the previous version when it names three of them (Oxford comma)", () => {
    const usage = [row("Coral", 1, hoursAgo(2), 412), row("Deposits Online", 1, daysAgo(3), 12), row("Cards", 1, daysAgo(9), 3)];
    expect(consequences({ kind: "approve", newNumber: 2, previousNumber: 1, sunsetAt: null }, usage, NOW)).toEqual([
      "v2 becomes Active. v1 becomes Superseded; Coral, Deposits Online, and Cards keep rendering v1 until they relink.",
    ]);
  });

  it("a first version has nothing to supersede", () => {
    expect(consequences({ kind: "approve", newNumber: 1, previousNumber: null, sunsetAt: null }, [CORAL_V2], NOW)).toEqual([
      "v1 becomes Active.",
      "Consumers can start using it right away.",
    ]);
  });
});

describe("consequences: approve a breaking version", () => {
  const breaking = (...keys: string[]) => ({ kind: "approve" as const, newNumber: 3, previousNumber: 2, sunsetAt: null, breakingKeys: keys });

  it("adds a line for each consumer of the previous version: what it has to map before it moves", () => {
    expect(consequences(breaking("annual_fee"), [CORAL_V2], NOW)).toEqual([
      "v3 becomes Active. v2 becomes Superseded; Coral keeps rendering v2 until it relinks.",
      "Coral has to map `annual_fee` before it moves to v3.",
    ]);
  });

  it("lists several keys with 'and', and Oxford commas from three", () => {
    expect(consequences(breaking("annual_fee", "bonus_points"), [CORAL_V2], NOW).at(-1)).toBe(
      "Coral has to map `annual_fee` and `bonus_points` before it moves to v3.",
    );
    expect(consequences(breaking("annual_fee", "bonus_points", "home_state"), [CORAL_V2], NOW).at(-1)).toBe(
      "Coral has to map `annual_fee`, `bonus_points`, and `home_state` before it moves to v3.",
    );
  });

  it("gives each consumer its own line, most used first, after the sunset lines", () => {
    const usage = [row("Deposits Online", 2, daysAgo(3), 12), CORAL_V2];
    expect(consequences({ ...breaking("annual_fee"), sunsetAt: MARCH_1 }, usage, NOW)).toEqual([
      "v3 becomes Active. v2 becomes Superseded.",
      "Coral still renders v2 (last render today). It will keep working until March 1, 2027.",
      "Deposits Online still renders v2 (last render 3 days ago). It will keep working until March 1, 2027.",
      "Coral has to map `annual_fee` before it moves to v3.",
      "Deposits Online has to map `annual_fee` before it moves to v3.",
    ]);
  });

  it("says nothing about mapping when no consumer renders the previous version", () => {
    expect(consequences(breaking("annual_fee"), [CORAL_V1], NOW)).toEqual([
      "v3 becomes Active. v2 becomes Superseded.",
      "No consumer renders v2.",
    ]);
  });

  it("says nothing about mapping when no key breaks (empty or missing)", () => {
    const plain = consequences({ kind: "approve", newNumber: 3, previousNumber: 2, sunsetAt: null }, [CORAL_V2], NOW);
    expect(consequences(breaking(), [CORAL_V2], NOW)).toEqual(plain);
    expect(plain).toEqual(["v3 becomes Active. v2 becomes Superseded; Coral keeps rendering v2 until it relinks."]);
  });

  it("a first version has nobody to map for", () => {
    expect(
      consequences({ kind: "approve", newNumber: 1, previousNumber: null, sunsetAt: null, breakingKeys: ["annual_fee"] }, [CORAL_V2], NOW),
    ).toEqual(["v1 becomes Active.", "Consumers can start using it right away."]);
  });
});

describe("breakingKeysOf", () => {
  const added = (key: string, required: boolean): ContractChange => ({ kind: "added", key, breaking: required, type: "text", required });

  it("takes the keys of what a consumer has to map: a required variable added, a rename, a type change, made required", () => {
    expect(
      breakingKeysOf([
        { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
        { kind: "key_renamed", key: "state", breaking: true, from: "home_state", to: "state" },
        { kind: "type_changed", key: "apr", breaking: true, from: "text", to: "percent" },
        { kind: "made_required", key: "promo_code", breaking: true },
      ]),
    ).toEqual(["annual_fee", "state", "apr", "promo_code"]);
  });

  it("leaves out what doesn't break, and removals (the consumer just stops sending them)", () => {
    expect(
      breakingKeysOf([
        added("bonus_points", false),
        { kind: "made_optional", key: "a", breaking: false },
        { kind: "label_changed", key: "b", breaking: false, from: "B", to: "Bee" },
        { kind: "removed", key: "old_key", breaking: true, type: "text", required: true },
      ]),
    ).toEqual([]);
  });

  it("lists a key once when several changes hit it", () => {
    expect(
      breakingKeysOf([
        { kind: "type_changed", key: "fee", breaking: true, from: "text", to: "currency" },
        { kind: "made_required", key: "fee", breaking: true },
        added("other", true),
      ]),
    ).toEqual(["fee", "other"]);
  });
});

describe("consequences: sunset", () => {
  it("says who still renders it and until when (the build plan's example)", () => {
    expect(consequences({ kind: "sunset", number: 1, sunsetAt: MARCH_1, activeNumber: 2 }, [CORAL_V1], NOW)).toEqual([
      "Coral still renders v1 (last render today). It will keep working until March 1, 2027.",
    ]);
  });

  it("phrases the last render from the demo clock, by calendar day", () => {
    const line = (lastRenderAt: string) =>
      consequences({ kind: "sunset", number: 1, sunsetAt: MARCH_1, activeNumber: 2 }, [row("Coral", 1, lastRenderAt, 5)], NOW)[0];
    expect(line(hoursAgo(11))).toBe("Coral still renders v1 (last render today). It will keep working until March 1, 2027.");
    // 23:00 on October 3 is yesterday at noon on October 4, though less than a day has passed.
    expect(line(hoursAgo(13))).toBe("Coral still renders v1 (last render yesterday). It will keep working until March 1, 2027.");
    expect(line(hoursAgo(30))).toBe("Coral still renders v1 (last render yesterday). It will keep working until March 1, 2027.");
    expect(line(daysAgo(3))).toBe("Coral still renders v1 (last render 3 days ago). It will keep working until March 1, 2027.");
  });

  it("takes a YYYY-MM-DD date as the dialog's date picker gives it", () => {
    expect(consequences({ kind: "sunset", number: 1, sunsetAt: "2026-10-18", activeNumber: 2 }, [CORAL_V1], NOW)).toEqual([
      "Coral still renders v1 (last render today). It will keep working until October 18, 2026.",
    ]);
  });

  it("lists several consumers, one line each, most used first", () => {
    expect(
      consequences({ kind: "sunset", number: 1, sunsetAt: MARCH_1, activeNumber: 2 }, [DEPOSITS_V1, CORAL_V2, CORAL_V1], NOW),
    ).toEqual([
      "Coral still renders v1 (last render today). It will keep working until March 1, 2027.",
      "Deposits Online still renders v1 (last render 3 days ago). It will keep working until March 1, 2027.",
    ]);
  });

  it("says when no consumer renders it", () => {
    expect(consequences({ kind: "sunset", number: 1, sunsetAt: MARCH_1, activeNumber: 2 }, [CORAL_V2], NOW)).toEqual([
      "No consumer renders v1.",
    ]);
  });
});

describe("consequences: revoke", () => {
  it("says how much each consumer renders it, and that those renders fail now (the build plan's example)", () => {
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2 }, [CORAL_V1], NOW)).toEqual([
      "Coral rendered v1 412 times in the last 30 days. Its renders will fail immediately.",
    ]);
  });

  it("counts once, and thousands with separators", () => {
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2 }, [row("Coral", 1, hoursAgo(5), 1)], NOW)).toEqual([
      "Coral rendered v1 once in the last 30 days. Its renders will fail immediately.",
    ]);
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2 }, [row("Coral", 1, hoursAgo(5), 1204)], NOW)).toEqual([
      "Coral rendered v1 1,204 times in the last 30 days. Its renders will fail immediately.",
    ]);
  });

  it("names the last render when there were none in the last 30 days", () => {
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2 }, [row("Coral", 1, daysAgo(45), 0)], NOW)).toEqual([
      "Coral last rendered v1 45 days ago. Its renders will fail immediately.",
    ]);
  });

  it("lists several consumers, one line each, most used first", () => {
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2 }, [DEPOSITS_V1, CORAL_V1], NOW)).toEqual([
      "Coral rendered v1 412 times in the last 30 days. Its renders will fail immediately.",
      "Deposits Online rendered v1 12 times in the last 30 days. Its renders will fail immediately.",
    ]);
  });

  it("says when no consumer renders it", () => {
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2 }, [], NOW)).toEqual(["No consumer renders v1."]);
  });

  it("warns that revoking the Active version leaves nothing Active", () => {
    expect(consequences({ kind: "revoke", number: 2, activeNumber: 2 }, [CORAL_V2], NOW)).toEqual([
      "Coral rendered v2 80 times in the last 30 days. Its renders will fail immediately.",
      "No version will be Active until a new one is approved.",
    ]);
    expect(consequences({ kind: "revoke", number: 2, activeNumber: 2 }, [], NOW)).toEqual([
      "No consumer renders v2.",
      "No version will be Active until a new one is approved.",
    ]);
  });

  it("says in the future tense what a revoke that is only requested will do (`pending`)", () => {
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2, pending: true }, [DEPOSITS_V1, CORAL_V1], NOW)).toEqual([
      "Coral rendered v1 412 times in the last 30 days. Once confirmed, its renders will fail immediately.",
      "Deposits Online rendered v1 12 times in the last 30 days. Once confirmed, its renders will fail immediately.",
    ]);
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2, pending: true }, [row("Coral", 1, daysAgo(45), 0)], NOW)).toEqual([
      "Coral last rendered v1 45 days ago. Once confirmed, its renders will fail immediately.",
    ]);
  });

  it("keeps the facts of a pending revoke as facts, and puts only the effects after the confirmation", () => {
    expect(consequences({ kind: "revoke", number: 2, activeNumber: 2, pending: true }, [CORAL_V2], NOW)).toEqual([
      "Coral rendered v2 80 times in the last 30 days. Once confirmed, its renders will fail immediately.",
      "Once confirmed, no version will be Active until a new one is approved.",
    ]);
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2, pending: true }, [], NOW)).toEqual(["No consumer renders v1."]);
  });

  it("reads a revoke without `pending`, or with it false, as the confirmation itself", () => {
    const plain = consequences({ kind: "revoke", number: 1, activeNumber: 2 }, [CORAL_V1], NOW);
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2, pending: false }, [CORAL_V1], NOW)).toEqual(plain);
    expect(plain).toEqual(["Coral rendered v1 412 times in the last 30 days. Its renders will fail immediately."]);
  });

  it("adds up a consumer listed twice for the same version", () => {
    const split = [row("Coral", 1, daysAgo(2), 400), row("Coral", 1, hoursAgo(2), 12)];
    expect(consequences({ kind: "revoke", number: 1, activeNumber: 2 }, split, NOW)).toEqual([
      "Coral rendered v1 412 times in the last 30 days. Its renders will fail immediately.",
    ]);
    expect(consequences({ kind: "sunset", number: 1, sunsetAt: MARCH_1, activeNumber: 2 }, split, NOW)).toEqual([
      "Coral still renders v1 (last render today). It will keep working until March 1, 2027.",
    ]);
  });
});

describe("the last render's day", () => {
  const revoked = (lastRenderAt: string, now = NOW) =>
    consequences({ kind: "revoke", number: 1, activeNumber: 2 }, [row("Coral", 1, lastRenderAt, 0)], now)[0];

  it("counts calendar days on the demo clock, not 24-hour periods (D9)", () => {
    const oneAm = new Date("2026-10-04T01:00:00.000Z");
    expect(revoked("2026-10-03T23:00:00.000Z", oneAm)).toBe("Coral last rendered v1 yesterday. Its renders will fail immediately.");
    expect(revoked("2026-10-04T00:30:00.000Z", oneAm)).toBe("Coral last rendered v1 today. Its renders will fail immediately.");
    expect(revoked("2026-10-02T23:59:00.000Z", oneAm)).toBe("Coral last rendered v1 2 days ago. Its renders will fail immediately.");
  });

  it("keeps counting days, with no date in place of them", () => {
    expect(revoked(hoursAgo(0))).toBe("Coral last rendered v1 today. Its renders will fail immediately.");
    expect(revoked(daysAgo(2))).toBe("Coral last rendered v1 2 days ago. Its renders will fail immediately.");
    expect(revoked(daysAgo(15))).toBe("Coral last rendered v1 15 days ago. Its renders will fail immediately.");
  });

  it("reads a render after `now` (a clock rewound by a reset) as today", () => {
    expect(revoked(hoursAgo(-5))).toBe("Coral last rendered v1 today. Its renders will fail immediately.");
  });
});
