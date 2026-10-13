import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { COMMENT_REFUSALS } from "@/domain/comments";
import { diffVariables } from "@/domain/contract";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import { findRound } from "./find-round";
import { getViewer } from "@/server/viewer";
import { getActivity } from "./activity";
import { getReviewBadgeCount, getReviewQueue, getReviewScreen } from "./review";
import { anchorIdsOf } from "./review-shared";
import { getThreads, loadThreads } from "./threads";
import { getWorkspaceDocument } from "./workspace";

// The Phase 4 read models against a temporary database filled by the real seed:
//   - Cash Back v3 is In review on round 2 (submitted by Maya, breaking) after Jordan sent round 1 back
//     2.6 days ago; v2 Active and rendered by Coral;
//   - High-Yield Savings v2 is Active, approved on round 3 after Naomi sent rounds 1 and 2 back;
//   - Annual Fee Waiver v1 has Changes requested (Jordan, 3.9 days ago) and an open draft with threads;
//   - Balance Transfer v1 is Superseded with a sunset in 21 days, v2 Active, both rendered by Coral;
//   - Holiday Points v1 is Revoked.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-review-queries-");
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

const { commentThreads, contentTypes, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
const people: Record<string, Viewer> = {};
const ids = seededDatabasePerTest({ base: BASE });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
  for (const id of ["maya", "jordan", "alex", "sam", "riley", "eli", "priya"])
    people[id] = await loadPersona(db, id);
});

function as(userId: string) {
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
}

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ── Queue ─────────────────────────────────────────────────────

describe("getReviewQueue", () => {
  it("Jordan waits on Cash Back v3 round 2 and the Card Used Abroad alert, and sees Cash Back's round 1 and Annual Fee Waiver among the recent decisions", async () => {
    as("jordan");
    const queue = await getReviewQueue("coral-offers");
    // Newest submitted first: Cash Back v3 went in after the alert.
    expect(queue.waiting).toEqual([
      {
        templateId: ids["cash-back"],
        templateName: "Cash Back Welcome Bonus — Terms",
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        versionId: expect.any(String),
        versionNumber: 3,
        round: 2,
        state: "in_review",
        author: {
          id: "maya",
          name: "Maya Chen",
          initials: "MC",
          hue: expect.any(Number),
        },
        submittedAt: expect.stringMatching(ISO),
        stage: { position: 0, name: "Team approver", count: 1 },
        breaking: true,
      },
      {
        templateId: ids["card-used-abroad"],
        templateName: "Card Used Abroad",
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        versionId: expect.any(String),
        versionNumber: 1,
        round: 1,
        state: "in_review",
        author: {
          id: "priya",
          name: "Priya Raman",
          initials: "PR",
          hue: expect.any(Number),
        },
        submittedAt: expect.stringMatching(ISO),
        stage: { position: 0, name: "Team approver", count: 1 },
        breaking: false,
      },
    ]);
    expect(queue.submitted).toEqual([]);
    // Each round is a row: Cash Back v3's round 1, sent back 2.6 days ago, then the waiver's at 3.9.
    expect(queue.decided).toEqual([
      expect.objectContaining({
        templateId: ids["cash-back"],
        versionNumber: 3,
        round: 1,
        state: "changes_requested",
        breaking: true,
        decision: {
          kind: "changes_requested",
          by: expect.objectContaining({ id: "jordan" }),
          at: expect.stringMatching(ISO),
        },
      }),
      expect.objectContaining({
        templateId: ids["annual-fee-waiver"],
        versionNumber: 1,
        round: 1,
        state: "changes_requested",
        breaking: false,
        stage: { position: 0, name: "Team approver", count: 1 },
        decision: {
          kind: "changes_requested",
          by: expect.objectContaining({ id: "jordan" }),
          at: expect.stringMatching(ISO),
        },
      }),
    ]);
    expect(await getReviewBadgeCount("coral-offers")).toBe(2);
  });

  it("Maya submitted it: nothing waits on her", async () => {
    as("maya");
    const queue = await getReviewQueue("coral-offers");
    expect(queue.waiting).toEqual([]);
    expect(
      queue.submitted.map((r) => [r.templateId, r.versionNumber, r.round]),
    ).toEqual([[ids["cash-back"], 3, 2]]);
    expect(await getReviewBadgeCount("coral-offers")).toBe(0);
  });

  it("a viewer waits on nothing; another team's space lists only its own", async () => {
    as("sam");
    expect((await getReviewQueue("coral-offers")).waiting).toEqual([]);
    as("eli");
    const deposits = await getReviewQueue("deposits");
    expect(
      [...deposits.waiting, ...deposits.submitted, ...deposits.decided].every(
        (r) => r.teamSlug === "deposits",
      ),
    ).toBe(true);
  });

  it("All teams is open to a platform admin, who decides nothing", async () => {
    as("riley");
    const queue = await getReviewQueue("all");
    expect(queue.waiting).toEqual([]);
    expect(queue.decided.map((r) => r.templateId)).toContain(
      ids["annual-fee-waiver"],
    );
    expect(await getReviewBadgeCount("all")).toBe(0);
  });
});

