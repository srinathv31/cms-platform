import { describe, expect, it } from "vitest";
import { sunsetInstant } from "@/domain/business-zone";
import { diffVariables } from "@/domain/contract";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { OutputKey } from "@/domain/review-outputs";
import { DOCUMENT_THREAD, type ActionResult } from "@/domain/review-types";
import type { StoredNotification } from "../notifications";
import type { ContractHarness, ProbeAuditEvent } from "./harness";

// The review lifecycle's behaviour, as every implementation must show it (ReviewService in
// src/server/services/review.ts). Cases act through the services, from the seed (all on Coral Offers, one
// approval stage, "Team approver"):
//
//   Balance Transfer   v1 Superseded (submitted by Priya, sunset on October 25) under an Active v2.
//   Cash Back          v1 Superseded with no sunset, v2 Active, v3 round 1 sent back and round 2 In review
//                      (submitted by Maya; it adds a required `annual_fee`).
//   Annual Fee Waiver  v1 sent back (Maya's), its change request still open, and Maya's open draft.
//   Holiday Points     v1 Revoked, v2 Active.
//
// Coral renders Balance Transfer, Cash Back and Holiday Points. Alex and Jordan approve on Coral Offers; Maya
// and Priya are authors there, Sam a viewer; Naomi approves and Eli writes on Deposits; Taylor is the Auditor.
//
// Each case sets the backend's clock, then compares what the reads show before and after the command. A refusal
// is checked by its code: the sentence is the BFF's.

const DAY = 86_400_000;
const EASTERN = "America/New_York";
const CORAL = "coral";
const CORAL_OFFERS = "t_coral";
/** Whose bells the review cases watch. */
const PEOPLE = ["maya", "priya", "alex", "jordan"] as const;
const ALL_OUTPUTS = ["pdf", "web"] as const;

/** YYYY-MM-DD, `days` after `at` in UTC. */
const dayAfter = (at: Date, days: number) =>
  new Date(at.getTime() + days * DAY).toISOString().slice(0, 10);

/** The rows of `after` that `before` didn't have (the reads answer in write order). */
const added = <T>(before: readonly T[], after: readonly T[]) =>
  after.slice(before.length);

/** A command's answer as its code, or "ok". */
const codeOf = async (answer: Promise<ActionResult<object>>) => {
  const result = await answer;
  return result.ok ? "ok" : result.code;
};

