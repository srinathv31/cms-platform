import { describe, expect, it } from "vitest";
import { REFUSALS } from "./refusals";
import { setSunset, sweepSunsets, type SunsetFacts } from "./sunset";
import { VERSION_STATES } from "../types";
import {
  NOW,
  TEMPLATE,
  ZONE,
  TOMORROW_DAY,
  TOMORROW,
  MARCH_1_DAY,
  MARCH_1,
  LATE_EVENING,
  ANNUAL_FEE_ADDED,
  reviewVersion,
} from "./fixtures";

describe("setSunset", () => {
  const v1 = reviewVersion({ state: "superseded", submittedBy: "priya" });
  const run = (over: Partial<Parameters<typeof setSunset>[0]> = {}) =>
    setSunset({
      version: v1,
      actorId: "jordan",
      now: NOW,
      sunsetDay: MARCH_1_DAY,
      zone: ZONE,
      activeNumber: 2,
      templateName: "Balance Transfer Intro",
      ...over,
    });

  it("schedules the sunset at 00:00 Eastern on the day, and tells the consumers and the version's author", () => {
    expect(run()).toEqual({
      ok: true,
      changes: { sunsetAt: MARCH_1, sunsetSetBy: "jordan" },
      effects: [
        {
          kind: "audit",
          action: "version.sunset_set",
          details: { number: 1, sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01", zone: ZONE, previousSunsetAt: null },
        },
        {
          kind: "consumer_notice",
          notice: "sunset_scheduled",
          versionId: "v_1",
          payload: { versionNumber: 1, activeVersion: 2, sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01", zone: ZONE },
        },
        {
          kind: "notification",
          notification: "sunset_scheduled",
          to: { kind: "user", userId: "priya" },
          title: "Balance Transfer Intro v1 will stop rendering on March 1, 2027.",
          link: { to: "versions", templateId: TEMPLATE.id },
        },
      ],
    });
  });

  it("moves an existing sunset, earlier or later, and records the old date", () => {
    const scheduled = { ...v1, sunsetAt: new Date("2026-10-25T04:00:00.000Z") };
    for (const [sunsetDay, sunsetAt] of [
      [TOMORROW_DAY, TOMORROW],
      [MARCH_1_DAY, MARCH_1],
    ] as const) {
      const result = run({ version: scheduled, sunsetDay });
      expect(result.ok && result.changes.sunsetAt).toEqual(sunsetAt);
      expect(result.ok && result.effects[0]).toEqual({
        kind: "audit",
        action: "version.sunset_set",
        details: { number: 1, sunsetAt: sunsetAt.toISOString(), sunsetDay, zone: ZONE, previousSunsetAt: "2026-10-25T04:00:00.000Z" },
      });
    }
  });

  it("ends the day at 00:00 in the zone, across a DST change", () => {
    // 2026-11-01: clocks go back at 02:00, so its midnight is still EDT; the next day's is EST.
    expect(run({ sunsetDay: "2026-11-01" })).toMatchObject({ changes: { sunsetAt: new Date("2026-11-01T04:00:00.000Z") } });
    expect(run({ sunsetDay: "2026-11-02" })).toMatchObject({ changes: { sunsetAt: new Date("2026-11-02T05:00:00.000Z") } });
    expect(run({ sunsetDay: "2026-11-02", zone: "UTC" })).toMatchObject({ changes: { sunsetAt: new Date("2026-11-02T00:00:00.000Z") } });
  });

  it.each([
    ["today", "2026-10-04"],
    ["in the past", "2026-01-01"],
  ])("refuses a date %s", (_, sunsetDay) => {
    expect(run({ sunsetDay })).toEqual({ ok: false, code: "sunset_not_after_today", reason: "Pick a date after today." });
  });

  it("reads today in the business time zone: at 23:30 Eastern, tomorrow is still tomorrow", () => {
    expect(run({ now: LATE_EVENING, sunsetDay: TOMORROW_DAY })).toMatchObject({ ok: true, changes: { sunsetAt: TOMORROW } });
    expect(run({ now: LATE_EVENING, sunsetDay: "2026-10-04" })).toEqual({ ok: false, code: "sunset_not_after_today", reason: "Pick a date after today." });
  });

  it("sends the contract changes consumers will meet on the Active version, when given", () => {
    const result = run({ contractChanges: [ANNUAL_FEE_ADDED] });
    expect(result.ok && result.effects[1]).toEqual({
      kind: "consumer_notice",
      notice: "sunset_scheduled",
      versionId: "v_1",
      payload: {
        versionNumber: 1,
        activeVersion: 2,
        sunsetAt: "2027-03-01T05:00:00.000Z",
        sunsetDay: "2027-03-01",
        zone: ZONE,
        contractChanges: [ANNUAL_FEE_ADDED],
        contractLines: ["v2 adds required `annual_fee` (Currency)."],
      },
    });
  });

  it("doesn't notify the author when they set it", () => {
    const result = run({ actorId: "priya" });
    expect(result.ok && result.effects.map((e) => e.kind)).toEqual(["audit", "consumer_notice"]);
  });

  it("moves a sunset that is still to come, even one due at the next midnight", () => {
    const scheduled = { ...v1, sunsetAt: TOMORROW };
    const result = run({ version: scheduled, sunsetDay: MARCH_1_DAY });
    expect(result.ok && result.changes).toEqual({ sunsetAt: MARCH_1, sunsetSetBy: "jordan" });
  });

  // A version past its sunset has stopped rendering and its consumers have moved on: a new date would
  // make it render again.
  it.each([
    ["the day before", new Date("2026-10-03T00:00:00.000Z")],
    ["earlier today", new Date("2026-10-04T00:00:00.000Z")],
    ["this very instant", NOW],
  ])("refuses any new date once the sunset has passed (%s)", (_, passed) => {
    const sunset = { ...v1, sunsetAt: passed };
    for (const sunsetDay of [TOMORROW_DAY, MARCH_1_DAY]) {
      expect(run({ version: sunset, sunsetDay })).toEqual({
        ok: false,
        code: "sunset_passed",
        reason: "This version's sunset has passed. It can't render again.",
      });
    }
  });

  it("says the version isn't Superseded before it says the sunset passed", () => {
    const revoked = { ...v1, state: "revoked" as const, sunsetAt: new Date("2026-10-03T00:00:00.000Z") };
    expect(run({ version: revoked })).toEqual({ ok: false, ...REFUSALS.sunsetNotSuperseded });
  });
});

describe("sweepSunsets", () => {
  // 00:00 Eastern on October 4 (EDT): eight hours before NOW. 21:00 on October 3 in Pacific.
  const SUNSET = new Date("2026-10-04T04:00:00.000Z");
  const MS_PER_DAY = 86_400_000;
  const facts = (over: Partial<SunsetFacts> = {}): SunsetFacts => ({
    id: "v_bt1",
    templateId: "UC-4F7K2Q",
    teamId: "coral-offers",
    number: 1,
    state: "superseded",
    sunsetAt: SUNSET,
    revokedAt: null,
    passedRecorded: false,
    activeNumber: 2,
    ...over,
  });
  const sweep = (versions: SunsetFacts[], now = NOW, zone = ZONE) => sweepSunsets({ versions, now, zone });

  it("records a passed sunset as the system, dated at the sunset, with its day and the zone, and tells consumers", () => {
    expect(sweep([facts()])).toEqual([
      {
        versionId: "v_bt1",
        templateId: "UC-4F7K2Q",
        teamId: "coral-offers",
        at: SUNSET,
        effects: [
          {
            kind: "audit",
            action: "version.sunset_passed",
            details: { number: 1, sunsetAt: "2026-10-04T04:00:00.000Z", sunsetDay: "2026-10-04", zone: ZONE },
          },
          {
            kind: "consumer_notice",
            notice: "sunset_passed",
            versionId: "v_bt1",
            payload: { versionNumber: 1, activeVersion: 2, sunsetAt: "2026-10-04T04:00:00.000Z", sunsetDay: "2026-10-04", zone: ZONE },
          },
        ],
      },
    ]);
  });

  it("one audit row and one notice per passed sunset, nothing else: no notification", () => {
    const passed = sweep([facts({ id: "v_a" }), facts({ id: "v_b", templateId: "UC-OTHER1", activeNumber: 5 })]);
    expect(passed.map((p) => p.effects.map((e) => e.kind))).toEqual([
      ["audit", "consumer_notice"],
      ["audit", "consumer_notice"],
    ]);
    expect(passed.map((p) => p.effects[1])).toMatchObject([
      { notice: "sunset_passed", versionId: "v_a", payload: { activeVersion: 2 } },
      { notice: "sunset_passed", versionId: "v_b", payload: { activeVersion: 5 } },
    ]);
  });

  it("the notice names the Active version to move to, or none when nothing is Active", () => {
    const [passed] = sweep([facts({ state: "revoked", revokedAt: new Date(SUNSET.getTime() + 1), activeNumber: null })]);
    expect(passed!.effects[1]).toMatchObject({ kind: "consumer_notice", payload: { versionNumber: 1, activeVersion: null } });
  });

  it("passed is sunsetPassed: from the sunset's instant, not a millisecond before", () => {
    expect(sweep([facts()], SUNSET)).toHaveLength(1);
    expect(sweep([facts()], new Date(SUNSET.getTime() - 1))).toEqual([]);
    expect(sweep([facts({ sunsetAt: TOMORROW })])).toEqual([]);
    expect(sweep([facts({ sunsetAt: null })])).toEqual([]);
  });

  it("finds exactly the passed sunsets nothing records yet, oldest first", () => {
    const versions = [
      facts({ id: "v_later", sunsetAt: new Date(SUNSET.getTime() - MS_PER_DAY) }),
      facts({ id: "v_recorded", passedRecorded: true }),
      facts({ id: "v_ahead", sunsetAt: TOMORROW }),
      facts({ id: "v_none", sunsetAt: null }),
      facts({ id: "v_earlier", sunsetAt: new Date(SUNSET.getTime() - 3 * MS_PER_DAY) }),
      facts({ id: "v_same_b" }),
      facts({ id: "v_same_a" }),
    ];
    // Same instant: by id.
    expect(sweep(versions).map((p) => p.versionId)).toEqual(["v_earlier", "v_later", "v_same_a", "v_same_b"]);
  });

  it("is idempotent: once its row is written, the next sweep, now or later, finds nothing, so no second notice", () => {
    expect(sweep([facts()]).map((p) => p.versionId)).toEqual(["v_bt1"]);
    const recorded = facts({ passedRecorded: true });
    expect(sweep([recorded])).toEqual([]);
    expect(sweep([recorded], new Date(NOW.getTime() + 30 * MS_PER_DAY))).toEqual([]);
  });

  it("names the day in the business time zone it reads at the sweep, in the row and the notice", () => {
    const [passed] = sweep([facts()], NOW, "America/Los_Angeles");
    expect(passed!.effects[0]).toMatchObject({ details: { sunsetDay: "2026-10-03", zone: "America/Los_Angeles" } });
    expect(passed!.effects[1]).toMatchObject({ payload: { sunsetDay: "2026-10-03", zone: "America/Los_Angeles" } });
  });

  it("skips a version revoked at or before its sunset (its renders had already stopped); records one revoked after", () => {
    expect(sweep([facts({ state: "revoked", revokedAt: new Date(SUNSET.getTime() - MS_PER_DAY) })])).toEqual([]);
    expect(sweep([facts({ state: "revoked", revokedAt: SUNSET })])).toEqual([]);
    expect(sweep([facts({ state: "revoked", revokedAt: null })])).toEqual([]);
    expect(sweep([facts({ state: "revoked", revokedAt: new Date(SUNSET.getTime() + 1) })]).map((p) => p.at)).toEqual([SUNSET]);
  });

  it("records nothing for a state that never carries a sunset, or an unnumbered version", () => {
    for (const state of VERSION_STATES.filter((x) => x !== "superseded" && x !== "revoked")) {
      expect(sweep([facts({ state })]), state).toEqual([]);
    }
    expect(sweep([facts({ number: null })])).toEqual([]);
  });
});