// ── Review screen ─────────────────────────────────────────────

describe("getReviewScreen", () => {
  it("shows Cash Back v3 (its head, round 2) against the Active v2, with the stepper, the contract and Coral's usage", async () => {
    as("jordan");
    const screen = await getReviewScreen(
      "coral-offers",
      ids["cash-back"]!,
      3,
      null,
    );
    expect(screen.template).toEqual({
      id: ids["cash-back"],
      teamId: "t_coral",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
      family: "document",
    });
    expect(screen.version).toMatchObject({
      number: 3,
      round: 2,
      state: "in_review",
      name: "Cash Back Welcome Bonus — Terms",
      submittedBy: expect.objectContaining({ id: "maya" }),
      submittedAt: expect.stringMatching(ISO),
      contractLines: ["v3 adds required `annual_fee` (Currency)."],
    });
    expect(screen.baseline).toMatchObject({ number: 2, state: "active" });
    expect(screen.previousNumber, "approving v3 replaces the Active v2").toBe(
      2,
    );
    expect(screen.stillRenders, "only read with nothing Active").toBeNull();
    expect(screen.liveName).toBe("Cash Back Welcome Bonus — Terms");
    expect(screen.steps).toEqual([
      { position: 0, name: "Team approver", status: "current" },
    ]);
    expect(screen.can).toEqual({
      approve: { ok: true },
      requestChanges: { ok: true },
      comment: { ok: true },
    });
    expect(screen.today).toBe("2026-10-04");

    const v2 = screen.consumerUsage.find((u) => u.versionNumber === 2);
    expect(v2).toMatchObject({
      consumerId: "coral",
      consumerName: "Coral",
      lastRenderAt: expect.stringMatching(ISO),
    });
    expect(v2!.renders30d).toBeGreaterThan(0);
    // Previews never count: v3 has only previews.
    expect(screen.consumerUsage.some((u) => u.versionNumber === 3)).toBe(false);
  });

  it("explains why Maya, a viewer, or anyone on a decided version can't decide", async () => {
    as("maya");
    const own = await getReviewScreen(
      "coral-offers",
      ids["cash-back"]!,
      3,
      null,
    );
    expect(own.can).toEqual({
      approve: { ok: false, ...REASONS.ownVersion },
      requestChanges: { ok: false, ...REASONS.ownVersion },
      comment: { ok: true },
    });

    as("sam");
    const viewer = await getReviewScreen(
      "coral-offers",
      ids["cash-back"]!,
      3,
      null,
    );
    expect(viewer.can.approve).toEqual({ ok: false, ...REASONS.generic });
    expect(viewer.can.comment).toEqual({ ok: false, ...REASONS.generic });

    as("jordan");
    const active = await getReviewScreen(
      "coral-offers",
      ids["cash-back"]!,
      2,
      null,
    );
    expect(active.baseline).toBeNull(); // the Active version is this one
    expect(active.previousNumber).toBeNull();
    expect(active.can.approve).toEqual({ ok: false, ...REFUSALS.notInReview });
    // A decided version is a record: nobody comments on it, and the screen says why.
    expect(active.can.comment).toEqual({
      ok: false,
      ...COMMENT_REFUSALS.closed,
    });
    expect(active.steps).toEqual([
      expect.objectContaining({
        status: "done",
        decidedBy: expect.objectContaining({ id: "jordan" }),
      }),
    ]);
  });

  it("blocks Approve and Request changes, with why, for someone who wrote the version, and leaves it out of their queue", async () => {
    // Priya holds Author and Approver on Coral Offers (an access request can add the role) and edited
    // Maya's Cash Back v3 before Maya submitted it.
    const priya = await loadPersona(db, "priya");
    people.priyaApprover = {
      ...priya,
      memberships: priya.memberships.map((m) =>
        m.teamId === "t_coral" ? { ...m, roles: ["author", "approver"] } : m,
      ),
    };
    as("priyaApprover");
    const v3 = (await findRound(db, ids["cash-back"]!, 3))!;
    expect(
      (await getReviewQueue("coral-offers")).waiting.map(
        (r) => r.versionNumber,
      ),
      "an approver who wrote none of it",
    ).toEqual([3]);

    await db
      .update(versions)
      .set({ writers: ["maya", "priya"] })
      .where(eq(versions.id, v3.id));
    try {
      const screen = await getReviewScreen(
        "coral-offers",
        ids["cash-back"]!,
        3,
        null,
      );
      expect(screen.can).toEqual({
        approve: { ok: false, ...REASONS.wroteVersion },
        requestChanges: { ok: false, ...REASONS.wroteVersion },
        comment: { ok: true },
      });
      const queue = await getReviewQueue("coral-offers");
      expect(queue.waiting).toEqual([]);
      // What Priya submitted herself is hers to watch, not to decide: the Card Used Abroad alert.
      expect(
        queue.submitted.map((r) => [r.templateId, r.versionNumber]),
      ).toEqual([[ids["card-used-abroad"], 1]]);
      expect(await getReviewBadgeCount("coral-offers")).toBe(0);

      as("jordan");
      expect(
        (await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null)).can
          .approve,
      ).toEqual({ ok: true });
    } finally {
      await db
        .update(versions)
        .set({ writers: v3.writers })
        .where(eq(versions.id, v3.id));
    }
  });

  it("is a 404 from another team's space, for a missing version, or for someone who can't see the team", async () => {
    as("jordan");
    await expect(
      getReviewScreen("deposits", ids["cash-back"]!, 3, null),
    ).rejects.toThrow();
    await expect(
      getReviewScreen("coral-offers", ids["cash-back"]!, 99, null),
    ).rejects.toThrow(NOT_FOUND);
    await expect(
      getReviewScreen("coral-offers", "UC-ZZZZZZ", 1, null),
    ).rejects.toThrow(NOT_FOUND);
    await expect(
      getReviewScreen("coral-offers", ids["cash-back"]!, 3, 3),
      "a round that doesn't exist",
    ).rejects.toThrow(NOT_FOUND);
    as("riley");
    await expect(
      getReviewScreen("all", ids["cash-back"]!, 3, null),
    ).resolves.toMatchObject({ version: { number: 3 } });
  });

  it("opens a round by `?round=`: Cash Back v3's round 1 is the record Jordan sent back", async () => {
    as("jordan");
    const round1 = await getReviewScreen(
      "coral-offers",
      ids["cash-back"]!,
      3,
      1,
    );
    expect(round1.version).toMatchObject({
      number: 3,
      round: 1,
      state: "changes_requested",
    });
    expect(round1.can.approve).toEqual({ ok: false, ...REFUSALS.notInReview });
    expect(round1.steps).toEqual([
      expect.objectContaining({
        status: "returned",
        decidedBy: expect.objectContaining({ id: "jordan" }),
      }),
    ]);
    // Its change request, the thread about the whole version, is on its record.
    expect(
      round1.threads.map((t) => [t.blockId, t.originLabel, t.status]),
    ).toEqual([[DOCUMENT_THREAD, "v3 · Round 1", "resolved"]]);
    expect(
      (await getReviewScreen("coral-offers", ids["cash-back"]!, 3, 2)).version
        .id,
    ).toBe(
      (await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null))
        .version.id,
    );
  });

  it("links a sent-back round on to where its work went: the next round, the release, or nothing while only a draft follows", async () => {
    as("jordan");
    const cashBack = ids["cash-back"]!;
    expect(
      (await getReviewScreen("coral-offers", cashBack, 3, 1)).replacedBy,
      "round 2 is in review",
    ).toEqual({
      number: 3,
      round: 2,
      state: "in_review",
      label: "v3, round 2",
    });
    expect(
      (await getReviewScreen("coral-offers", cashBack, 3, null)).replacedBy,
      "round 2 is the head",
    ).toBeNull();
    // Annual Fee Waiver v1 was sent back, and Maya hasn't resubmitted: her draft has no number yet.
    const waiver = await getReviewScreen(
      "coral-offers",
      ids["annual-fee-waiver"]!,
      1,
      null,
    );
    expect([waiver.version.state, waiver.replacedBy]).toEqual([
      "changes_requested",
      null,
    ]);

    // High-Yield Savings v2 was approved on round 3: its sent-back rounds link to v2, its bare page.
    as("eli");
    const highYield = ids["high-yield-savings"]!;
    for (const round of [1, 2]) {
      const screen = await getReviewScreen("deposits", highYield, 2, round);
      expect(screen.replacedBy, `round ${round}`).toEqual({
        number: 2,
        round: 3,
        state: "active",
        label: "v2",
      });
      expect(screen.steps, "the stepper says who sent it back").toEqual([
        expect.objectContaining({
          status: "returned",
          decidedBy: expect.objectContaining({ id: "naomi" }),
          decidedAt: expect.stringMatching(ISO),
        }),
      ]);
    }
    expect(
      (await getReviewScreen("deposits", highYield, 2, null)).replacedBy,
      "the release itself",
    ).toBeNull();
  });

  it("compares a round sent back before its number went live with the version it was drafted from, not its own release", async () => {
    // High-Yield Savings: v1 Superseded, v2 approved on round 3 after two send-backs.
    as("eli");
    const highYield = ids["high-yield-savings"]!;
    const v1 = (await db.query.versions.findFirst({
      where: and(eq(versions.templateId, highYield), eq(versions.number, 1)),
    }))!;
    await db
      .update(versions)
      .set({ name: "High-Yield Savings — 2025 Rates" })
      .where(eq(versions.id, v1.id));
    try {
      for (const round of [1, 2]) {
        const screen = await getReviewScreen("deposits", highYield, 2, round);
        expect(screen.version).toMatchObject({
          number: 2,
          round,
          state: "changes_requested",
        });
        expect(screen.baseline, `round ${round}: vs v1`).toMatchObject({
          id: v1.id,
          number: 1,
          state: "superseded",
        });
        expect(
          screen.previousNumber,
          "it would replace nothing: v2 is its own release",
        ).toBeNull();
        expect(screen.liveName, "renamed from what it was drafted from").toBe(
          "High-Yield Savings — 2025 Rates",
        );
      }
      // The release itself is the live version: nothing to compare it with.
      const live = await getReviewScreen("deposits", highYield, 2, null);
      expect([
        live.version.round,
        live.baseline,
        live.previousNumber,
        live.liveName,
      ]).toEqual([3, null, null, null]);
    } finally {
      await db
        .update(versions)
        .set({ name: v1.name })
        .where(eq(versions.id, v1.id));
    }
  });

  it("shows a rename against what still renders when the Active version was revoked, and none on the live version itself", async () => {
    as("jordan");
    const versionOf = (number: number) =>
      and(
        eq(versions.templateId, ids["cash-back"]!),
        eq(versions.number, number),
      );
    const [v1, v2] = await Promise.all(
      [1, 2].map((n) =>
        db.query.versions.findFirst({ where: versionOf(n) }).then((v) => v!),
      ),
    );
    const revoke = {
      reason: "Test",
      startedBy: "jordan",
      startedAt: BASE.toISOString(),
      confirmedBy: "alex",
      confirmedAt: BASE.toISOString(),
    };
    await db
      .update(versions)
      .set({ name: "Cash Back Welcome Bonus — 2025 Terms" })
      .where(versionOf(1));
    await db
      .update(versions)
      .set({ state: "revoked", revoke })
      .where(versionOf(2));
    try {
      const screen = await getReviewScreen(
        "coral-offers",
        ids["cash-back"]!,
        3,
        null,
      );
      expect(screen.liveName, "v1 still renders").toBe(
        "Cash Back Welcome Bonus — 2025 Terms",
      );
    } finally {
      await db
        .update(versions)
        .set({ state: v2.state, revoke: v2.revoke })
        .where(versionOf(2));
      await db.update(versions).set({ name: v1.name }).where(versionOf(1));
    }
    expect(
      (await getReviewScreen("coral-offers", ids["cash-back"]!, 2, null))
        .liveName,
      "v2 is the live one",
    ).toBeNull();
  });

  describe("the redline's baseline when nothing is Active", () => {
    // The walk goes back through the round sent back to the revoked version (decision 0031).
    // Cash Back: v1 Superseded (it still renders), v2 Active, v3 In review on round 2, based on round 1 (sent
    // back), based on v2. Each test revokes v2.
    const versionOf = (number: number, round = 1) =>
      and(
        eq(versions.templateId, ids["cash-back"]!),
        eq(versions.number, number),
        eq(versions.round, round),
      );
    const revoke = {
      reason: "Test",
      startedBy: "jordan",
      startedAt: BASE.toISOString(),
      confirmedBy: "alex",
      confirmedAt: BASE.toISOString(),
    };

    async function withV2Revoked(
      change: () => Promise<unknown>,
      check: () => Promise<void>,
    ) {
      const [v1, v2, v3] = await Promise.all(
        [versionOf(1), versionOf(2), versionOf(3, 2)].map((where) =>
          db.query.versions.findFirst({ where }).then((v) => v!),
        ),
      );
      await db
        .update(versions)
        .set({ state: "revoked", revoke })
        .where(versionOf(2));
      try {
        await change();
        await check();
      } finally {
        await db
          .update(versions)
          .set({ state: v1.state, sunsetAt: v1.sunsetAt })
          .where(versionOf(1));
        await db
          .update(versions)
          .set({ state: v2.state, revoke: v2.revoke })
          .where(versionOf(2));
        await db
          .update(versions)
          .set({ basedOnVersionId: v3.basedOnVersionId })
          .where(versionOf(3, 2));
      }
    }

    it("is the revoked version the correction started from, with its state; Approve still replaces nothing", async () => {
      as("jordan");
      const v2 = (await db.query.versions.findFirst({ where: versionOf(2) }))!;
      await withV2Revoked(
        async () => {},
        async () => {
          const screen = await getReviewScreen(
            "coral-offers",
            ids["cash-back"]!,
            3,
            null,
          );
          expect(screen.baseline).toEqual({
            id: v2.id,
            number: 2,
            state: "revoked",
            body: v2.body,
            variables: v2.variables,
            channels: v2.channels,
            channelFields: v2.channelFields,
            smsFooter: null,
          });
          expect(
            screen.previousNumber,
            "nothing is Active: the Approve dialog's previous version stays null",
          ).toBeNull();
          // N3: what consumers move from is the newest version that still renders, so the dialog names its consumers.
          // Against v1, which also lacks the optional offer_end_date that v2 added (submit compared with v2).
          expect(screen.stillRenders).toEqual({
            number: 1,
            sunsetDay: null,
            contractChanges: [
              {
                kind: "added",
                key: "offer_end_date",
                breaking: false,
                type: "date",
                required: false,
              },
              {
                kind: "added",
                key: "annual_fee",
                breaking: true,
                type: "currency",
                required: true,
              },
            ],
          });
        },
      );
    });

    // N3: v3 was submitted while v2 was Active, so the changes stored on it are against v2. v2 was revoked
    // during review, so what v1's consumers (who keep rendering) have to map is v3 against v1.
    it("works out the contract changes against the version that still renders, not the one Active at submit", async () => {
      as("jordan");
      const [v1, v3] = await Promise.all(
        [versionOf(1), versionOf(3, 2)].map((where) =>
          db.query.versions.findFirst({ where }).then((v) => v!),
        ),
      );
      const stored = [
        {
          kind: "added",
          key: "annual_fee",
          breaking: true,
          type: "currency",
          required: true,
        },
      ];
      expect(v3.contractChanges, "stored at submit, against v2").toEqual(
        stored,
      );

      await withV2Revoked(
        async () => {},
        async () => {
          // As seeded, v1 lacks the optional offer_end_date that v2 added: v3 against v1 has it too, and what
          // submit stored (against v2) doesn't.
          const seeded = await getReviewScreen(
            "coral-offers",
            ids["cash-back"]!,
            3,
            null,
          );
          expect(seeded.stillRenders?.contractChanges).toEqual(
            diffVariables(v1.variables, v3.variables),
          );
          expect(
            seeded.stillRenders?.contractChanges.map((c) => c.key),
          ).toEqual(["offer_end_date", "annual_fee"]);
          expect(
            seeded.version.contractChanges,
            "the submit record is unchanged",
          ).toEqual(stored);

          // v1 already had annual_fee as a required variable: v1's consumers have nothing new to map, though
          // what submit stored (against v2) still says annual_fee was added. The stored changes stay as the
          // submit record; the Approve dialog reads the ones against v1.
          await db
            .update(versions)
            .set({ variables: v3.variables })
            .where(versionOf(1));
          try {
            const screen = await getReviewScreen(
              "coral-offers",
              ids["cash-back"]!,
              3,
              null,
            );
            expect(screen.stillRenders).toEqual({
              number: 1,
              sunsetDay: null,
              contractChanges: [],
            });
            expect(screen.version.contractChanges).toEqual(stored);
          } finally {
            await db
              .update(versions)
              .set({ variables: v1.variables })
              .where(versionOf(1));
          }
        },
      );
    });

    it("falls back to the newest version that still renders when the based-on version is missing, then to none", async () => {
      as("jordan");
      const v1 = (await db.query.versions.findFirst({ where: versionOf(1) }))!;
      await withV2Revoked(
        () =>
          db
            .update(versions)
            .set({ basedOnVersionId: null })
            .where(versionOf(3, 2)),
        async () => {
          const screen = await getReviewScreen(
            "coral-offers",
            ids["cash-back"]!,
            3,
            null,
          );
          expect(screen.baseline).toMatchObject({
            id: v1.id,
            number: 1,
            state: "superseded",
          });
          expect(screen.previousNumber).toBeNull();

          const later = new Date(BASE.getTime() + 40 * 86_400_000);
          await db
            .update(versions)
            .set({ sunsetAt: later })
            .where(versionOf(1));
          expect(
            (await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null))
              .stillRenders,
            "with its own sunset day",
          ).toMatchObject({
            number: 1,
            sunsetDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          });

          // v1's sunset passes too: nothing renders, so nothing to compare with, as for a first version.
          await db
            .update(versions)
            .set({ sunsetAt: new Date(BASE.getTime() - 1000) })
            .where(versionOf(1));
          expect(
            (await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null))
              .baseline,
          ).toBeNull();
          expect(
            (await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null))
              .stillRenders,
            "nothing renders: a first version",
          ).toBeNull();
        },
      );
    });
  });
});