export function reviewContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);

  /** The template's rows as the Versions read shows them to the Auditor (who sees every team), less what moves with the clock. */
  async function rowsOf(templateId: string) {
    const history = await h
      .services()
      .versions.history(await h.as("taylor"), { templateId });
    if (!history.ok) throw new Error(history.code);
    return {
      template: history.template,
      rows: history.versions.map((v) => ({
        id: v.id,
        number: v.number,
        round: v.round,
        state: v.state,
        head: v.head,
        createdBy: v.createdBy,
        createdAt: v.createdAt,
        submittedBy: v.submittedBy,
        submittedAt: v.submittedAt,
        submitNote: v.submitNote,
        activatedAt: v.activatedAt,
        supersededAt: v.supersededAt,
        sunsetAt: v.sunsetAt,
        sunsetDay: v.sunsetDay,
        revoke: v.revoke,
        contractChanges: v.contractChanges,
        decisions: v.decisions,
      })),
    };
  }
  type Row = Awaited<ReturnType<typeof rowsOf>>["rows"][number];
  /** One round of a number (`round`), or without one the number's head. */
  const roundIn = (rows: readonly Row[], number: number, round?: number) =>
    rows.find(
      (v) =>
        v.number === number &&
        (round === undefined ? v.head : v.round === round),
    )!;
  const draftIn = (rows: readonly Row[]) =>
    rows.find((v) => v.state === "draft");

  /**
   * Everything a review command can write about a template, as the reads show it: its rows, the audit rows about
   * each of them, Coral's notices, and the bells of the people the cases watch.
   */
  async function world(templateId: string) {
    const { rows } = await rowsOf(templateId);
    const audit: Record<string, ProbeAuditEvent[]> = {};
    for (const row of rows)
      audit[row.id] = await h.probe.auditEvents({ versionId: row.id });
    const bells: Record<string, StoredNotification[]> = {};
    for (const userId of PEOPLE) {
      const list = await h
        .services()
        .notifications.list(await h.as(userId), { limit: 100 });
      if (!list.ok) throw new Error(list.code);
      bells[userId] = list.items;
    }
    return {
      rows,
      audit,
      notices: await h.consumerNotices(CORAL, templateId),
      bells,
    };
  }
  type World = Awaited<ReturnType<typeof world>>;

  /** The audit rows written between two reads of the world, version by version. */
  const auditAdded = (before: World, after: World) =>
    Object.entries(after.audit).flatMap(([id, rows]) =>
      rows.slice(before.audit[id]?.length ?? 0),
    );
  /** Who was told what between two reads of the world: the people whose bells got something, and what. */
  const toldIn = (before: World, after: World) =>
    Object.fromEntries(
      Object.entries(after.bells)
        .map(
          ([userId, items]) =>
            [
              userId,
              items.filter(
                (n) => !before.bells[userId]!.some((b) => b.id === n.id),
              ),
            ] as const,
        )
        .filter(([, items]) => items.length > 0),
    );

  /** The submit summary as `userId` reads it; it must answer. */
  async function summaryOf(userId: string, templateId: string) {
    const summary = await h
      .services()
      .review.submitSummary(await h.as(userId), { templateId });
    if (!summary.ok) throw new Error(summary.code);
    return summary;
  }

  /** Submits the template's draft as `userId`, with the rev of the summary they read. */
  async function submitAs(userId: string, templateId: string, note?: string) {
    const { rev } = await summaryOf(userId, templateId);
    return h
      .services()
      .review.submit(await h.as(userId), { templateId, note, rev });
  }

  /** Approves a round as `userId`, having viewed every output a document has. */
  async function approveAs(
    userId: string,
    templateId: string,
    versionNumber: number,
    round: number,
    more: { sunsetPrevious?: string | null; sampleSetsSeen?: string[] } = {},
  ) {
    return h.services().review.approve(await h.as(userId), {
      templateId,
      versionNumber,
      round,
      outputsViewed: [...ALL_OUTPUTS],
      sampleSetsSeen: more.sampleSetsSeen ?? [],
      sunsetPrevious: more.sunsetPrevious,
    });
  }

  /** Sends a round back as `userId`. */
  async function sendBackAs(
    userId: string,
    templateId: string,
    versionNumber: number,
    round: number,
    reason = "Spell out the fee.",
  ) {
    return h.services().review.requestChanges(await h.as(userId), {
      templateId,
      versionNumber,
      round,
      reason,
    });
  }

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
      audit: await h.probe.auditEvents({ versionId: version.id }),
      notices: await h.consumerNotices(CORAL, templateId),
      priya: bell.items,
    };
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
          teamId: history.template.teamId,
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

  describe("review.submitSummary", () => {
    it("is what submit would freeze: the draft's rev and content, the round it would get, and what it is compared with", async () => {
      const templateId = h.templates["cash-back"]!;
      h.setClock(minute(1));
      // Cash Back v3 round 2 goes back to Maya: her draft would be round 3, compared with the Active v2.
      expect(await sendBackAs("jordan", templateId, 3, 2)).toEqual({
        ok: true,
      });
      h.setClock(minute(2));
      const summary = await summaryOf("maya", templateId);
      const { template, rows } = await rowsOf(templateId);
      expect(summary).toMatchObject({
        ok: true,
        asOf: minute(2).toISOString(),
        templateId,
        number: 3,
        round: 3,
        name: template.name,
        channels: expect.arrayContaining([...ALL_OUTPUTS]),
        baseline: { number: 2 },
      });
      expect(summary.rev).toEqual(expect.any(Number));
      expect(summary.variables.map((v) => v.key)).toContain("annual_fee");
      expect(summary.baseline!.variables.map((v) => v.key)).not.toContain(
        "annual_fee",
      );
      expect(draftIn(rows)).toBeDefined();
    });

    it("refuses 404 for what the viewer can't see, 403 for what they can't submit, and 409 without a draft", async () => {
      const { review } = h.services();
      const annual = h.templates["annual-fee-waiver"]!;
      const read = async (userId: string, templateId: string) => {
        const answer = await review.submitSummary(await h.as(userId), {
          templateId,
        });
        return answer.ok ? "ok" : [answer.status, answer.code];
      };
      expect(await read("maya", "UC-000000")).toEqual([
        404,
        REQUEST_REFUSALS.templateUnavailable.code,
      ]);
      // Eli writes on Deposits only: Coral's template reads as one that doesn't exist.
      expect(await read("eli", annual)).toEqual([
        404,
        REQUEST_REFUSALS.templateUnavailable.code,
      ]);
      expect(await read("sam", annual)).toEqual([403, REASONS.generic.code]);
      expect(await read("jordan", annual)).toEqual([403, REASONS.generic.code]);
      expect(await read("maya", h.templates["cash-back"]!)).toEqual([
        409,
        REFUSALS.alreadyInReview.code,
      ]);
      expect(await read("maya", h.templates["balance-transfer"]!)).toEqual([
        409,
        REQUEST_REFUSALS.noDraftToSubmit.code,
      ]);
      expect(await read("maya", annual)).toBe("ok");
    });
  });

  describe("review.submit", () => {
    it("submits the draft as the next round of the number sent back, freezes it, asks the approvers, and answers the change request", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      const { template, rows } = await rowsOf(templateId);
      const draft = draftIn(rows)!;
      const sentBack = roundIn(rows, 1, 1);
      const before = await world(templateId);
      h.setClock(minute(1));
      expect(
        await submitAs("maya", templateId, "  Ready for a look.  "),
      ).toEqual({ ok: true, number: 1, round: 2 });

      const after = await world(templateId);
      expect(draftIn(after.rows), "the draft became the round").toBeUndefined();
      expect(roundIn(after.rows, 1, 2)).toMatchObject({
        id: draft.id,
        state: "in_review",
        head: true,
        submittedBy: "maya",
        submittedAt: minute(1).toISOString(),
        submitNote: "Ready for a look.",
        // Nothing of Annual Fee Waiver renders yet: no baseline, so no contract changes.
        contractChanges: null,
        decisions: [],
      });
      expect(roundIn(after.rows, 1, 1)).toEqual({ ...sentBack, head: false });
      expect(
        auditAdded(before, after).map((e) => [
          e.action,
          e.versionId,
          e.details,
        ]),
      ).toEqual([
        [
          "version.submitted",
          draft.id,
          {
            number: 1,
            round: 2,
            note: "Ready for a look.",
            contractChanges: 0,
            breaking: false,
          },
        ],
        // The change request that sent round 1 back is answered by round 2; the block comment stays open.
        [
          "thread.resolved",
          sentBack.id,
          {
            threadId: expect.any(String),
            blockId: DOCUMENT_THREAD,
            auto: true,
            resolvedWith: 1,
            resolvedWithRound: 2,
          },
        ],
      ]);
      expect(
        auditAdded(before, after).every(
          (e) =>
            e.at === minute(1).toISOString() &&
            e.actorId === "maya" &&
            e.teamId === CORAL_OFFERS,
        ),
      ).toBe(true);
      const review = {
        kind: "review_requested",
        facts: {
          actorName: "Maya Chen",
          templateName: template.name,
          number: 1,
          round: 2,
        },
        // The link names the round, as its label does once a number was sent back.
        link: {
          to: "review",
          teamId: CORAL_OFFERS,
          templateId,
          versionNumber: 1,
          round: 2,
        },
        body: "Ready for a look.",
        createdAt: minute(1).toISOString(),
        readAt: null,
      };
      expect(toldIn(before, after)).toEqual({
        alex: [{ id: expect.any(String), ...review }],
        jordan: [{ id: expect.any(String), ...review }],
      });
      expect(after.notices).toEqual(before.notices);

      // A second submit (a double click) finds nothing to submit: the round is in review.
      expect(
        await codeOf(
          h.services().review.submit(await h.as("maya"), {
            templateId,
            rev: 0,
          }),
        ),
      ).toBe(REFUSALS.alreadyInReview.code);
      expect(await world(templateId)).toEqual(after);
    });

    it("refuses a rev other than the draft's (a save landed after the summary was read), and writes nothing", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      const { rev } = await summaryOf("maya", templateId);
      const before = await world(templateId);
      h.setClock(minute(1));
      const maya = await h.as("maya");
      for (const seen of [rev - 1, rev + 1])
        expect(
          await h
            .services()
            .review.submit(maya, { templateId, rev: seen, note: null }),
        ).toMatchObject({ ok: false, code: REFUSALS.summaryStale.code });
      expect(await world(templateId)).toEqual(before);
      expect(
        await h.services().review.submit(maya, { templateId, rev }),
      ).toEqual({ ok: true, number: 1, round: 2 });
    });

    it("refuses with the codes the interface lists, in its order, and writes nothing", async () => {
      const annual = h.templates["annual-fee-waiver"]!;
      const cashBack = h.templates["cash-back"]!;
      const before = await world(annual);
      const { rev } = await summaryOf("maya", annual);
      h.setClock(minute(1));
      const { review } = h.services();
      const long = "a".repeat(2001);
      const submitting = async (
        userId: string,
        templateId: string,
        note: string | null = null,
      ) => codeOf(review.submit(await h.as(userId), { templateId, note, rev }));
      // The permission first: a viewer, someone from another team, and a template that doesn't exist read alike.
      expect(await submitting("sam", annual, long)).toBe(REASONS.generic.code);
      expect(await submitting("eli", annual)).toBe(REASONS.generic.code);
      expect(await submitting("jordan", annual)).toBe(REASONS.generic.code);
      expect(await submitting("maya", "UC-000000")).toBe(REASONS.generic.code);
      // Then the note, before the draft is looked for.
      expect(await submitting("maya", cashBack, long)).toBe(
        REQUEST_REFUSALS.noteTooLong(2000).code,
      );
      expect(await submitting("maya", cashBack)).toBe(
        REFUSALS.alreadyInReview.code,
      );
      expect(await submitting("maya", h.templates["balance-transfer"]!)).toBe(
        REQUEST_REFUSALS.noDraftToSubmit.code,
      );
      expect(await world(annual)).toEqual(before);
    });

    it("refuses version_changed, and writes nothing, when the draft changes between the command's read and its write", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      const before = await world(templateId);
      h.setClock(minute(1));
      h.hooks({ beforeCompareAndSet: () => "competing_write" });
      expect(await submitAs("maya", templateId)).toMatchObject({
        ok: false,
        code: REQUEST_REFUSALS.versionChanged.code,
      });
      h.hooks({});
      expect(await world(templateId)).toEqual(before);
    });

    it("freezes the contract changes against the Active version, and the next round of a number sent back", async () => {
      const templateId = h.templates["cash-back"]!;
      h.setClock(minute(1));
      expect(await sendBackAs("jordan", templateId, 3, 2)).toEqual({
        ok: true,
      });
      const summary = await summaryOf("maya", templateId);
      expect(summary.baseline?.number).toBe(2);
      h.setClock(minute(2));
      expect(await submitAs("maya", templateId)).toEqual({
        ok: true,
        number: 3,
        round: 3,
      });
      const { rows } = await rowsOf(templateId);
      expect(roundIn(rows, 3, 3)).toMatchObject({
        state: "in_review",
        contractChanges: diffVariables(
          summary.baseline!.variables,
          summary.variables,
        ),
      });
      expect(roundIn(rows, 3, 3).contractChanges).toEqual([
        expect.objectContaining({
          kind: "added",
          key: "annual_fee",
          breaking: true,
        }),
      ]);
      expect(
        rows.filter((v) => v.number === 3).map((v) => [v.round, v.state]),
      ).toEqual([
        [3, "in_review"],
        [2, "changes_requested"],
        [1, "changes_requested"],
      ]);
    });

    it("after the Active version is revoked, freezes the changes against the newest version that still renders, and with none left, none", async () => {
      const templateId = h.templates["cash-back"]!;
      // v1's sunset comes in a day; then v2 is revoked and v3 round 2 sent back.
      const day = dayAfter(base, 1);
      h.setClock(minute(1));
      expect(
        await h.services().review.setSunset(await h.as("jordan"), {
          templateId,
          versionNumber: 1,
          sunsetDay: day,
        }),
      ).toEqual({ ok: true, changed: true });
      expect(
        await h.services().review.startRevoke(await h.as("jordan"), {
          templateId,
          versionNumber: 2,
          reason: "Wrong bonus amount.",
        }),
      ).toEqual({ ok: true });
      h.setClock(minute(2));
      expect(
        await h.services().review.confirmRevoke(await h.as("alex"), {
          templateId,
          versionNumber: 2,
        }),
      ).toEqual({ ok: true });
      expect(await sendBackAs("jordan", templateId, 3, 2)).toEqual({
        ok: true,
      });

      // Before v1's sunset, v1 still renders: the draft is compared with it, not with the revoked v2.
      const withV1 = await summaryOf("maya", templateId);
      expect(withV1.baseline?.number).toBe(1);
      // Once it has passed, nothing renders: no baseline, as for a first version.
      h.setClock(sunsetInstant(day, EASTERN));
      const none = await summaryOf("maya", templateId);
      expect(none.baseline).toBeNull();
      expect(await submitAs("maya", templateId)).toEqual({
        ok: true,
        number: 3,
        round: 3,
      });
      expect(
        roundIn((await rowsOf(templateId)).rows, 3, 3).contractChanges,
      ).toBeNull();
    });
  });

  describe("review.requestChanges", () => {
    it("sends the round back with the reason, records the decision, opens the author's draft, and tells the author", async () => {
      const templateId = h.templates["cash-back"]!;
      const { template, rows } = await rowsOf(templateId);
      const round2 = roundIn(rows, 3, 2);
      const before = await world(templateId);
      h.setClock(minute(1));
      expect(
        await sendBackAs(
          "jordan",
          templateId,
          3,
          2,
          "  The fee line is missing.  ",
        ),
      ).toEqual({ ok: true });

      const after = await world(templateId);
      expect(roundIn(after.rows, 3, 2)).toMatchObject({
        id: round2.id,
        state: "changes_requested",
        decisions: [
          {
            kind: "changes_requested",
            stageName: "Team approver",
            by: "jordan",
            at: minute(1).toISOString(),
            reason: "The fee line is missing.",
          },
        ],
      });
      // The draft is the author's, whoever sent it back, and its next submit is round 3 of the same number.
      expect(draftIn(after.rows)).toMatchObject({
        createdBy: "maya",
        createdAt: minute(1).toISOString(),
        submittedBy: null,
      });
      expect(await summaryOf("maya", templateId)).toMatchObject({
        number: 3,
        round: 3,
        name: template.name,
      });
      expect(
        auditAdded(before, after).map((e) => [
          e.action,
          e.versionId,
          e.actorId,
          e.details,
        ]),
      ).toEqual([
        [
          "version.changes_requested",
          round2.id,
          "jordan",
          {
            number: 3,
            round: 2,
            stage: "Team approver",
            reason: "The fee line is missing.",
          },
        ],
      ]);
      expect(toldIn(before, after)).toEqual({
        maya: [
          {
            id: expect.any(String),
            kind: "changes_requested",
            facts: {
              actorName: "Jordan Ellis",
              templateName: template.name,
              number: 3,
              round: 2,
            },
            link: { to: "template", teamId: CORAL_OFFERS, templateId },
            body: "The fee line is missing.",
            createdAt: minute(1).toISOString(),
            readAt: null,
          },
        ],
      });
      expect(after.notices).toEqual(before.notices);

      // The reason is a change request the next round answers.
      h.setClock(minute(2));
      const beforeResubmit = await world(templateId);
      expect(await submitAs("maya", templateId)).toEqual({
        ok: true,
        number: 3,
        round: 3,
      });
      expect(
        auditAdded(beforeResubmit, await world(templateId))
          .filter((e) => e.action === "thread.resolved")
          .map((e) => [e.versionId, e.details]),
      ).toEqual([
        [
          round2.id,
          expect.objectContaining({ resolvedWith: 3, resolvedWithRound: 3 }),
        ],
      ]);
    });

    it("refuses with the codes the interface lists, in its order, and writes nothing", async () => {
      const templateId = h.templates["cash-back"]!;
      const before = await world(templateId);
      h.setClock(minute(1));
      const sending = (
        userId: string,
        round: number,
        reason = "Spell out the fee.",
      ) => codeOf(sendBackAs(userId, templateId, 3, round, reason));
      // The permission first: whoever submitted it, then anyone who may not decide on the team, and a round that
      // doesn't exist, which reads like a forbidden one.
      expect(await sending("maya", 2, "a".repeat(2001))).toBe(
        REASONS.ownVersion.code,
      );
      expect(await sending("priya", 2)).toBe(REASONS.generic.code);
      expect(await sending("sam", 2)).toBe(REASONS.generic.code);
      expect(await sending("naomi", 2)).toBe(REASONS.generic.code);
      expect(await sending("jordan", 3)).toBe(REASONS.generic.code);
      expect(await codeOf(sendBackAs("jordan", "UC-000000", 1, 1))).toBe(
        REASONS.generic.code,
      );
      // Then the reason's length, before the round is read again; then the transition.
      expect(await sending("jordan", 1, "a".repeat(2001))).toBe(
        REQUEST_REFUSALS.reasonTooLong(2000).code,
      );
      expect(await sending("jordan", 1)).toBe(REFUSALS.notInReview.code);
      expect(await sending("jordan", 2, "   ")).toBe(REFUSALS.giveReason.code);
      expect(await world(templateId)).toEqual(before);
    });

    it("refuses a second change request (a double click), and writes one decision", async () => {
      const templateId = h.templates["cash-back"]!;
      h.setClock(minute(1));
      expect(await sendBackAs("jordan", templateId, 3, 2)).toEqual({
        ok: true,
      });
      const before = await world(templateId);
      h.setClock(minute(2));
      expect(await codeOf(sendBackAs("alex", templateId, 3, 2))).toBe(
        REFUSALS.notInReview.code,
      );
      expect(await world(templateId)).toEqual(before);
      expect(roundIn(before.rows, 3, 2).decisions).toHaveLength(1);
    });

    it("refuses version_changed, and writes nothing, when the round changes between the command's read and its write", async () => {
      const templateId = h.templates["cash-back"]!;
      const before = await world(templateId);
      h.setClock(minute(1));
      h.hooks({ beforeCompareAndSet: () => "competing_write" });
      expect(await sendBackAs("jordan", templateId, 3, 2)).toMatchObject({
        ok: false,
        code: REQUEST_REFUSALS.versionChanged.code,
      });
      h.hooks({});
      expect(await world(templateId)).toEqual(before);
    });
  });

  describe("review.approve", () => {
    it("at the last stage puts the round live over the Active version, sunsets that one, tells Coral in commit order, and tells the author", async () => {
      const templateId = h.templates["cash-back"]!;
      const { template, rows } = await rowsOf(templateId);
      const [v2, round2] = [roundIn(rows, 2), roundIn(rows, 3, 2)];
      const before = await world(templateId);
      h.setClock(minute(1));
      const day = dayAfter(minute(1), 14);
      const instant = sunsetInstant(day, EASTERN).toISOString();
      expect(
        await approveAs("jordan", templateId, 3, 2, {
          sunsetPrevious: day,
          sampleSetsSeen: ["typical"],
        }),
      ).toEqual({ ok: true, wentLive: true, number: 3, round: 2 });

      const after = await world(templateId);
      expect(roundIn(after.rows, 3, 2)).toMatchObject({
        id: round2.id,
        state: "active",
        activatedAt: minute(1).toISOString(),
        decisions: [
          {
            kind: "approved",
            stageName: "Team approver",
            by: "jordan",
            at: minute(1).toISOString(),
            reason: null,
          },
        ],
      });
      expect(roundIn(after.rows, 3, 1).state).toBe("changes_requested");
      expect(roundIn(after.rows, 2)).toMatchObject({
        id: v2.id,
        state: "superseded",
        supersededAt: minute(1).toISOString(),
        sunsetDay: day,
        sunsetAt: instant,
      });
      expect(
        auditAdded(before, after).map((e) => [
          e.action,
          e.versionId,
          e.details,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [
            "version.activated",
            round2.id,
            {
              number: 3,
              round: 2,
              supersedes: 2,
              stage: "Team approver",
              outputsViewed: [...ALL_OUTPUTS],
            },
          ],
          ["version.superseded", v2.id, { number: 2, supersededBy: 3 }],
          [
            "version.sunset_set",
            v2.id,
            expect.objectContaining({
              number: 2,
              sunsetAt: instant,
              sunsetDay: day,
              zone: EASTERN,
            }),
          ],
        ]),
      );
      expect(auditAdded(before, after)).toHaveLength(3);
      expect(added(before.notices, after.notices)).toEqual([
        expect.objectContaining({
          kind: "new_version",
          createdAt: minute(1).toISOString(),
          versionNumber: 3,
          activeVersion: 3,
          changes: [
            expect.objectContaining({
              kind: "added",
              key: "annual_fee",
              breaking: true,
            }),
          ],
        }),
        expect.objectContaining({
          kind: "sunset_scheduled",
          versionNumber: 2,
          activeVersion: 3,
          sunsetAt: instant,
          sunsetDay: day,
          zone: EASTERN,
        }),
      ]);
      expect(toldIn(before, after)).toEqual({
        maya: [
          expect.objectContaining({
            kind: "version_live",
            facts: {
              actorName: "Jordan Ellis",
              templateName: template.name,
              number: 3,
            },
            link: { to: "template", teamId: CORAL_OFFERS, templateId },
          }),
        ],
      });
    });

    it("refuses with the codes the interface lists, in its order, and writes nothing", async () => {
      const templateId = h.templates["cash-back"]!;
      const before = await world(templateId);
      h.setClock(minute(1));
      const approving = async (
        userId: string,
        round: number,
        more: { sunsetPrevious?: string; outputsViewed?: string[] } = {},
      ) =>
        codeOf(
          h.services().review.approve(await h.as(userId), {
            templateId,
            versionNumber: 3,
            round,
            sampleSetsSeen: [],
            outputsViewed: (more.outputsViewed ??
              ALL_OUTPUTS) as readonly OutputKey[],
            sunsetPrevious: more.sunsetPrevious,
          }),
        );
      expect(await approving("maya", 2, { sunsetPrevious: "soon" })).toBe(
        REASONS.ownVersion.code,
      );
      expect(await approving("sam", 2)).toBe(REASONS.generic.code);
      expect(await approving("naomi", 2)).toBe(REASONS.generic.code);
      expect(await approving("jordan", 4)).toBe(REASONS.generic.code);
      expect(
        await approving("jordan", 2, { sunsetPrevious: "2026-02-30" }),
      ).toBe(REQUEST_REFUSALS.invalidDate.code);
      expect(await approving("jordan", 1)).toBe(REFUSALS.notInReview.code);
      // Every output of the round's own channels, PDF and Web here: one of another channel doesn't stand in.
      expect(await approving("jordan", 2, { outputsViewed: ["pdf"] })).toBe(
        "output_not_viewed",
      );
      expect(
        await approving("jordan", 2, { outputsViewed: ["email", "sms"] }),
      ).toBe("output_not_viewed");
      expect(
        await approving("jordan", 2, {
          sunsetPrevious: minute(1).toISOString().slice(0, 10),
        }),
      ).toBe(REFUSALS.sunsetAfterToday.code);
      expect(await world(templateId)).toEqual(before);
    });

    it("puts a first round live over nothing: nothing is superseded and the sunset day is ignored", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      h.setClock(minute(1));
      expect(await submitAs("maya", templateId)).toEqual({
        ok: true,
        number: 1,
        round: 2,
      });
      const before = await world(templateId);
      h.setClock(minute(2));
      expect(
        await approveAs("alex", templateId, 1, 2, {
          sunsetPrevious: dayAfter(minute(2), 14),
        }),
      ).toEqual({ ok: true, wentLive: true, number: 1, round: 2 });
      const after = await world(templateId);
      expect(after.rows.map((v) => [v.number, v.round, v.state])).toEqual([
        [1, 2, "active"],
        [1, 1, "changes_requested"],
      ]);
      expect(after.rows.every((v) => v.sunsetAt === null)).toBe(true);
      expect(
        auditAdded(before, after).map((e) => [e.action, e.details]),
      ).toEqual([
        [
          "version.activated",
          {
            number: 1,
            round: 2,
            supersedes: null,
            stage: "Team approver",
            outputsViewed: [...ALL_OUTPUTS],
          },
        ],
      ]);
      expect(
        added(before.notices, after.notices).map((n) => n.kind),
      ).not.toContain("sunset_scheduled");
    });

    it("refuses version_changed, and writes nothing, when the round changes between the command's read and its write; then another approver's goes live", async () => {
      const templateId = h.templates["cash-back"]!;
      const before = await world(templateId);
      h.setClock(minute(1));
      h.hooks({ beforeCompareAndSet: () => "competing_write" });
      expect(await approveAs("alex", templateId, 3, 2)).toMatchObject({
        ok: false,
        code: REQUEST_REFUSALS.versionChanged.code,
      });
      h.hooks({});
      expect(await world(templateId)).toEqual(before);

      h.setClock(minute(2));
      expect(await approveAs("jordan", templateId, 3, 2)).toMatchObject({
        ok: true,
        wentLive: true,
      });
      // The one that lost finds the round live: it is no longer in review.
      expect(await codeOf(approveAs("alex", templateId, 3, 2))).toBe(
        REFUSALS.notInReview.code,
      );
    });

    it("refuses version_changed, and writes nothing, when the Active version changes before it steps down", async () => {
      const templateId = h.templates["cash-back"]!;
      const v2 = roundIn((await rowsOf(templateId)).rows, 2);
      const before = await world(templateId);
      h.setClock(minute(1));
      h.hooks({
        beforeCompareAndSet: ({ table, id }) =>
          table === "versions" && id === v2.id ? "competing_write" : undefined,
      });
      expect(
        await approveAs("jordan", templateId, 3, 2, {
          sunsetPrevious: dayAfter(minute(1), 14),
        }),
      ).toMatchObject({
        ok: false,
        code: REQUEST_REFUSALS.versionChanged.code,
      });
      h.hooks({});
      expect(await world(templateId)).toEqual(before);
    });

    it("lets one of two approves at once go live; the other finds the round no longer in review", async () => {
      const templateId = h.templates["cash-back"]!;
      h.setClock(minute(1));
      const answers = await Promise.all([
        approveAs("jordan", templateId, 3, 2),
        approveAs("alex", templateId, 3, 2),
      ]);
      expect(answers.map((a) => (a.ok ? "ok" : a.code)).sort()).toEqual([
        REFUSALS.notInReview.code,
        "ok",
      ]);
      expect(
        roundIn((await rowsOf(templateId)).rows, 3, 2).decisions,
      ).toHaveLength(1);
    });
  });

  // Maker-checker covers everyone who wrote the round (decision 0007): its submitter, and whoever wrote the draft
  // it came from, across a change request. Authors here, so their refusal is the self-block they read.
  describe("maker-checker", () => {
    it("bars every writer of a round from deciding it, across a change request; the approver who asked decides the next round", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      const deciding = async (userId: string, round: number) => [
        await codeOf(approveAs(userId, templateId, 1, round)),
        await codeOf(sendBackAs(userId, templateId, 1, round)),
      ];
      // Priya submits the draft Maya wrote: both wrote round 2.
      h.setClock(minute(1));
      expect(await submitAs("priya", templateId)).toEqual({
        ok: true,
        number: 1,
        round: 2,
      });
      expect(await deciding("priya", 2)).toEqual([
        REASONS.ownVersion.code,
        REASONS.ownVersion.code,
      ]);
      expect(await deciding("maya", 2)).toEqual([
        REASONS.wroteVersion.code,
        REASONS.wroteVersion.code,
      ]);

      // Jordan sends it back; Maya resubmits the draft, which carries round 2's writers on.
      h.setClock(minute(2));
      expect(await sendBackAs("jordan", templateId, 1, 2)).toEqual({
        ok: true,
      });
      h.setClock(minute(3));
      expect(await submitAs("maya", templateId)).toEqual({
        ok: true,
        number: 1,
        round: 3,
      });
      expect(await deciding("priya", 3)).toEqual([
        REASONS.wroteVersion.code,
        REASONS.wroteVersion.code,
      ]);
      expect(await deciding("maya", 3)).toEqual([
        REASONS.ownVersion.code,
        REASONS.ownVersion.code,
      ]);
      // Jordan only sent it back: he wrote none of it.
      h.setClock(minute(4));
      expect(await approveAs("jordan", templateId, 1, 3)).toEqual({
        ok: true,
        wentLive: true,
        number: 1,
        round: 3,
      });
    });
  });

  describe("the two-person revoke", () => {
    const reason = "Wrong APR in legal notices.";

    it("one approver starts it and can't confirm it; the others are asked; nothing stops rendering yet", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const { template, rows } = await rowsOf(templateId);
      const v1 = roundIn(rows, 1);
      const before = await world(templateId);
      h.setClock(minute(1));
      const jordan = await h.as("jordan");
      const { review } = h.services();
      expect(
        await review.startRevoke(jordan, {
          templateId,
          versionNumber: 1,
          reason: `  ${reason}  `,
        }),
      ).toEqual({ ok: true });
      const after = await world(templateId);
      expect(roundIn(after.rows, 1)).toMatchObject({
        state: "superseded",
        revoke: {
          reason,
          startedBy: "jordan",
          startedAt: minute(1).toISOString(),
        },
      });
      expect(
        auditAdded(before, after).map((e) => [
          e.action,
          e.versionId,
          e.details,
        ]),
      ).toEqual([["version.revoke_started", v1.id, { number: 1, reason }]]);
      expect(toldIn(before, after)).toEqual({
        alex: [
          expect.objectContaining({
            kind: "revoke_started",
            facts: {
              actorName: "Jordan Ellis",
              templateName: template.name,
              number: 1,
            },
            link: { to: "versions", teamId: CORAL_OFFERS, templateId },
            body: reason,
          }),
        ],
      });
      expect(after.notices).toEqual(before.notices);

      h.setClock(minute(2));
      expect(
        await codeOf(
          review.startRevoke(jordan, { templateId, versionNumber: 1, reason }),
        ),
      ).toBe(REFUSALS.revokePending.code);
      expect(
        await codeOf(
          review.confirmRevoke(jordan, { templateId, versionNumber: 1 }),
        ),
      ).toBe(REASONS.ownRevoke.code);
      expect(await world(templateId)).toEqual(after);
    });

    it("a second approver confirms: the version is Revoked, Coral is told, and so are the starter and the author", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const v1 = roundIn((await rowsOf(templateId)).rows, 1);
      h.setClock(minute(1));
      const { review } = h.services();
      await review.startRevoke(await h.as("jordan"), {
        templateId,
        versionNumber: 1,
        reason,
      });
      const before = await world(templateId);
      h.setClock(minute(2));
      const alex = await h.as("alex");
      expect(
        await review.confirmRevoke(alex, { templateId, versionNumber: 1 }),
      ).toEqual({ ok: true });

      const after = await world(templateId);
      expect(roundIn(after.rows, 1)).toMatchObject({
        state: "revoked",
        revoke: {
          reason,
          startedBy: "jordan",
          confirmedBy: "alex",
          confirmedAt: minute(2).toISOString(),
        },
      });
      expect(
        auditAdded(before, after).map((e) => [
          e.action,
          e.versionId,
          e.details,
        ]),
      ).toEqual([
        [
          "version.revoked",
          v1.id,
          { number: 1, reason, startedBy: "jordan", wasActive: false },
        ],
      ]);
      expect(added(before.notices, after.notices)).toEqual([
        expect.objectContaining({
          kind: "revoked",
          createdAt: minute(2).toISOString(),
          versionNumber: 1,
          activeVersion: 2,
          reason,
        }),
      ]);
      // Jordan (the starter) and Priya (who submitted v1) hear about it; Alex isn't told of his own action.
      const told = toldIn(before, after);
      expect(Object.keys(told).sort()).toEqual(["jordan", "priya"]);
      expect(told.priya).toEqual([
        expect.objectContaining({ kind: "version_revoked", body: reason }),
      ]);

      // A second confirm, or a cancel, finds it revoked.
      h.setClock(minute(3));
      const jordan = await h.as("jordan");
      expect(
        await codeOf(
          review.confirmRevoke(alex, { templateId, versionNumber: 1 }),
        ),
      ).toBe(REFUSALS.alreadyRevoked.code);
      expect(
        await codeOf(
          review.cancelRevoke(jordan, { templateId, versionNumber: 1 }),
        ),
      ).toBe(REFUSALS.alreadyRevoked.code);
      expect(await world(templateId)).toEqual(after);
    });

    it("another approver may cancel a pending revoke; the version keeps its state", async () => {
      const templateId = h.templates["holiday-points"]!;
      const v2 = roundIn((await rowsOf(templateId)).rows, 2);
      h.setClock(minute(1));
      const { review } = h.services();
      await review.startRevoke(await h.as("alex"), {
        templateId,
        versionNumber: 2,
        reason: "Wrong bonus.",
      });
      const before = await world(templateId);
      h.setClock(minute(2));
      const jordan = await h.as("jordan");
      expect(
        await review.cancelRevoke(jordan, { templateId, versionNumber: 2 }),
      ).toEqual({ ok: true });
      const after = await world(templateId);
      expect(roundIn(after.rows, 2)).toMatchObject({
        state: "active",
        revoke: null,
      });
      expect(
        auditAdded(before, after).map((e) => [
          e.action,
          e.versionId,
          e.details,
        ]),
      ).toEqual([
        [
          "version.revoke_cancelled",
          v2.id,
          {
            number: 2,
            reason: "Wrong bonus.",
            startedBy: "alex",
            ownRevoke: false,
          },
        ],
      ]);
      expect(after.notices).toEqual(before.notices);
      expect(
        await codeOf(
          review.cancelRevoke(jordan, { templateId, versionNumber: 2 }),
        ),
      ).toBe(REFUSALS.noRevokePending.code);
    });

    it("refuses with the codes the interface lists, in their order, and writes nothing", async () => {
      const templateId = h.templates["holiday-points"]!;
      const before = await world(templateId);
      h.setClock(minute(1));
      const { review } = h.services();
      const long = "a".repeat(2001);
      const ref = { templateId, versionNumber: 2 };
      const maya = await h.as("maya");
      const jordan = await h.as("jordan");
      // An author may do none of it, whatever the reason; nor may an approver of another team.
      expect(
        await codeOf(review.startRevoke(maya, { ...ref, reason: long })),
      ).toBe(REASONS.generic.code);
      expect(await codeOf(review.confirmRevoke(maya, ref))).toBe(
        REASONS.generic.code,
      );
      expect(await codeOf(review.cancelRevoke(maya, ref))).toBe(
        REASONS.generic.code,
      );
      expect(
        await codeOf(
          review.startRevoke(jordan, {
            templateId: h.templates["high-yield-savings"]!,
            versionNumber: 2,
            reason,
          }),
        ),
      ).toBe(REASONS.generic.code);
      expect(
        await codeOf(
          review.startRevoke(jordan, { ...ref, versionNumber: 9, reason }),
        ),
      ).toBe(REASONS.generic.code);
      // Then the reason, the version's state, and what is pending.
      expect(
        await codeOf(review.startRevoke(jordan, { ...ref, reason: long })),
      ).toBe(REQUEST_REFUSALS.reasonTooLong(2000).code);
      expect(
        await codeOf(
          review.startRevoke(jordan, { ...ref, versionNumber: 1, reason }),
        ),
      ).toBe(REFUSALS.alreadyRevoked.code);
      expect(
        await codeOf(review.startRevoke(jordan, { ...ref, reason: "   " })),
      ).toBe(REFUSALS.giveReason.code);
      expect(await codeOf(review.confirmRevoke(jordan, ref))).toBe(
        REFUSALS.noRevokePending.code,
      );
      expect(await codeOf(review.cancelRevoke(jordan, ref))).toBe(
        REFUSALS.noRevokePending.code,
      );
      expect(await world(templateId)).toEqual(before);
    });

    it("refuses version_changed at each step, and writes nothing, when the version changes between the command's read and its write", async () => {
      const templateId = h.templates["holiday-points"]!;
      const ref = { templateId, versionNumber: 2 };
      const { review } = h.services();
      const lost = { ok: false, code: REQUEST_REFUSALS.versionChanged.code };
      const competing = () =>
        h.hooks({ beforeCompareAndSet: () => "competing_write" });
      h.setClock(minute(1));

      let before = await world(templateId);
      competing();
      expect(
        await review.startRevoke(await h.as("alex"), { ...ref, reason }),
      ).toMatchObject(lost);
      h.hooks({});
      expect(await world(templateId)).toEqual(before);
      await review.startRevoke(await h.as("alex"), { ...ref, reason });

      before = await world(templateId);
      for (const step of [review.confirmRevoke, review.cancelRevoke]) {
        competing();
        expect(await step(await h.as("jordan"), ref)).toMatchObject(lost);
        h.hooks({});
        expect(await world(templateId)).toEqual(before);
      }
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
