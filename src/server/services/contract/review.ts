import { describe, expect, it } from "vitest";
import { sunsetInstant } from "@/domain/business-zone";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import type { Changed } from "../types";
import type { ContractHarness } from "./harness";

// The review lifecycle's behaviour, as every implementation must show it (ReviewService in
// src/server/services/review.ts). Cases act through the services, from the seed: Balance Transfer v1 is
// Superseded (submitted by Priya, sunset on October 25) under an Active v2, Cash Back v1 is Superseded with no
// sunset, and Coral renders both templates. Alex and Jordan approve on Coral Offers; Maya is an author there.
//
// Each case sets the backend's clock, then compares what the reads show before and after the command. A refusal
// is checked by its code: the sentence is the BFF's.

const DAY = 86_400_000;
const EASTERN = "America/New_York";
const CORAL = "coral";

/** YYYY-MM-DD, `days` after `at` in UTC. */
const dayAfter = (at: Date, days: number) =>
  new Date(at.getTime() + days * DAY).toISOString().slice(0, 10);

/** The rows of `after` that `before` didn't have (the reads answer in write order). */
const added = <T>(before: readonly T[], after: readonly T[]) =>
  after.slice(before.length);

export function reviewContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);

  /** A version as the Versions read shows it now (the number's head). */
  async function versionOf(templateId: string, number = 1) {
    const history = await h
      .services()
      .versions.history(await h.as("jordan"), { templateId });
    if (!history.ok) throw new Error(history.code);
    return {
      history,
      version: history.versions.find((v) => v.number === number && v.head)!,
    };
  }

  /** What a command can have written about a template's v1: its audit rows, Coral's notices, Priya's notifications. */
  async function written(templateId: string) {
    const { version } = await versionOf(templateId);
    const bell = await h
      .services()
      .notifications.list(await h.as("priya"), { limit: 100 });
    if (!bell.ok) throw new Error(bell.code);
    return {
      audit: await auditOf(templateId, version.id),
      notices: await h.consumerNotices(CORAL, templateId),
      priya: bell.items,
    };
  }

  /** The audit rows about one version, oldest first, as the template's Activity tab reads them. */
  async function auditOf(templateId: string, versionId: string) {
    const activity = await h
      .services()
      .audit.activity(await h.as("jordan"), { templateId });
    if (!activity.ok) throw new Error(activity.code);
    return activity.events
      .filter((e) => e.versionId === versionId)
      .reverse()
      .map(({ action, at, actorId, details }) => ({
        action,
        at,
        actorId,
        templateId,
        versionId,
        details,
      }));
  }

  /** The notifications in `after` that `before` didn't have (the bell lists newest first). */
  const told = <T extends { id: string }>(
    before: readonly T[],
    after: readonly T[],
  ) => after.filter((n) => !before.some((b) => b.id === n.id));

  describe("review.setSunset", () => {
    it("moves a Superseded version's sunset to 00:00 in the business time zone, dates it by the backend's clock, and tells Coral and the author", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const day = dayAfter(base, 30);
      const instant = sunsetInstant(day, EASTERN).toISOString();
      const before = await written(templateId);
      h.setClock(minute(1));
      expect(
        await h.services().review.setSunset(await h.as("alex"), {
          templateId,
          versionNumber: 1,
          sunsetDay: day,
        }),
      ).toEqual({ ok: true, changed: true });

      const { history, version } = await versionOf(templateId);
      expect(history.asOf).toBe(minute(1).toISOString());
      expect(version).toMatchObject({
        sunsetDay: day,
        sunsetAt: instant,
        sunsetPassed: false,
      });
      const after = await written(templateId);
      expect(added(before.audit, after.audit)).toEqual([
        {
          action: "version.sunset_set",
          at: minute(1).toISOString(),
          actorId: "alex",
          templateId,
          versionId: version.id,
          details: expect.objectContaining({
            number: 1,
            sunsetAt: instant,
            sunsetDay: day,
            zone: EASTERN,
          }),
        },
      ]);
      expect(added(before.notices, after.notices)).toEqual([
        expect.objectContaining({
          kind: "sunset_scheduled",
          createdAt: minute(1).toISOString(),
          template: expect.objectContaining({ id: templateId }),
          versionNumber: 1,
          activeVersion: 2,
          sunsetAt: instant,
          sunsetDay: day,
          zone: EASTERN,
        }),
      ]);
      // Facts and a link placed by the team's id: the words and the href are the BFF's (decision 0055).
      expect(told(before.priya, after.priya)).toEqual([
        {
          id: expect.any(String),
          kind: "sunset_scheduled",
          facts: {
            templateName: history.template.name,
            number: 1,
            sunsetAt: instant,
            sunsetDay: day,
            zone: EASTERN,
          },
          link: {
            to: "versions",
            teamId: history.template.teamId,
            templateId,
          },
          body: null,
          createdAt: minute(1).toISOString(),
          readAt: null,
        },
      ]);
    });

    it("writes nothing for the day the version already has (a double click)", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const input = {
        templateId,
        versionNumber: 1,
        sunsetDay: dayAfter(base, 30),
      };
      h.setClock(minute(1));
      await h.services().review.setSunset(await h.as("alex"), input);
      const before = await written(templateId);
      h.setClock(minute(2));
      expect(
        await h.services().review.setSunset(await h.as("alex"), input),
      ).toEqual({ ok: true, changed: false });
      expect(await written(templateId)).toEqual(before);
    });

    it("writes once when the same day is set twice at the same moment", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const input = {
        templateId,
        versionNumber: 1,
        sunsetDay: dayAfter(base, 30),
      };
      const before = await written(templateId);
      h.setClock(minute(1));
      const ctx = await h.as("alex");
      const answers = await Promise.all([
        h.services().review.setSunset(ctx, input),
        h.services().review.setSunset(ctx, input),
      ]);
      expect(answers).toEqual(
        expect.arrayContaining([
          { ok: true, changed: true },
          { ok: true, changed: false },
        ]),
      );
      const after = await written(templateId);
      expect(added(before.audit, after.audit)).toHaveLength(1);
      expect(added(before.notices, after.notices)).toHaveLength(1);
    });

    it("refuses version_changed, and writes nothing, when the version changes between the command's read and its write", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const before = await written(templateId);
      h.setClock(minute(1));
      h.hooks({ beforeCompareAndSet: () => "competing_write" });
      expect(
        await h.services().review.setSunset(await h.as("alex"), {
          templateId,
          versionNumber: 1,
          sunsetDay: dayAfter(base, 30),
        }),
      ).toMatchObject({
        ok: false,
        code: REQUEST_REFUSALS.versionChanged.code,
      });
      h.hooks({});
      expect(await written(templateId)).toEqual(before);
      expect((await versionOf(templateId)).version.sunsetDay).toBe(
        "2026-10-25",
      );
    });

    it("numbers consumer notices in the order the commands committed", async () => {
      const balance = h.templates["balance-transfer"]!;
      const cashBack = h.templates["cash-back"]!;
      const before = await h.consumerNotices(CORAL);
      for (const [i, templateId] of [cashBack, balance, cashBack].entries()) {
        h.setClock(minute(i + 1));
        expect(
          await h.services().review.setSunset(await h.as("alex"), {
            templateId,
            versionNumber: 1,
            sunsetDay: dayAfter(base, 30 + i),
          }),
        ).toEqual({ ok: true, changed: true });
      }
      const after = await h.consumerNotices(CORAL);
      expect(
        added(before, after).map((n) => [n.template.id, n.createdAt]),
      ).toEqual([
        [cashBack, minute(1).toISOString()],
        [balance, minute(2).toISOString()],
        [cashBack, minute(3).toISOString()],
      ]);
    });

    it("reads 'after today' in the business time zone: at 23:30 Eastern the next day is still after today", async () => {
      const templateId = h.templates["balance-transfer"]!;
      // 23:30 EDT on October 4; already the 5th in UTC.
      h.setClock(new Date("2026-10-05T03:30:00.000Z"));
      const alex = await h.as("alex");
      expect(
        await h.services().review.setSunset(alex, {
          templateId,
          versionNumber: 1,
          sunsetDay: "2026-10-04",
        }),
      ).toMatchObject({ ok: false, code: REFUSALS.sunsetAfterToday.code });
      expect(
        await h.services().review.setSunset(alex, {
          templateId,
          versionNumber: 1,
          sunsetDay: "2026-10-05",
        }),
      ).toEqual({ ok: true, changed: true });
      expect((await versionOf(templateId)).version.sunsetAt).toBe(
        "2026-10-05T04:00:00.000Z",
      );
    });

    it("refuses with the codes the interface lists, in its order, and writes nothing", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const day = dayAfter(base, 40);
      const before = await written(templateId);
      h.setClock(minute(1));
      const jordan = await h.as("jordan");
      const maya = await h.as("maya");
      const { review } = h.services();
      const codeOf = async (answer: Promise<ActionResult<Changed>>) => {
        const result = await answer;
        return result.ok ? "ok" : result.code;
      };
      expect(
        await codeOf(
          review.setSunset(jordan, {
            templateId,
            versionNumber: 2,
            sunsetDay: day,
          }),
        ),
      ).toBe(REFUSALS.sunsetNotSuperseded.code);
      expect(
        await codeOf(
          review.setSunset(jordan, {
            templateId,
            versionNumber: 1,
            sunsetDay: "2026-01-01",
          }),
        ),
      ).toBe(REFUSALS.sunsetAfterToday.code);
      expect(
        await codeOf(
          review.setSunset(jordan, {
            templateId,
            versionNumber: 1,
            sunsetDay: "soon",
          }),
        ),
      ).toBe(REQUEST_REFUSALS.invalidDate.code);
      // The permission comes first: an author is refused whatever the day, and a version or a template that
      // doesn't exist reads the same as one the viewer may not act on.
      expect(
        await codeOf(
          review.setSunset(maya, {
            templateId,
            versionNumber: 1,
            sunsetDay: "soon",
          }),
        ),
      ).toBe(REASONS.generic.code);
      expect(
        await codeOf(
          review.setSunset(jordan, {
            templateId,
            versionNumber: 9,
            sunsetDay: day,
          }),
        ),
      ).toBe(REASONS.generic.code);
      expect(
        await codeOf(
          review.setSunset(jordan, {
            templateId: "UC-000000",
            versionNumber: 1,
            sunsetDay: day,
          }),
        ),
      ).toBe(REASONS.generic.code);
      expect(await written(templateId)).toEqual(before);
    });

    it("refuses any day once the sunset has passed, the one it has included", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const day = dayAfter(base, 1);
      h.setClock(minute(1));
      expect(
        await h.services().review.setSunset(await h.as("jordan"), {
          templateId,
          versionNumber: 1,
          sunsetDay: day,
        }),
      ).toEqual({ ok: true, changed: true });

      // At the sunset's instant renders stop, and the date is final (decision 0002).
      h.setClock(sunsetInstant(day, EASTERN));
      const before = await written(templateId);
      for (const sunsetDay of [day, dayAfter(base, 40)])
        expect(
          await h.services().review.setSunset(await h.as("jordan"), {
            templateId,
            versionNumber: 1,
            sunsetDay,
          }),
        ).toMatchObject({ ok: false, code: REFUSALS.sunsetPassed.code });
      expect(await written(templateId)).toEqual(before);
      expect((await versionOf(templateId)).version).toMatchObject({
        sunsetDay: day,
        sunsetPassed: true,
      });
    });
  });

  describe("the scheduled jobs", () => {
    it("record a passed sunset once, dated at the sunset, and tell Coral when they run", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const day = dayAfter(base, 1);
      const sunset = sunsetInstant(day, EASTERN);
      h.setClock(minute(1));
      await h.services().review.setSunset(await h.as("jordan"), {
        templateId,
        versionNumber: 1,
        sunsetDay: day,
      });
      const before = await written(templateId);
      const run = new Date(sunset.getTime() + 3_600_000);
      await h.runScheduledJobs(run);
      const after = await written(templateId);
      expect(added(before.audit, after.audit)).toEqual([
        expect.objectContaining({
          action: "version.sunset_passed",
          at: sunset.toISOString(),
          actorId: null,
        }),
      ]);
      expect(added(before.notices, after.notices)).toEqual([
        expect.objectContaining({
          kind: "sunset_passed",
          createdAt: run.toISOString(),
          sunsetAt: sunset.toISOString(),
          sunsetDay: day,
          activeVersion: 2,
        }),
      ]);
      // Once: a second run writes nothing.
      await h.runScheduledJobs(new Date(run.getTime() + 3_600_000));
      expect(await written(templateId)).toEqual(after);
    });
  });
}