// ── Activity ──────────────────────────────────────────────────

describe("getActivity", () => {
  it("lists the template's audit events newest first, as sentences, with the draft edits", async () => {
    as("sam");
    const items = await getActivity("coral-offers", ids["balance-transfer"]!);
    const times = items.map((i) => i.at);
    expect(times).toEqual([...times].sort().reverse());
    expect(items.at(-1)).toMatchObject({
      action: "template.created",
      versionLabel: null,
    });
    expect(items.some((i) => i.action === "draft.edited")).toBe(true);
    const sunset = items.find((i) => i.action === "version.sunset_set")!;
    expect(sunset).toMatchObject({
      actor: expect.objectContaining({ id: "jordan" }),
      versionLabel: "v1",
    });
    expect(sunset.summary).toMatch(/^Jordan Ellis set v1 to sunset on /);
    const activated = items.find(
      (i) => i.action === "version.activated" && i.versionLabel === "v2",
    )!;
    expect(activated.actor).toEqual(expect.objectContaining({ id: "jordan" }));
    expect(activated.summary).toBe(
      "Jordan Ellis approved v2, making it Active.",
    );
    const superseded = items.find(
      (i) => i.action === "version.superseded" && i.versionLabel === "v1",
    )!;
    expect(superseded.summary).toBe("v1 was superseded by v2.");
  });
});

