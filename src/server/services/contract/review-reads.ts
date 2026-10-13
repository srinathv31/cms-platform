import { describe, expect, it } from "vitest";
import { COMMENT_REFUSALS } from "@/domain/comments";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { QueueRow } from "../review-reads";
import type { ContractHarness } from "./harness";

// The review queue and the review screen, as every implementation must answer them (`ReviewService.queue`,
// `.badgeCount` and `.screen` in src/server/services/review.ts), read from the seed:
//   - Cash Back (Coral Offers): v3 in review on round 2 (submitted by Maya, breaking) after Jordan sent round 1
//     back; v2 Active and rendered by Coral; v1 Superseded;
//   - Card Used Abroad (an alert, Coral Offers): v1 in review, submitted by Priya;
//   - Annual Fee Waiver: v1 sent back by Jordan; Balance Transfer: v1 Superseded (sunset October 25), v2 Active;
//   - High-Yield Savings (Deposits): v2 Active, approved on round 3 after Naomi sent rounds 1 and 2 back.
// Jordan approves on Coral Offers, Maya and Priya write there, Sam views it; Eli is an Author on Deposits; Riley
// is a Platform Admin. A space is a team id (null: All teams). Refusals are compared by code.

const CORAL = "t_coral";
const DEPOSITS = "t_deposits";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY = 86_400_000;

/** A queue row as [template key's id, number, round]. */
const rounds = (rows: readonly QueueRow[]) =>
  rows.map((r) => [r.templateId, r.round.number, r.round.round]);

