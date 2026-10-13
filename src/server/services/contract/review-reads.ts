import { describe, expect, it } from "vitest";
import { sunsetInstant } from "@/domain/business-zone";
import { COMMENT_REFUSALS } from "@/domain/comments";
import { diffVariables } from "@/domain/contract";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { diffChannelFields } from "@/domain/redline/channel-fields";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { OutputKey } from "@/domain/review-outputs";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { DraftPatch, JSONContent } from "@/domain/types";
import type { QueueRow } from "../review-reads";
import { seededAccess } from "./access";
import type { ContractHarness } from "./harness";

// The review queue and the review screen, as every implementation must answer them (`ReviewService.queue`,
// `.badgeCount` and `.screen` in src/server/services/review.ts), read from the seed:
//   - Cash Back (Coral Offers): v3 in review on round 2 (submitted by Maya, breaking) after Jordan sent round 1
//     back; v2 Active and rendered by Coral; v1 Superseded with no sunset;
//   - Card Used Abroad (an alert, Coral Offers): v1 in review, submitted by Priya;
//   - Annual Fee Waiver: v1 sent back by Jordan, and Maya's open draft; Balance Transfer: v1 Superseded (sunset
//     October 25), v2 Active, with a thread begun on v2;
//   - High-Yield Savings (Deposits): v2 Active, approved on round 3 after Naomi sent rounds 1 and 2 back.
// Jordan and Alex approve on Coral Offers (Alex is its Team Admin), Maya and Priya write there, Sam views it; Eli
// is an Author on Deposits; Riley is a Platform Admin. A space is a team id (null: All teams). A case that makes a
// state the seed lacks makes it through the commands, each at its own minute of the backend's clock, then reads.
// Refusals are compared by code.

const CORAL = "t_coral";
const DEPOSITS = "t_deposits";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY = 86_400_000;
const EASTERN = "America/New_York";
const DOCUMENT_OUTPUTS: readonly OutputKey[] = ["pdf", "web"];
const ALERT_OUTPUTS: readonly OutputKey[] = ["push.ios", "push.android", "sms"];

/** A queue row as [template key's id, number, round]. */
const rounds = (rows: readonly QueueRow[]) =>
  rows.map((r) => [r.templateId, r.round.number, r.round.round]);

/** A stored-form one-line field of a message. */
const line = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** The id of the top-level block of a document whose text has `text` in it. */
const blockWith = (body: JSONContent, text: string) =>
  String(
    body.content?.find((block) => JSON.stringify(block).includes(text))?.attrs
      ?.id,
  );