// ── Threads ───────────────────────────────────────────────────

describe("threads", () => {
  it("shows the Annual Fee Waiver threads on the open draft: the change request first, then by block", async () => {
    as("maya");
    const threads = await getThreads("coral-offers", ids["annual-fee-waiver"]!);
    expect(threads).toHaveLength(2);
    expect(
      threads.every((t) => !t.orphaned && t.originVersionNumber === 1),
    ).toBe(true);
    const resolved = threads.find((t) => t.status === "resolved")!;
    expect(resolved).toMatchObject({
      quote: "after your first year",
      resolvedBy: expect.objectContaining({ id: "maya" }),
      resolvedAt: expect.stringMatching(ISO),
    });
    expect(resolved.comments.map((c) => c.author.id)).toEqual([
      "jordan",
      "maya",
    ]);
    // The change request that sent v1 back: about the whole version, open until the draft is submitted.
    const open = threads.find((t) => t.status === "open")!;
    expect(threads[0]).toBe(open);
    expect(open).toMatchObject({ blockId: DOCUMENT_THREAD, quote: null });
    expect(open.resolvedBy).toBeUndefined();
    expect(open.comments[0]).toMatchObject({
      kind: "change_request",
      createdAt: expect.stringMatching(ISO),
    });

    // The workspace carries the same threads for the editor margin, on a draft that takes comments.
    const document = await getWorkspaceDocument(
      "coral-offers",
      ids["annual-fee-waiver"]!,
    );
    expect(document.threads).toEqual(threads);
    expect(document.can.comment).toEqual({ ok: true });
  });

  it("lists the document thread first and orphaned threads last", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    const v1 = (await db.query.versions.findFirst({
      where: and(eq(versions.templateId, templateId), eq(versions.number, 1)),
    }))!;
    const rows = [
      {
        id: "th_test_gone",
        blockId: "b_gone00",
        createdAt: new Date(BASE.getTime() - 1000),
      },
      { id: "th_test_doc", blockId: DOCUMENT_THREAD, createdAt: BASE },
    ];
    await db.insert(commentThreads).values(
      rows.map((r) => ({
        ...r,
        templateId,
        originVersionId: v1.id,
        quote: null,
        status: "open" as const,
      })),
    );
    try {
      as("jordan");
      const threads = await getThreads("coral-offers", templateId, v1.id);
      // Document threads oldest first (the seeded change request, then this one), then by block.
      expect(
        threads.map((t) => [
          t.id.startsWith("th_test")
            ? t.id
            : t.blockId === DOCUMENT_THREAD
              ? "seeded doc"
              : "seeded",
          t.orphaned,
        ]),
      ).toEqual([
        ["seeded doc", false],
        ["th_test_doc", false],
        ["seeded", false],
        ["th_test_gone", true],
      ]);
      await expect(
        getThreads("coral-offers", templateId, "v_not_this_templates"),
      ).rejects.toThrow(NOT_FOUND);
    } finally {
      await db.delete(commentThreads).where(
        inArray(
          commentThreads.id,
          rows.map((r) => r.id),
        ),
      );
    }
  });
});