export function reviewReadsContract(h: ContractHarness, base: Date) {
  async function queueOf(userId: string, teamId: string | null) {
    const queue = await h.services().review.queue(await h.as(userId), {
      teamId,
    });
    if (!queue.ok) throw new Error(queue.code);
    return queue;
  }

  async function screenOf(
    userId: string,
    teamId: string | null,
    templateKey: string,
    versionNumber: number,
    round: number | null = null,
  ) {
    return h.services().review.screen(await h.as(userId), {
      teamId,
      templateId: h.templates[templateKey]!,
      versionNumber,
      round,
    });
  }

  async function openedBy(...args: Parameters<typeof screenOf>) {
    const screen = await screenOf(...args);
    if (!screen.ok) throw new Error(screen.code);
    return screen;
  }

  describe("review.queue", () => {
    it("Jordan waits on Cash Back v3 round 2 and the Card Used Abroad alert, and sees the recent decisions on Coral Offers", async () => {
      const queue = await queueOf("jordan", CORAL);
      expect(queue.asOf).toBe(base.toISOString());
      expect(rounds(queue.waiting)).toEqual(
        expect.arrayContaining([
          [h.templates["cash-back"], 3, 2],
          [h.templates["card-used-abroad"], 1, 1],
        ]),
      );
      expect(queue.waiting).toHaveLength(2);
      expect(
        queue.waiting.find((r) => r.templateId === h.templates["cash-back"]),
      ).toEqual({
        templateId: h.templates["cash-back"],
        templateName: "Cash Back Welcome Bonus — Terms",
        teamId: CORAL,
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        versionId: expect.any(String),
        round: { number: 3, round: 2, state: "in_review" },
        authorId: "maya",
        submittedAt: expect.stringMatching(ISO),
        stage: { position: 0, name: "Team approver", count: 1 },
        breaking: true,
      });
      expect(queue.submitted).toEqual([]);
      // Each round is a row: Cash Back v3's round 1, then the waiver's, each with its latest decision.
      expect(
        queue.decided.map((r) => [
          r.templateId,
          r.round.number,
          r.round.round,
          r.decision.kind,
          r.decision.by,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [h.templates["cash-back"], 3, 1, "changes_requested", "jordan"],
          [
            h.templates["annual-fee-waiver"],
            1,
            1,
            "changes_requested",
            "jordan",
          ],
        ]),
      );
      const decidedAt = queue.decided.map((r) => r.decision.at);
      expect(decidedAt).toEqual([...decidedAt].sort().reverse());
      expect(queue.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(["jordan", "maya", "priya"]),
      );
      expect(
        await h.services().review.badgeCount(await h.as("jordan"), {
          teamId: CORAL,
        }),
      ).toEqual({ ok: true, count: 2 });
    });

    it("what Maya submitted is hers to watch, not to decide; a viewer waits on nothing", async () => {
      const maya = await queueOf("maya", CORAL);
      expect(maya.waiting).toEqual([]);
      expect(rounds(maya.submitted)).toEqual([
        [h.templates["cash-back"], 3, 2],
      ]);
      expect(
        await h.services().review.badgeCount(await h.as("maya"), {
          teamId: CORAL,
        }),
      ).toEqual({ ok: true, count: 0 });
      expect((await queueOf("sam", CORAL)).waiting).toEqual([]);
    });

    it("a team's space lists only that team's rounds; All teams spans every team for a Platform Admin, who decides nothing", async () => {
      const deposits = await queueOf("eli", DEPOSITS);
      expect(
        [...deposits.waiting, ...deposits.submitted, ...deposits.decided].every(
          (r) => r.teamId === DEPOSITS,
        ),
      ).toBe(true);
      const all = await queueOf("riley", null);
      expect(all.waiting).toEqual([]);
      expect(all.decided.map((r) => r.templateId)).toEqual(
        expect.arrayContaining([
          h.templates["annual-fee-waiver"],
          h.templates["cash-back"],
        ]),
      );
    });

    it("counts recent decisions back from the backend's clock", async () => {
      h.setClock(new Date(base.getTime() + 60 * DAY));
      const later = await queueOf("jordan", CORAL);
      expect(later.asOf).toBe(
        new Date(base.getTime() + 60 * DAY).toISOString(),
      );
      expect(
        later.decided,
        "every seeded decision is older than 30 days",
      ).toEqual([]);
      expect(later.waiting).toHaveLength(2);
    });

    it("refuses a space the viewer may not enter (404 space_unavailable)", async () => {
      for (const [userId, teamId] of [
        ["eli", CORAL],
        ["maya", null],
      ] as const) {
        const ctx = await h.as(userId);
        expect(await h.services().review.queue(ctx, { teamId })).toMatchObject({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.spaceUnavailable.code,
        });
        expect(
          await h.services().review.badgeCount(ctx, { teamId }),
        ).toMatchObject({ ok: false, status: 404 });
      }
    });
  });

  describe("review.screen", () => {
    it("opens Cash Back v3 on its head, round 2, against the Active v2, with what Jordan may do", async () => {
      const screen = await openedBy("jordan", CORAL, "cash-back", 3);
      expect(screen.asOf).toBe(base.toISOString());
      expect(screen.template).toEqual({
        id: h.templates["cash-back"],
        teamId: CORAL,
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        family: "document",
      });
      expect(screen.version).toMatchObject({
        number: 3,
        round: 2,
        state: "in_review",
        name: "Cash Back Welcome Bonus — Terms",
        submittedBy: "maya",
        submittedAt: expect.stringMatching(ISO),
        contractChanges: [
          expect.objectContaining({ key: "annual_fee", breaking: true }),
        ],
        stages: [{ id: expect.any(String), name: "Team approver" }],
        currentStage: 0,
      });
      expect(screen.baseline).toMatchObject({ number: 2, state: "active" });
      expect(screen.previousNumber, "approving v3 replaces the Active v2").toBe(
        2,
      );
      expect(screen.stillRenders, "only with nothing Active").toBeNull();
      expect(screen.replacedBy, "round 2 is the head").toBeNull();
      expect(screen.liveName).toBe("Cash Back Welcome Bonus — Terms");
      expect(screen.can).toEqual({
        approve: { ok: true },
        requestChanges: { ok: true },
        comment: { ok: true },
      });
      expect(screen.sunsetCalendar).toEqual({
        zone: "America/New_York",
        today: "2026-10-04",
      });
      const v2 = screen.consumerUsage.find((u) => u.versionNumber === 2);
      expect(v2).toMatchObject({ consumerId: "coral" });
      expect(v2!.renders30d).toBeGreaterThan(0);
      // Previews never count: v3 has only previews.
      expect(screen.consumerUsage.some((u) => u.versionNumber === 3)).toBe(
        false,
      );
      expect(screen.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(["maya", "jordan"]),
      );
    });

    it("says why Maya, a viewer, or anyone on a decided version can't decide", async () => {
      expect((await openedBy("maya", CORAL, "cash-back", 3)).can).toMatchObject(
        {
          approve: { ok: false, code: REASONS.ownVersion.code },
          requestChanges: { ok: false, code: REASONS.ownVersion.code },
          comment: { ok: true },
        },
      );
      const viewer = await openedBy("sam", CORAL, "cash-back", 3);
      expect(viewer.can.approve).toMatchObject({
        ok: false,
        code: REASONS.generic.code,
      });
      expect(viewer.can.comment).toMatchObject({
        ok: false,
        code: REASONS.generic.code,
      });
      const active = await openedBy("jordan", CORAL, "cash-back", 2);
      expect(active.baseline, "the Active version is this one").toBeNull();
      expect(active.previousNumber).toBeNull();
      expect(active.can).toMatchObject({
        approve: { ok: false, code: REFUSALS.notInReview.code },
        comment: { ok: false, code: COMMENT_REFUSALS.closed.code },
      });
      expect(active.version.decisions).toEqual([
        expect.objectContaining({ kind: "approved", by: "jordan" }),
      ]);
    });

    it("opens a round by number: Cash Back v3's round 1 is the record Jordan sent back, and links on to round 2", async () => {
      const round1 = await openedBy("jordan", CORAL, "cash-back", 3, 1);
      expect(round1.version).toMatchObject({
        number: 3,
        round: 1,
        state: "changes_requested",
        decisions: [
          expect.objectContaining({ kind: "changes_requested", by: "jordan" }),
        ],
      });
      expect(round1.can.approve).toMatchObject({
        code: REFUSALS.notInReview.code,
      });
      expect(round1.replacedBy).toEqual({
        number: 3,
        round: 2,
        state: "in_review",
      });
      // Its change request, the thread about the whole version, is on its record.
      expect(
        round1.threads.map((t) => [t.blockId, t.origin?.round, t.status]),
      ).toEqual([[DOCUMENT_THREAD, 1, "resolved"]]);
      expect(
        (await openedBy("jordan", CORAL, "cash-back", 3, 2)).version.id,
      ).toBe((await openedBy("jordan", CORAL, "cash-back", 3)).version.id);
    });

    it("links High-Yield v2's sent-back rounds on to its release, compared with v1 they were drafted from", async () => {
      for (const round of [1, 2]) {
        const screen = await openedBy(
          "eli",
          DEPOSITS,
          "high-yield-savings",
          2,
          round,
        );
        expect(screen.replacedBy, `round ${round}`).toEqual({
          number: 2,
          round: 3,
          state: "active",
        });
        expect(screen.baseline, `round ${round}: vs v1`).toMatchObject({
          number: 1,
          state: "superseded",
        });
        expect(screen.previousNumber, "v2 is its own release").toBeNull();
        expect(screen.version.decisions).toEqual([
          expect.objectContaining({ kind: "changes_requested", by: "naomi" }),
        ]);
      }
      const release = await openedBy("eli", DEPOSITS, "high-yield-savings", 2);
      expect([
        release.version.round,
        release.replacedBy,
        release.baseline,
        release.previousNumber,
        release.liveName,
      ]).toEqual([3, null, null, null, null]);
    });

    it("carries a Superseded version's sunset day, and an alert's family and frozen SMS footer", async () => {
      const superseded = await openedBy("jordan", CORAL, "balance-transfer", 1);
      expect(superseded.version).toMatchObject({
        state: "superseded",
        sunsetDay: "2026-10-25",
        sunsetPassed: false,
      });
      expect(
        (await openedBy("jordan", CORAL, "balance-transfer", 2)).version
          .sunsetDay,
      ).toBeNull();
      const alert = await openedBy("jordan", CORAL, "card-used-abroad", 1);
      expect(alert.template.family).toBe("message");
      expect(alert.messageRules.smsFooter).toBe(alert.version.smsFooter);
    });

    it("is Not found (404 version_unavailable) for a round, a number or a template that doesn't exist, from another team's space, and for someone who can't see the team", async () => {
      for (const args of [
        ["jordan", CORAL, "cash-back", 3, 3],
        ["jordan", CORAL, "cash-back", 99, null],
        ["jordan", CORAL, "cash-back", 0, null],
        // Riley sees every team, but Cash Back v2 isn't Deposits'.
        ["riley", DEPOSITS, "cash-back", 2, null],
        ["eli", DEPOSITS, "cash-back", 3, null],
      ] as const) {
        const [userId, teamId, templateKey, number, round] = args;
        expect(
          await screenOf(userId, teamId, templateKey, number, round),
          args.join(" "),
        ).toMatchObject({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.versionUnavailable.code,
        });
      }
      expect(
        await h.services().review.screen(await h.as("jordan"), {
          teamId: CORAL,
          templateId: "UC-ZZZZZZ",
          versionNumber: 1,
          round: null,
        }),
      ).toMatchObject({ ok: false, status: 404 });
      expect(
        (await openedBy("riley", null, "cash-back", 3)).version.number,
      ).toBe(3);
    });

    it("refuses a space the viewer may not enter (404 space_unavailable)", async () => {
      for (const [userId, teamId] of [
        ["jordan", DEPOSITS],
        ["maya", null],
      ] as const)
        expect(
          await screenOf(userId, teamId, "cash-back", 3),
          `${userId} in ${teamId}`,
        ).toMatchObject({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.spaceUnavailable.code,
        });
    });
  });
}
