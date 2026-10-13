import { describe, expect, it } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { RecordedRender, UsageHarness } from "./harness";

// The Usage counts, as every implementation must answer them (UsageService in src/server/services/usage.ts).
// The cases put their own renders in the render log at exact instants (`h.renders`) and read the counts back
// with the clock set long after every seeded render (FAR), so only the renders a case recorded count. The seed:
// Balance Transfer v1 is Superseded (sunset 00:00 Eastern on October 25, 2026), v2 Active, and Coral renders
// both; High-Yield Savings (Deposits) is v2 Active after two send-backs, rendered by Deposits Online; Annual
// Fee Waiver has no released version.
//
// Days are UTC days (decision 0028); a sunset is a day in the business time zone (decision 0017); renders at one
// instant are ordered by the order they were written in (decision 0063). Refusals are compared by code.

const DAY = 86_400_000;
const FAR = new Date("2028-03-15T12:00:00.000Z");

export function usageContract(h: UsageHarness, base: Date) {
  const BT = () => h.templates["balance-transfer"]!;
  const HYS = () => h.templates["high-yield-savings"]!;
  const iso = (ms: number) => new Date(ms).toISOString();

  /** A render of Balance Transfer v2 by Coral on the web, at `at` (ms), unless the case says otherwise. */
  const render = (
    at: number,
    over: Partial<RecordedRender> = {},
  ): RecordedRender => ({
    at: iso(at),
    templateId: BT(),
    versionNumber: 2,
    consumerId: "coral",
    channel: "web",
    ...over,
  });

  function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  }
  async function dashboard(userId: string, teamId: string | null) {
    return h.services().usage.dashboard(await h.as(userId), { teamId });
  }
  async function template(userId: string, templateId: string) {
    return h.services().usage.template(await h.as(userId), { templateId });
  }

  describe("usage.dashboard", () => {
    it("counts renders in the 30 days up to the clock, the start included, and in the 30 before; nothing earlier and nothing after the clock", async () => {
      h.setClock(FAR);
      const t = FAR.getTime();
      await h.renders.record([
        render(t - 30 * DAY), // exactly 30 days back: in the current window
        render(t - 30 * DAY - 1), // a millisecond earlier: in the window before
        render(t - 60 * DAY), // the start of the window before
        render(t - 60 * DAY - 1), // before both
        render(t + 1), // after the clock
      ]);
      const facts = ok(await dashboard("maya", "t_coral"));
      expect(facts.asOf).toBe(FAR.toISOString());
      expect(facts.cells).toEqual([
        {
          templateId: BT(),
          consumerId: "coral",
          versionNumber: 2,
          channel: "web",
          platform: null,
          ok30: 1,
          err30: 0,
          prev: 2,
          lastAt: iso(t - 30 * DAY),
        },
      ]);
      // The day series reaches back past the two windows (every screen's day range), and stops at the clock.
      expect(facts.series.reduce((sum, s) => sum + s.count, 0)).toBe(4);
    });

    it("counts a failed render in its window as an error, apart from the renders that succeeded", async () => {
      h.setClock(FAR);
      const t = FAR.getTime();
      await h.renders.record([
        render(t - DAY),
        render(t - 2 * DAY, {
          outcome: "error",
          errorCode: "missing_variables",
        }),
        render(t - 40 * DAY, {
          outcome: "error",
          errorCode: "missing_variables",
        }),
      ]);
      const [cell] = ok(await dashboard("maya", "t_coral")).cells;
      expect(cell).toMatchObject({ ok30: 1, err30: 1, prev: 1 });
    });

    it("buckets renders by UTC day, whatever the business time zone says", async () => {
      // March 14 at 03:30 UTC is still the evening of March 13 in New York.
      h.setClock(new Date("2028-03-15T12:00:00.000Z"));
      await h.renders.record([
        render(Date.parse("2028-03-14T03:30:00.000Z")),
        render(Date.parse("2028-03-14T23:59:59.999Z")),
        render(Date.parse("2028-03-15T00:00:00.000Z")),
      ]);
      const facts = ok(await dashboard("maya", "t_coral"));
      const byDay = Object.fromEntries(
        facts.series.map((s) => [
          `${s.day}/${s.channel}/${s.outcome}`,
          s.count,
        ]),
      );
      expect(byDay).toEqual({
        "2028-03-14/web/ok": 2,
        "2028-03-15/web/ok": 1,
      });
      expect(facts.sparks.map((s) => [s.day, s.count]).sort()).toEqual([
        ["2028-03-14", 2],
        ["2028-03-15", 1],
      ]);
    });

    it("counts a push by the phone it was for, and a push logged without one apart", async () => {
      const alert = h.templates["payment-due-reminder"]!;
      h.setClock(FAR);
      const t = FAR.getTime();
      const push = (platform: "ios" | "android" | null) =>
        render(t - DAY, {
          templateId: alert,
          versionNumber: 1,
          channel: "push",
          platform,
        });
      await h.renders.record([
        push("ios"),
        push("ios"),
        push("android"),
        push(null),
      ]);
      const cells = ok(await dashboard("maya", "t_coral")).cells;
      expect(
        cells.map((c) => `${c.channel}/${c.platform}/${c.ok30}`).sort(),
      ).toEqual(["push/android/1", "push/ios/2", "push/null/1"]);
    });

    it("leaves out what isn't usage: previews, renders nobody asked for, and a caller refused as unregistered", async () => {
      h.setClock(FAR);
      const t = FAR.getTime() - DAY;
      await h.renders.record([
        render(t, { isPreview: true, consumerId: null }),
        render(t, { isPreview: true }),
        render(t, { consumerId: null }),
        render(t, { consumerId: null, outcome: "error" }),
        render(t, {
          consumerId: "corall",
          outcome: "error",
          errorCode: "unknown_consumer",
        }),
        render(t),
      ]);
      const facts = ok(await dashboard("maya", "t_coral"));
      expect(facts.cells).toHaveLength(1);
      expect(facts.cells[0]).toMatchObject({
        consumerId: "coral",
        ok30: 1,
        err30: 0,
      });
      expect(JSON.stringify(facts)).not.toContain("corall");
      expect(facts.series.reduce((sum, s) => sum + s.count, 0)).toBe(1);
    });

    it("counts a consumer that left the registry: its renders were accepted when they happened", async () => {
      h.setClock(FAR);
      await h.renders.record([
        render(FAR.getTime() - DAY, { consumerId: "ghost" }),
      ]);
      const facts = ok(await dashboard("maya", "t_coral"));
      expect(facts.cells.map((c) => c.consumerId)).toEqual(["ghost"]);
      expect(facts.consumers.map((c) => c.id)).toEqual(
        expect.arrayContaining(["coral", "deposits-online"]),
      );
      expect(facts.consumers.map((c) => c.id)).not.toContain("ghost");
    });

    it("counts a team's own templates only, and every team in All teams", async () => {
      h.setClock(FAR);
      const t = FAR.getTime() - DAY;
      await h.renders.record([
        render(t),
        render(t, {
          templateId: HYS(),
          versionNumber: 2,
          consumerId: "deposits-online",
        }),
      ]);
      const coral = ok(await dashboard("maya", "t_coral"));
      expect(coral.cells.map((c) => c.templateId)).toEqual([BT()]);
      expect(coral.templates.map((x) => x.teamId)).toEqual(
        Array(coral.templates.length).fill("t_coral"),
      );
      const deposits = ok(await dashboard("eli", "t_deposits"));
      expect(deposits.cells.map((c) => c.templateId)).toEqual([HYS()]);
      const all = ok(await dashboard("taylor", null));
      expect(all.cells.map((c) => c.templateId).sort()).toEqual(
        [BT(), HYS()].sort(),
      );
      expect(all.templates.map((x) => x.id).sort()).toEqual(
        Object.values(h.templates).sort(),
      );
    });

    it("names each template by its latest version and its team by id and slug", async () => {
      const facts = ok(await dashboard("maya", "t_coral"));
      expect(facts.templates.find((x) => x.id === BT())).toEqual({
        id: BT(),
        name: "Balance Transfer Intro — Terms",
        teamId: "t_coral",
        teamSlug: "coral-offers",
      });
    });

    it("gives each number once, as the version a consumer's number means, agreeing with the Versions read", async () => {
      const facts = ok(await dashboard("taylor", null));
      const keys = facts.versions.map((v) => `${v.templateId}#${v.number}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of [
        "balance-transfer",
        "high-yield-savings",
        "cash-back",
      ]) {
        const templateId = h.templates[key]!;
        const history = ok(
          await h
            .services()
            .versions.history(await h.as("taylor"), { templateId }),
        );
        for (const v of facts.versions.filter(
          (x) => x.templateId === templateId,
        )) {
          const head = history.versions.find(
            (x) => x.number === v.number && x.head,
          )!;
          expect(v, `${key} v${v.number}`).toMatchObject({
            state: head.state,
            activatedAt: head.activatedAt,
          });
          expect(v.sunset?.at ?? null).toBe(head.sunsetAt);
          expect(v.sunset?.day ?? null).toBe(head.sunsetDay);
        }
      }
      // High-Yield Savings v2 was sent back twice: the released row is the one a consumer's v2 means.
      expect(
        facts.versions.find((v) => v.templateId === HYS() && v.number === 2),
      ).toMatchObject({ state: "active" });
    });

    it("decides a sunset in the business time zone: the days away are counted there, and it passes at the instant", async () => {
      const sunsetAt = "2026-10-25T04:00:00.000Z"; // 00:00 Eastern on October 25
      const v1 = async () =>
        ok(await dashboard("maya", "t_coral")).versions.find(
          (v) => v.templateId === BT() && v.number === 1,
        )!;

      // 21:00 Eastern on October 23 is already October 24 in UTC: two days away, not one.
      h.setClock(new Date("2026-10-24T01:00:00.000Z"));
      expect((await v1()).sunset).toEqual({
        at: sunsetAt,
        day: "2026-10-25",
        passed: false,
        daysAway: 2,
      });
      // A millisecond before: still October 24 there, so tomorrow.
      h.setClock(new Date("2026-10-25T03:59:59.999Z"));
      expect((await v1()).sunset).toMatchObject({ passed: false, daysAway: 1 });
      // At the instant: passed, and today.
      h.setClock(new Date(sunsetAt));
      expect((await v1()).sunset).toMatchObject({ passed: true, daysAway: 0 });
    });

    it("follows a sunset the review commands set", async () => {
      const day = new Date(base.getTime() + 12 * DAY)
        .toISOString()
        .slice(0, 10);
      h.setClock(new Date(base.getTime() + 60_000));
      expect(
        await h.services().review.setSunset(await h.as("alex"), {
          templateId: BT(),
          versionNumber: 1,
          sunsetDay: day,
        }),
      ).toEqual({ ok: true, changed: true });
      const v1 = ok(await dashboard("maya", "t_coral")).versions.find(
        (v) => v.templateId === BT() && v.number === 1,
      )!;
      expect(v1.sunset).toMatchObject({ day, passed: false, daysAway: 12 });
    });

    it("refuses a space the viewer may not enter", async () => {
      for (const [user, teamId] of [
        ["eli", "t_coral"],
        ["maya", "t_deposits"],
        ["maya", null],
        ["morgan", "t_coral"],
      ] as const)
        expect(await dashboard(user, teamId), `${user} in ${teamId}`).toEqual({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.spaceUnavailable.code,
          reason: REQUEST_REFUSALS.spaceUnavailable.reason,
        });
    });
  });

  describe("usage.template", () => {
    it("counts a version's consumers over all time, including one that stopped rendering it", async () => {
      h.setClock(FAR);
      const t = FAR.getTime();
      await h.renders.record([
        render(t - DAY),
        // Rendered v1 once, 200 days ago: in no window, still one of v1's consumers.
        render(t - 200 * DAY, {
          versionNumber: 1,
          consumerId: "deposits-online",
        }),
      ]);
      const facts = ok(await template("maya", BT()));
      expect(facts.asOf).toBe(FAR.toISOString());
      expect(facts.template).toEqual({
        id: BT(),
        name: "Balance Transfer Intro — Terms",
        teamId: "t_coral",
        teamSlug: "coral-offers",
      });
      // All time: the seeded history is there too, but this render is the only one of Deposits Online's.
      expect(
        facts.cells.filter((c) => c.consumerId === "deposits-online"),
      ).toEqual([
        {
          templateId: BT(),
          consumerId: "deposits-online",
          versionNumber: 1,
          channel: "web",
          platform: null,
          ok30: 0,
          err30: 0,
          prev: 0,
          lastAt: iso(t - 200 * DAY),
        },
      ]);
      expect(
        facts.cells.find(
          (c) =>
            c.consumerId === "coral" &&
            c.versionNumber === 2 &&
            c.channel === "web",
        ),
      ).toMatchObject({ ok30: 1, err30: 0, prev: 0, lastAt: iso(t - DAY) });
      // The dashboard counts only the two windows.
      expect(
        ok(await dashboard("maya", "t_coral")).cells.map((c) => c.consumerId),
      ).toEqual(["coral"]);
    });

    it("counts per day and version, in UTC days", async () => {
      h.setClock(new Date("2028-03-15T12:00:00.000Z"));
      await h.renders.record([
        render(Date.parse("2028-03-14T03:30:00.000Z")),
        render(Date.parse("2028-03-14T04:00:00.000Z"), { versionNumber: 1 }),
        render(Date.parse("2028-03-15T00:00:00.000Z"), {
          outcome: "error",
          errorCode: "invalid_values",
        }),
      ]);
      const facts = ok(await template("maya", BT()));
      expect(
        facts.series
          .map((s) => `${s.day}/v${s.versionNumber}/${s.outcome}/${s.count}`)
          .sort(),
      ).toEqual([
        "2028-03-14/v1/ok/1",
        "2028-03-14/v2/ok/1",
        "2028-03-15/v2/error/1",
      ]);
    });

    it("lists the ten latest failures, newest first, and the later write first among failures at one instant", async () => {
      h.setClock(FAR);
      const t = FAR.getTime();
      const failure = (at: number, code: string) =>
        render(at, { outcome: "error", errorCode: code });
      await h.renders.record([
        // Twelve failures: the two oldest fall off the end. Three share an instant, written a, b, c.
        ...Array.from({ length: 9 }, (_, i) =>
          failure(t - (20 - i) * 60_000, "bad_request"),
        ),
        failure(t - 5 * 60_000, "missing_variables"),
        failure(t - 5 * 60_000, "invalid_values"),
        failure(t - 5 * 60_000, "render_failed"),
      ]);
      const { recentErrors } = ok(await template("maya", BT()));
      expect(recentErrors).toHaveLength(10);
      expect(recentErrors.slice(0, 3).map((e) => e.code)).toEqual([
        "render_failed",
        "invalid_values",
        "missing_variables",
      ]);
      expect(recentErrors.map((e) => e.at)).toEqual(
        [...recentErrors.map((e) => e.at)].sort().reverse(),
      );
      expect(recentErrors[0]).toEqual({
        at: iso(t - 5 * 60_000),
        consumerId: "coral",
        versionNumber: 2,
        channel: "web",
        platform: null,
        code: "render_failed",
      });
    });

    it("names the channels the template's content type allows", async () => {
      expect(ok(await template("maya", BT())).allowedChannels).toEqual([
        "pdf",
        "web",
        "email",
      ]);
      expect(
        ok(await template("maya", h.templates["payment-due-reminder"]!))
          .allowedChannels,
      ).toEqual(["push", "sms"]);
    });

    it("refuses a template that doesn't exist and one the viewer may not see, the same way", async () => {
      for (const [user, templateId] of [
        ["maya", "UC-ZZZZZZ"],
        ["eli", BT()],
        ["morgan", BT()],
      ] as const)
        expect(
          await template(user, templateId),
          `${user} ${templateId}`,
        ).toEqual({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.templateUnavailable.code,
          reason: REQUEST_REFUSALS.templateUnavailable.reason,
        });
    });
  });
}