// ── A frozen version shows the threads that began by it ───────

describe("threads on a submitted version", () => {
  const stamp = (n: number) => new Date(BASE.getTime() - n * 1000);

  /** The draft (null), or a number's round: the given one, else its head. */
  async function versionId(
    templateId: string,
    number: number | null,
    round?: number,
  ) {
    const row =
      number === null
        ? await db.query.versions.findFirst({
            where: and(
              eq(versions.templateId, templateId),
              eq(versions.state, "draft"),
            ),
          })
        : await findRound(db, templateId, number, round);
    return row!.id;
  }

  async function addThreads(
    templateId: string,
    rows: { id: string; origin: string }[],
  ) {
    await db.insert(commentThreads).values(
      rows.map((r, i) => ({
        id: r.id,
        templateId,
        originVersionId: r.origin,
        blockId: DOCUMENT_THREAD,
        quote: null,
        status: "open" as const,
        createdAt: stamp(i),
      })),
    );
    return () =>
      db.delete(commentThreads).where(
        inArray(
          commentThreads.id,
          rows.map((r) => r.id),
        ),
      );
  }

  const mine = (threads: { id: string }[]) =>
    threads
      .map((t) => t.id)
      .filter((id) => id.startsWith("th_f3a"))
      .sort();

  it("v2's record leaves out a thread that began in v3's review (and the screen of v3 has both)", async () => {
    const templateId = ids["cash-back"]!;
    const cleanup = await addThreads(templateId, [
      { id: "th_f3a_v1", origin: await versionId(templateId, 1) },
      { id: "th_f3a_v3", origin: await versionId(templateId, 3) },
    ]);
    try {
      as("jordan");
      const screen = async (n: number) =>
        (await getReviewScreen("coral-offers", templateId, n, null)).threads;
      expect(mine(await screen(1))).toEqual(["th_f3a_v1"]);
      expect(mine(await screen(2))).toEqual(["th_f3a_v1"]);
      expect(mine(await screen(3))).toEqual(["th_f3a_v1", "th_f3a_v3"]);
      // Without a version, everything on the template (the editor's margin).
      const v3 = (await db.query.versions.findFirst({
        where: eq(versions.id, await versionId(templateId, 3)),
      }))!;
      expect(mine(await loadThreads(templateId, anchorIdsOf(v3)))).toEqual([
        "th_f3a_v1",
        "th_f3a_v3",
      ]);
      // By id: the same rule.
      expect(
        mine(
          await getThreads(
            "coral-offers",
            templateId,
            await versionId(templateId, 2),
          ),
        ),
      ).toEqual(["th_f3a_v1"]);
    } finally {
      await cleanup();
    }
  });

  it("a thread that began in the open draft counts as the next round (v1 round 2): not on round 1's record, but in the draft's margin", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    const draft = await versionId(templateId, null);
    const cleanup = await addThreads(templateId, [
      { id: "th_f3a_draft", origin: draft },
      { id: "th_f3a_v1", origin: await versionId(templateId, 1) },
    ]);
    try {
      as("jordan");
      expect(
        mine(
          (await getReviewScreen("coral-offers", templateId, 1, null)).threads,
        ),
      ).toEqual(["th_f3a_v1"]);
      expect(
        mine(
          await getThreads(
            "coral-offers",
            templateId,
            await versionId(templateId, 1),
          ),
        ),
      ).toEqual(["th_f3a_v1"]);
      // The draft itself, and the workspace's default (the open draft), show them all.
      expect(mine(await getThreads("coral-offers", templateId, draft))).toEqual(
        ["th_f3a_draft", "th_f3a_v1"],
      );
      expect(mine(await getThreads("coral-offers", templateId))).toEqual([
        "th_f3a_draft",
        "th_f3a_v1",
      ]);
    } finally {
      await cleanup();
    }
  });
});

