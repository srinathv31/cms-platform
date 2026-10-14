import { describe, expect, it } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ContractHarness } from "./harness";

// A template's Activity, as every implementation must answer it (`AuditService.activity` in
// src/server/services/audit.ts), read from the seed. Balance Transfer (Coral Offers): v1 Superseded, sunset set by
// Jordan for October 25, v2 Active (approved by Jordan); draft edits along the way. Alex and Jordan approve on Coral
// Offers; Sam views it; Eli is on Deposits only. Refusals are compared by code.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function activityContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);
  const dayAfter = (days: number) =>
    new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);

  async function activityOf(templateId: string, userId = "sam") {
    const activity = await h
      .services()
      .audit.activity(await h.as(userId), { templateId });
    if (!activity.ok) throw new Error(activity.code);
    return activity;
  }

  describe("audit.activity", () => {
    it("lists Balance Transfer's audit events newest first, with who did each and the version it is about as that row is now", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const activity = await activityOf(templateId);
      expect(activity.asOf).toBe(base.toISOString());
      expect(activity.template).toEqual({ id: templateId, teamId: "t_coral" });
      const times = activity.events.map((e) => e.at);
      expect(times.every((t) => ISO.test(t))).toBe(true);
      expect(times).toEqual([...times].sort().reverse());
      expect(activity.events.at(-1)).toMatchObject({
        action: "template.created",
        version: null,
      });
      expect(activity.events.some((e) => e.action === "draft.edited")).toBe(
        true,
      );
      expect(
        activity.events.find((e) => e.action === "version.sunset_set"),
      ).toMatchObject({
        actorId: "jordan",
        version: { number: 1, round: 1, state: "superseded" },
        details: expect.objectContaining({ sunsetDay: "2026-10-25" }),
      });
      expect(
        activity.events.find(
          (e) => e.action === "version.activated" && e.version?.number === 2,
        ),
      ).toMatchObject({
        actorId: "jordan",
        version: { number: 2, round: 1, state: "active" },
      });
      expect(activity.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(["jordan", "priya"]),
      );
    });

    it("shows a command's audit row first, dated by the backend's clock; same-moment rows newest-written first", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const before = await activityOf(templateId);
      h.setClock(minute(1));
      const ctx = await h.as("alex");
      for (const days of [30, 31])
        expect(
          await h.services().review.setSunset(ctx, {
            templateId,
            versionNumber: 1,
            sunsetDay: dayAfter(days),
          }),
        ).toEqual({ ok: true, changed: true });

      const after = await activityOf(templateId);
      expect(after.asOf).toBe(minute(1).toISOString());
      const added = after.events.filter(
        (e) => !before.events.some((b) => b.id === e.id),
      );
      expect(added.map((e) => [e.action, e.at, e.actorId])).toEqual([
        ["version.sunset_set", minute(1).toISOString(), "alex"],
        ["version.sunset_set", minute(1).toISOString(), "alex"],
      ]);
      expect(after.events.slice(0, 2).map((e) => e.details.sunsetDay)).toEqual([
        dayAfter(31),
        dayAfter(30),
      ]);
      expect(after.people.map((p) => p.id)).toContain("alex");
    });

    it("refuses a template the viewer can't see as one that doesn't exist (404 template_unavailable)", async () => {
      const templateId = h.templates["balance-transfer"]!;
      for (const [userId, id] of [
        ["eli", templateId],
        ["sam", "UC-ZZZZZZ"],
      ] as const)
        expect(
          await h
            .services()
            .audit.activity(await h.as(userId), { templateId: id }),
        ).toMatchObject({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.templateUnavailable.code,
        });
    });
  });
}
