import { describe, expect, it } from "vitest";
import { sunsetInstant } from "@/domain/business-zone";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ContractHarness } from "./harness";

// The review lifecycle's behaviour, as every implementation must show it (ReviewService in
// src/server/services/review.ts). Cases act through the services, from the seed: Balance Transfer v1 is
// Superseded (submitted by Priya, sunset 21 days out) under an Active v2, Cash Back v1 is Superseded with no
// sunset, and Coral renders both templates. Alex and Jordan approve on Coral Offers; Maya is an author there.

const DAY = 86_400_000;
const EASTERN = "America/New_York";

/** YYYY-MM-DD, `days` after `at` in UTC. */
const dayAfter = (at: Date, days: number) =>
  new Date(at.getTime() + days * DAY).toISOString().slice(0, 10);

export function reviewContract(h: ContractHarness, base: Date) {
  const later = (minutes: number) =>
    new Date(base.getTime() + minutes * 60_000);

  describe("review.setSunset", () => {
    it("moves a Superseded version's sunset to 00:00 in the business time zone, tells Coral, and tells the author", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const at = later(1);
      const day = dayAfter(at, 30);
      const ctx = await h.as("alex", at);
      expect(
        await h.services().review.setSunset(ctx, {
          templateId,
          versionNumber: 1,
          sunsetDay: day,
        }),
      ).toEqual({ ok: true, changed: true });

      const history = await h.services().versions.history(ctx, { templateId });
      if (!history.ok) throw new Error(history.code);
      const v1 = history.versions.find((v) => v.number === 1)!;
      expect(v1).toMatchObject({
        sunsetDay: day,
        sunsetAt: sunsetInstant(day, EASTERN).toISOString(),
        sunsetPassed: false,
      });

      const audit = (await h.probe.auditEvents({ versionId: v1.id })).filter(
        (e) => e.at === at.toISOString(),
      );
      expect(audit).toEqual([
        {
          action: "version.sunset_set",
          at: at.toISOString(),
          actorId: "alex",
          teamId: history.template.teamId,
          templateId,
          versionId: v1.id,
          details: expect.objectContaining({
            number: 1,
            sunsetAt: sunsetInstant(day, EASTERN).toISOString(),
            sunsetDay: day,
            zone: EASTERN,
          }),
        },
      ]);
      const notices = (await h.probe.consumerNotices({ templateId })).filter(
        (n) => n.createdAt === at.toISOString(),
      );
      expect(notices).toEqual([
        expect.objectContaining({
          consumerId: "coral",
          versionId: v1.id,
          kind: "sunset_scheduled",
          payload: expect.objectContaining({
            versionNumber: 1,
            activeVersion: 2,
            sunsetAt: sunsetInstant(day, EASTERN).toISOString(),
            sunsetDay: day,
            zone: EASTERN,
          }),
        }),
      ]);
      expect(
        (await h.probe.notifications({ userId: "priya" })).filter(
          (n) => n.createdAt === at.toISOString(),
        ),
      ).toEqual([
        expect.objectContaining({
          kind: "sunset_scheduled",
          href: `/${history.template.teamSlug}/templates/${templateId}/versions`,
        }),
      ]);
    });

    it("writes nothing for the day the version already has (a double click)", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const day = dayAfter(base, 30);
      const first = await h.as("alex", later(1));
      await h.services().review.setSunset(first, {
        templateId,
        versionNumber: 1,
        sunsetDay: day,
      });
      const again = await h.as("alex", later(2));
      expect(
        await h.services().review.setSunset(again, {
          templateId,
          versionNumber: 1,
          sunsetDay: day,
        }),
      ).toEqual({ ok: true, changed: false });
      const v1Id = (await sunsetVersion(templateId, again)).id;
      expect(
        (await h.probe.auditEvents({ versionId: v1Id })).filter(
          (e) => e.at === later(2).toISOString(),
        ),
      ).toEqual([]);
      expect(
        (await h.probe.consumerNotices({ templateId })).filter(
          (n) => n.createdAt === later(2).toISOString(),
        ),
      ).toEqual([]);
    });

    it("writes once when the same day is set twice at the same moment", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const day = dayAfter(base, 30);
      const ctx = await h.as("alex", later(1));
      const input = { templateId, versionNumber: 1, sunsetDay: day };
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
      const v1Id = (await sunsetVersion(templateId, ctx)).id;
      expect(
        (await h.probe.auditEvents({ versionId: v1Id })).filter(
          (e) =>
            e.action === "version.sunset_set" && e.at === ctx.now.toISOString(),
        ),
      ).toHaveLength(1);
      expect(
        (await h.probe.consumerNotices({ templateId })).filter(
          (n) => n.createdAt === ctx.now.toISOString(),
        ),
      ).toHaveLength(1);
    });

    it("numbers consumer notices in the order the commands committed", async () => {
      const balance = h.templates["balance-transfer"]!;
      const cashBack = h.templates["cash-back"]!;
      const before = Math.max(
        0,
        ...(await h.probe.consumerNotices({ templateId: balance })).map(
          (n) => n.seq,
        ),
        ...(await h.probe.consumerNotices({ templateId: cashBack })).map(
          (n) => n.seq,
        ),
      );
      for (const [i, templateId] of [cashBack, balance, cashBack].entries()) {
        const ctx = await h.as("alex", later(i + 1));
        expect(
          await h.services().review.setSunset(ctx, {
            templateId,
            versionNumber: 1,
            sunsetDay: dayAfter(base, 30 + i),
          }),
        ).toEqual({ ok: true, changed: true });
      }
      const written = [
        ...(await h.probe.consumerNotices({ templateId: balance })),
        ...(await h.probe.consumerNotices({ templateId: cashBack })),
      ]
        .filter((n) => n.seq > before)
        .sort((a, b) => a.seq - b.seq);
      expect(written.map((n) => [n.templateId, n.createdAt])).toEqual([
        [cashBack, later(1).toISOString()],
        [balance, later(2).toISOString()],
        [cashBack, later(3).toISOString()],
      ]);
      // No number is skipped or reused: each notice takes the next one.
      expect(written.map((n) => n.seq - before)).toEqual([1, 2, 3]);
    });

    it("reads 'after today' in the business time zone: at 23:30 Eastern the next day is still after today", async () => {
      const templateId = h.templates["balance-transfer"]!;
      // 23:30 EDT on October 4; already the 5th in UTC.
      const ctx = await h.as("alex", new Date("2026-10-05T03:30:00.000Z"));
      expect(
        await h.services().review.setSunset(ctx, {
          templateId,
          versionNumber: 1,
          sunsetDay: "2026-10-04",
        }),
      ).toEqual({ ok: false, ...REFUSALS.sunsetAfterToday });
      expect(
        await h.services().review.setSunset(ctx, {
          templateId,
          versionNumber: 1,
          sunsetDay: "2026-10-05",
        }),
      ).toEqual({ ok: true, changed: true });
      expect((await sunsetVersion(templateId, ctx)).sunsetAt).toBe(
        "2026-10-05T04:00:00.000Z",
      );
    });

    it("refuses with the codes the interface lists, in its order, and writes nothing", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const at = later(1);
      const day = dayAfter(at, 40);
      const jordan = await h.as("jordan", at);
      const maya = await h.as("maya", at);
      const { review } = h.services();
      expect(
        await review.setSunset(jordan, {
          templateId,
          versionNumber: 2,
          sunsetDay: day,
        }),
      ).toEqual({ ok: false, ...REFUSALS.sunsetNotSuperseded });
      expect(
        await review.setSunset(jordan, {
          templateId,
          versionNumber: 1,
          sunsetDay: "2026-01-01",
        }),
      ).toEqual({ ok: false, ...REFUSALS.sunsetAfterToday });
      expect(
        await review.setSunset(jordan, {
          templateId,
          versionNumber: 1,
          sunsetDay: "soon",
        }),
      ).toEqual({ ok: false, ...REQUEST_REFUSALS.invalidDate });
      // The permission comes first: an author is refused whatever the day, and a version or a template
      // that doesn't exist reads the same as one the viewer may not act on.
      expect(
        await review.setSunset(maya, {
          templateId,
          versionNumber: 1,
          sunsetDay: "soon",
        }),
      ).toEqual({ ok: false, ...REASONS.generic });
      expect(
        await review.setSunset(jordan, {
          templateId,
          versionNumber: 9,
          sunsetDay: day,
        }),
      ).toEqual({ ok: false, ...REASONS.generic });
      expect(
        await review.setSunset(jordan, {
          templateId: "UC-000000",
          versionNumber: 1,
          sunsetDay: day,
        }),
      ).toEqual({ ok: false, ...REASONS.generic });

      const v1 = await sunsetVersion(templateId, jordan);
      expect(
        (await h.probe.auditEvents({ versionId: v1.id })).filter(
          (e) => e.at === at.toISOString(),
        ),
      ).toEqual([]);
      expect(
        (await h.probe.consumerNotices({ templateId })).filter(
          (n) => n.createdAt === at.toISOString(),
        ),
      ).toEqual([]);
    });

    it("refuses any day once the sunset has passed, the one it has included", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const day = dayAfter(base, 1);
      const set = await h.as("jordan", later(1));
      expect(
        await h.services().review.setSunset(set, {
          templateId,
          versionNumber: 1,
          sunsetDay: day,
        }),
      ).toEqual({ ok: true, changed: true });

      // At the sunset's instant, renders stop and the date is final (decision 0002).
      const passed = await h.as("jordan", sunsetInstant(day, EASTERN));
      for (const sunsetDay of [day, dayAfter(base, 40)])
        expect(
          await h.services().review.setSunset(passed, {
            templateId,
            versionNumber: 1,
            sunsetDay,
          }),
        ).toEqual({ ok: false, ...REFUSALS.sunsetPassed });
      const v1 = await sunsetVersion(templateId, passed);
      expect(v1).toMatchObject({ sunsetDay: day, sunsetPassed: true });
      expect(
        (await h.probe.auditEvents({ versionId: v1.id })).filter(
          (e) => e.at === passed.now.toISOString(),
        ),
      ).toEqual([]);
    });
  });

  /** Balance Transfer's (or any template's) v1, as the Versions read shows it now. */
  async function sunsetVersion(
    templateId: string,
    ctx: Awaited<ReturnType<ContractHarness["as"]>>,
  ) {
    const history = await h.services().versions.history(ctx, { templateId });
    if (!history.ok) throw new Error(history.code);
    return history.versions.find((v) => v.number === 1 && v.head)!;
  }
}