describe("threads across the rounds of one number", () => {
  it("round 2's screen shows round 1's threads; round 1's record leaves out the ones begun in round 2", async () => {
    const templateId = ids["cash-back"]!;
    const [round1, round2] = await Promise.all([
      findRound(db, templateId, 3, 1),
      findRound(db, templateId, 3, 2),
    ]);
    const rows = [
      { id: "th_rounds_r1", origin: round1!.id },
      { id: "th_rounds_r2", origin: round2!.id },
    ];
    await db.insert(commentThreads).values(
      rows.map((r) => ({
        id: r.id,
        templateId,
        originVersionId: r.origin,
        blockId: DOCUMENT_THREAD,
        quote: null,
        status: "open" as const,
        createdAt: BASE,
      })),
    );
    try {
      as("jordan");
      const ours = (threads: { id: string }[]) =>
        threads
          .map((t) => t.id)
          .filter((id) => id.startsWith("th_rounds"))
          .sort();
      expect(
        ours((await getReviewScreen("coral-offers", templateId, 3, 1)).threads),
      ).toEqual(["th_rounds_r1"]);
      const onRound2 = (await getReviewScreen("coral-offers", templateId, 3, 2))
        .threads;
      expect(ours(onRound2)).toEqual(["th_rounds_r1", "th_rounds_r2"]);
      expect(
        onRound2
          .filter((t) => t.id.startsWith("th_rounds"))
          .map((t) => [t.originRound, t.originLabel]),
      ).toEqual(
        expect.arrayContaining([
          [1, "v3 · Round 1"],
          [2, "v3 · Round 2"],
        ]),
      );
    } finally {
      await db.delete(commentThreads).where(
        inArray(
          commentThreads.id,
          rows.map((r) => r.id),
        ),
      );
    }
  });
});