export function reviewReadsContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);
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

  // The commands a case makes its state with. Each must be answered `ok`.

  /** The template's workspace document (its open draft, else its latest round), as the Auditor reads it. */
  async function documentOf(templateId: string) {
    const document = await h
      .services()
      .templates.workspaceDocument(await h.as("taylor"), { templateId });
    if (!document.ok) throw new Error(document.code);
    return document;
  }

  /** A number's head (its released row, else its latest round), as the Versions tab lists it to the Auditor. */
  async function rowOf(templateId: string, number: number) {
    const history = await h
      .services()
      .versions.history(await h.as("taylor"), { templateId });
    if (!history.ok) throw new Error(history.code);
    return history.versions.find((v) => v.number === number && v.head)!;
  }

  /** A version's content, as Compare reads it. */
  async function contentOf(templateId: string, versionId: string) {
    const pair = await h.services().versions.compare(await h.as("taylor"), {
      templateId,
      from: versionId,
      to: versionId,
    });
    if (!pair.ok) throw new Error(pair.code);
    return pair.to;
  }

  /** A command's answer, which must be ok. */
  async function ok<T extends { ok: true } | { ok: false; code: string }>(
    answer: Promise<T>,
  ): Promise<Extract<T, { ok: true }>> {
    const result = await answer;
    if (!result.ok) throw new Error(`refused: ${result.code}`);
    return result as Extract<T, { ok: true }>;
  }

  /** Edit as `userId`: opens a draft of the template. */
  const edit = async (userId: string, templateId: string) =>
    ok(h.services().templates.startDraft(await h.as(userId), { templateId }));

  /** Saves the template's open draft as `userId`, from the rev the workspace shows. */
  async function save(
    userId: string,
    templateId: string,
    patch: Omit<DraftPatch, "rev" | "sessionKey">,
  ) {
    const { version } = await documentOf(templateId);
    await ok(
      h.services().drafts.save(await h.as(userId), {
        versionId: version.id,
        patch: {
          rev: version.rev,
          sessionKey: "session-review-reads-01",
          ...patch,
        },
      }),
    );
  }

  /** Submits the template's draft as `userId`, with the rev of the summary they read. */
  async function submit(userId: string, templateId: string) {
    const ctx = await h.as(userId);
    const summary = await h
      .services()
      .review.submitSummary(ctx, { templateId });
    if (!summary.ok) throw new Error(summary.code);
    return ok(
      h.services().review.submit(ctx, { templateId, rev: summary.rev }),
    );
  }

  /** Approves a round as `userId`, having viewed every output of its channels. */
  const approve = async (
    userId: string,
    templateId: string,
    versionNumber: number,
    round: number,
    outputsViewed = DOCUMENT_OUTPUTS,
  ) =>
    ok(
      h.services().review.approve(await h.as(userId), {
        templateId,
        versionNumber,
        round,
        outputsViewed,
        sampleSetsSeen: [],
      }),
    );

  /** Sends a round back as Jordan. */
  const sendBack = async (
    templateId: string,
    versionNumber: number,
    round: number,
  ) =>
    ok(
      h.services().review.requestChanges(await h.as("jordan"), {
        templateId,
        versionNumber,
        round,
        reason: "Say when the fee starts.",
      }),
    );

  /** Revokes a version: Jordan starts it at `at`, Alex confirms it a minute later. */
  async function revoke(templateId: string, versionNumber: number, at: Date) {
    h.setClock(at);
    await ok(
      h.services().review.startRevoke(await h.as("jordan"), {
        templateId,
        versionNumber,
        reason: "Wrong APR in the legal notices.",
      }),
    );
    h.setClock(new Date(at.getTime() + 60_000));
    await ok(
      h.services().review.confirmRevoke(await h.as("alex"), {
        templateId,
        versionNumber,
      }),
    );
  }

  /** Starts a thread on a block (or a field) of a version as `userId`; its id. */
  async function comment(
    userId: string,
    templateId: string,
    versionId: string,
    blockId: string,
  ) {
    const added = await h.services().comments.add(await h.as(userId), {
      templateId,
      versionId,
      blockId,
      body: "Is this still right?",
    });
    if (!added.ok) throw new Error(`the comment was refused: ${added.code}`);
    return added.threadId;
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

  describe("an approver who wrote part of a round", () => {
    it("is blocked from deciding it, with why, and doesn't wait on it in the queue", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      // Alex, the Team Admin, makes Priya an Approver beside her Author role (an access request can add it too).
      h.setClock(minute(1));
      expect(
        await h.services().access.changeRoles(await h.as("alex"), {
          membershipId: seededAccess().membership("priya"),
          roles: ["author", "approver"],
        }),
      ).toEqual({ ok: true, changed: true });
      const before = await queueOf("priya", CORAL);
      expect(rounds(before.waiting), "a round she wrote none of").toEqual([
        [h.templates["cash-back"], 3, 2],
      ]);

      // Priya edits Maya's draft, and Maya submits it.
      h.setClock(minute(2));
      await save("priya", templateId, { name: "Annual Fee Waiver — Revised" });
      h.setClock(minute(3));
      expect(await submit("maya", templateId)).toEqual({
        ok: true,
        number: 1,
        round: 2,
      });
      expect(
        (await openedBy("priya", CORAL, "annual-fee-waiver", 1)).can,
      ).toMatchObject({
        approve: { ok: false, code: REASONS.wroteVersion.code },
        requestChanges: { ok: false, code: REASONS.wroteVersion.code },
        comment: { ok: true },
      });
      const after = await queueOf("priya", CORAL);
      expect(after.waiting).toEqual(before.waiting);
      expect(rounds(after.submitted), "what she submitted herself").toEqual([
        [h.templates["card-used-abroad"], 1, 1],
      ]);
      // Jordan wrote none of it.
      expect(
        (await openedBy("jordan", CORAL, "annual-fee-waiver", 1)).can.approve,
      ).toEqual({ ok: true });
      expect(rounds((await queueOf("jordan", CORAL)).waiting)).toContainEqual([
        templateId,
        1,
        2,
      ]);
    });
  });

  describe("review.screen's baselines", () => {
    it("redlines each round of an alert against the live version, fields and footer, never against each other; a sent-back round links on to the next", async () => {
      const templateId = h.templates["card-used-abroad"]!;
      h.setClock(minute(1));
      await approve("jordan", templateId, 1, 1, ALERT_OUTPUTS);
      const v1 = (await openedBy("jordan", CORAL, "card-used-abroad", 1))
        .version;
      // v2 changes the push's title; Jordan sends round 1 back, and round 2 changes it again.
      h.setClock(minute(2));
      await edit("maya", templateId);
      await save("maya", templateId, {
        "push.title": line("Your card was used abroad"),
      });
      h.setClock(minute(3));
      expect(await submit("maya", templateId)).toMatchObject({
        number: 2,
        round: 1,
      });
      h.setClock(minute(4));
      await sendBack(templateId, 2, 1);
      h.setClock(minute(5));
      await save("maya", templateId, {
        "push.title": line("Your Coral card was used abroad"),
      });
      h.setClock(minute(6));
      expect(await submit("maya", templateId)).toMatchObject({
        number: 2,
        round: 2,
      });

      for (const round of [2, 1]) {
        const screen = await openedBy(
          "jordan",
          CORAL,
          "card-used-abroad",
          2,
          round,
        );
        expect(screen.baseline, `round ${round}`).toMatchObject({
          id: v1.id,
          number: 1,
          state: "active",
          channelFields: v1.channelFields,
          smsFooter: v1.smsFooter,
        });
        const redline = diffChannelFields(screen.baseline, screen.version);
        expect(
          redline.fields
            .filter((f) => f.status !== "unchanged")
            .map((f) => [f.field.id, f.status]),
          `round ${round}`,
        ).toEqual([["push.title", "changed"]]);
        // The footer is the content type's, as it was when each round was submitted.
        expect(redline.footer?.status).toBe("unchanged");
      }
      expect(
        (await openedBy("jordan", CORAL, "card-used-abroad", 2, 1)).replacedBy,
      ).toEqual({ number: 2, round: 2, state: "in_review" });
    });

    it("shows a rename against the name customers get: on a round sent back before its number went live, the version it was drafted from; on the live version, none; after a revoke, the version that still renders", async () => {
      const templateId = h.templates["cash-back"]!;
      const original = "Cash Back Welcome Bonus — Terms";
      const renamed = "Cash Back Welcome Bonus — 2027 Terms";
      // Round 3 renames v3 and is sent back too; round 4 goes live over v2.
      h.setClock(minute(1));
      await sendBack(templateId, 3, 2);
      h.setClock(minute(2));
      await save("maya", templateId, { name: renamed });
      h.setClock(minute(3));
      await submit("maya", templateId);
      h.setClock(minute(4));
      await sendBack(templateId, 3, 3);
      h.setClock(minute(5));
      await submit("maya", templateId);
      h.setClock(minute(6));
      await approve("jordan", templateId, 3, 4);

      const sentBack = await openedBy("jordan", CORAL, "cash-back", 3, 3);
      expect(sentBack.version.name).toBe(renamed);
      expect(sentBack.baseline).toMatchObject({
        number: 2,
        state: "superseded",
      });
      expect(sentBack.previousNumber, "v3 is its own release").toBeNull();
      expect(sentBack.liveName, "v2's, not its own number's").toBe(original);
      const live = await openedBy("jordan", CORAL, "cash-back", 3);
      expect([live.version.round, live.liveName]).toEqual([4, null]);

      // v4 is drafted from v3, and v3 is revoked: nothing is Active, and v2 still renders.
      h.setClock(minute(7));
      await edit("maya", templateId);
      h.setClock(minute(8));
      await submit("maya", templateId);
      await revoke(templateId, 3, minute(9));
      const corrected = await openedBy("jordan", CORAL, "cash-back", 4);
      expect(corrected.version.name).toBe(renamed);
      expect(corrected.baseline).toMatchObject({
        number: 3,
        state: "revoked",
      });
      expect(corrected.liveName, "v2's: what customers get").toBe(original);
    });

    it("with nothing Active, compares the round with the revoked version it was drafted from, replaces nothing, and names the version that still renders, with its sunset day and what its consumers map", async () => {
      const templateId = h.templates["cash-back"]!;
      const [v1, v2, v3] = await Promise.all(
        [1, 2, 3].map((n) => rowOf(templateId, n)),
      );
      const day = new Date(base.getTime() + 40 * DAY)
        .toISOString()
        .slice(0, 10);
      h.setClock(minute(1));
      await ok(
        h.services().review.setSunset(await h.as("jordan"), {
          templateId,
          versionNumber: 1,
          sunsetDay: day,
        }),
      );
      await revoke(templateId, 2, minute(2));

      const screen = await openedBy("jordan", CORAL, "cash-back", 3);
      const v2Content = await contentOf(templateId, v2.id);
      expect(screen.baseline).toEqual({
        id: v2.id,
        number: 2,
        state: "revoked",
        body: v2Content.body,
        variables: v2Content.variables,
        channels: v2Content.channels,
        channelFields: v2Content.channelFields,
        smsFooter: v2Content.smsFooter,
      });
      expect(screen.previousNumber, "nothing Active to replace").toBeNull();
      // v1 lacks the optional offer_end_date v2 added as well as the annual_fee v3 adds; v3's own record keeps
      // what it changed against v2, Active when it was submitted.
      const [v1Content, v3Content] = await Promise.all([
        contentOf(templateId, v1.id),
        contentOf(templateId, v3.id),
      ]);
      expect(screen.stillRenders).toEqual({
        number: 1,
        sunsetDay: day,
        contractChanges: diffVariables(
          v1Content.variables,
          v3Content.variables,
        ),
      });
      expect(
        screen.stillRenders!.contractChanges.map((c) => [c.kind, c.key]),
      ).toEqual([
        ["added", "offer_end_date"],
        ["added", "annual_fee"],
      ]);
      expect(screen.version.contractChanges).toEqual(v3.contractChanges);

      // At v1's sunset nothing renders.
      h.setClock(sunsetInstant(day, EASTERN));
      const later = await openedBy("jordan", CORAL, "cash-back", 3);
      expect(later.stillRenders).toBeNull();
      expect(later.baseline).toMatchObject({ number: 2, state: "revoked" });
    });
  });

  describe("review.screen's threads", () => {
    it("lists the threads about the whole version first, then by block, and last, as orphaned, one whose block a later round deleted", async () => {
      const templateId = h.templates["cash-back"]!;
      const round2 = (await documentOf(templateId)).version;
      const intro = blockWith(round2.body, "spend $1,000");
      const callout = blockWith(round2.body, "may be taxable");
      h.setClock(minute(1));
      const onCallout = await comment("jordan", templateId, round2.id, callout);
      const onIntro = await comment("jordan", templateId, round2.id, intro);
      h.setClock(minute(2));
      await sendBack(templateId, 3, 2);
      // Round 3 drops the callout.
      h.setClock(minute(3));
      await save("maya", templateId, {
        body: {
          ...round2.body,
          content: round2.body.content!.filter(
            (block) => block.attrs?.id !== callout,
          ),
        },
      });
      h.setClock(minute(4));
      await submit("maya", templateId);

      const screen = await openedBy("jordan", CORAL, "cash-back", 3);
      expect(screen.version.round).toBe(3);
      const order = (threads: typeof screen.threads) =>
        threads.map((t) => [
          t.blockId === DOCUMENT_THREAD
            ? `the change request on round ${t.origin?.round}`
            : t.id,
          t.orphaned,
        ]);
      const expected = [
        ["the change request on round 1", false],
        ["the change request on round 2", false],
        [onIntro, false],
        [onCallout, true],
      ];
      expect(order(screen.threads)).toEqual(expected);
      // The template's threads seen against round 3 read the same.
      const threads = await h
        .services()
        .comments.threads(await h.as("jordan"), {
          templateId,
          versionId: screen.version.id,
        });
      if (!threads.ok) throw new Error(threads.code);
      expect(order(threads.threads)).toEqual(expected);
    });

    it("carries a version's threads on to later versions' records, never back: Balance Transfer v2's is on v3's screen, and v3's own isn't on v2's", async () => {
      const templateId = h.templates["balance-transfer"]!;
      h.setClock(minute(1));
      await edit("maya", templateId);
      h.setClock(minute(2));
      await submit("maya", templateId);
      const v3 = (await documentOf(templateId)).version;
      h.setClock(minute(3));
      const onV3 = await comment(
        "jordan",
        templateId,
        v3.id,
        blockWith(v3.body, "intro APR"),
      );
      const threadsOn = async (number: number) =>
        (await openedBy("jordan", CORAL, "balance-transfer", number)).threads
          .map((t) => t.id)
          .sort();
      const v2Threads = await threadsOn(2);
      expect(v2Threads, "the seed's, begun on v2").toHaveLength(1);
      expect(await threadsOn(1)).toEqual([]);
      expect(await threadsOn(3)).toEqual([...v2Threads, onV3].sort());
    });

    it("shows round 1's threads on round 2's screen, and leaves round 2's off round 1's record", async () => {
      const templateId = h.templates["cash-back"]!;
      const round2 = (await documentOf(templateId)).version;
      h.setClock(minute(1));
      const onRound2 = await comment(
        "jordan",
        templateId,
        round2.id,
        blockWith(round2.body, "spend $1,000"),
      );
      const threadsOn = async (round: number) =>
        (await openedBy("jordan", CORAL, "cash-back", 3, round)).threads.map(
          (t) => [t.id === onRound2 ? "the new one" : t.blockId, t.origin],
        );
      const round1 = { number: 3, round: 1, state: "changes_requested" };
      expect(await threadsOn(1)).toEqual([[DOCUMENT_THREAD, round1]]);
      expect(await threadsOn(2)).toEqual([
        [DOCUMENT_THREAD, round1],
        ["the new one", { number: 3, round: 2, state: "in_review" }],
      ]);
    });

    it("counts a thread begun in the open draft as the next round's: not on round 1's record, but in the draft's margin", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      const before = (await openedBy("jordan", CORAL, "annual-fee-waiver", 1))
        .threads;
      const draft = await documentOf(templateId);
      h.setClock(minute(1));
      const onDraft = await comment(
        "maya",
        templateId,
        draft.version.id,
        String(draft.version.body.content?.[1]?.attrs?.id),
      );
      expect(
        (await openedBy("jordan", CORAL, "annual-fee-waiver", 1)).threads,
      ).toEqual(before);
      const margin = (await documentOf(templateId)).threads;
      expect(margin.map((t) => t.id).sort()).toEqual(
        [...before.map((t) => t.id), onDraft].sort(),
      );
      expect(margin.find((t) => t.id === onDraft)?.origin).toBeNull();
    });

    it("lists an alert's threads on its fields in the fields' order, not as orphaned, on the review screen and in the workspace", async () => {
      const templateId = h.templates["card-used-abroad"]!;
      const v1 = (await documentOf(templateId)).version;
      h.setClock(minute(1));
      const onSms = await comment("jordan", templateId, v1.id, "sms.text");
      h.setClock(minute(2));
      const onTitle = await comment("jordan", templateId, v1.id, "push.title");
      const onFields = (
        threads: readonly { id: string; orphaned: boolean }[],
      ) =>
        threads
          .filter((t) => t.id === onSms || t.id === onTitle)
          .map((t) => [t.id, t.orphaned]);
      const inOrder = [
        [onTitle, false],
        [onSms, false],
      ];
      expect(
        onFields(
          (await openedBy("jordan", CORAL, "card-used-abroad", 1)).threads,
        ),
      ).toEqual(inOrder);
      expect(onFields((await documentOf(templateId)).threads)).toEqual(inOrder);
    });
  });
}