describe("the review screen's version", () => {
  it("carries the sunset day of a Superseded version (and null without one)", async () => {
    as("jordan");
    const superseded = await getReviewScreen(
      "coral-offers",
      ids["balance-transfer"]!,
      1,
      null,
    );
    expect(superseded.version.state).toBe("superseded");
    expect(superseded.version.sunsetDay).toBe("2026-10-25");
    expect(superseded.sunsetCalendar).toEqual({
      zone: "America/New_York",
      today: "2026-10-04",
    });
    const active = await getReviewScreen(
      "coral-offers",
      ids["balance-transfer"]!,
      2,
      null,
    );
    expect(active.version.sunsetDay).toBeNull();
  });
});

describe("the workspace's comment permission", () => {
  it("lets the team's authors and approvers comment on an open draft, not its viewers", async () => {
    as("maya");
    expect(
      (await getWorkspaceDocument("coral-offers", ids["annual-fee-waiver"]!))
        .can.comment,
    ).toEqual({ ok: true });
    as("sam");
    expect(
      (await getWorkspaceDocument("coral-offers", ids["annual-fee-waiver"]!))
        .can.comment,
    ).toEqual({
      ok: false,
      ...REASONS.generic,
    });
  });

  it("lets nobody comment on a template whose latest version has been decided", async () => {
    as("maya");
    const document = await getWorkspaceDocument(
      "coral-offers",
      ids["rate-change-notice"]!,
    );
    expect(document.versionNumber).toBe(1);
    expect(document.can.comment).toEqual({
      ok: false,
      ...COMMENT_REFUSALS.closed,
    });
  });
});

describe("an alert's family", () => {
  it("comes from its content type, even when its version's channels were emptied", async () => {
    const templateId = ids["card-used-abroad"]!;
    const where = and(
      eq(versions.templateId, templateId),
      eq(versions.number, 1),
    );
    const { channels } = (await db.query.versions.findFirst({ where }))!;
    await db.update(versions).set({ channels: [] }).where(where);
    try {
      as("jordan");
      expect(
        (await getReviewScreen("coral-offers", templateId, 1, null)).template
          .family,
      ).toBe("message");
    } finally {
      await db.update(versions).set({ channels }).where(where);
    }
  });
});

describe("an alert's SMS footer", () => {
  it("is the one frozen into the version at submit, for the preview and the fields, whatever the content type's is now", async () => {
    const templateId = ids["card-used-abroad"]!;
    const frozen = "Coral: Reply STOP to opt out, HELP for help.";
    await db
      .update(contentTypes)
      .set({ smsFooter: "Coral: Text STOP to end." })
      .where(eq(contentTypes.id, "ct_alert"));
    try {
      as("jordan");
      const screen = await getReviewScreen("coral-offers", templateId, 1, null);
      expect(screen.version.smsFooter).toBe(frozen);
      expect(screen.messageRules.smsFooter).toBe(frozen);
    } finally {
      await db
        .update(contentTypes)
        .set({ smsFooter: frozen })
        .where(eq(contentTypes.id, "ct_alert"));
    }
  });
});

describe("an alert's threads, on its fields", () => {
  it("lists a thread on a field in the fields' order, not as orphaned, on the review screen and in the workspace", async () => {
    const templateId = ids["card-used-abroad"]!;
    const v1 = (await db.query.versions.findFirst({
      where: and(eq(versions.templateId, templateId), eq(versions.number, 1)),
    }))!;
    const rows = [
      { id: "th_alert_sms", blockId: "sms.text" },
      { id: "th_alert_title", blockId: "push.title" },
    ].map((r, i) => ({
      ...r,
      templateId,
      originVersionId: v1.id,
      createdAt: new Date(BASE.getTime() - i * 1000),
    }));
    await db.insert(commentThreads).values(rows);
    try {
      as("jordan");
      const threads = (
        await getReviewScreen("coral-offers", templateId, 1, null)
      ).threads.filter((t) => t.id.startsWith("th_alert"));
      expect(threads.map((t) => [t.id, t.orphaned])).toEqual([
        ["th_alert_title", false],
        ["th_alert_sms", false],
      ]);
      as("priya");
      const margin = (
        await getWorkspaceDocument("coral-offers", templateId)
      ).threads.filter((t) => t.id.startsWith("th_alert"));
      expect(margin.map((t) => t.orphaned)).toEqual([false, false]);
    } finally {
      await db.delete(commentThreads).where(
        inArray(
          commentThreads.id,
          rows.map((r) => r.id),
        ),
      );
    }
  });
});
