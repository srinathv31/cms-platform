import { describe, expect, it } from "vitest";
import { sunsetInstant } from "@/domain/business-zone";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ContractHarness } from "./harness";

// One template's versions, as every implementation must answer them (VersionService in
// src/server/services/versions.ts), read from the seed with the backend's clock at the seed's base instant (a case
// that needs another sets it). Refusals are compared by code. The seed:
//   - Balance Transfer: v1 Superseded (Priya, approved by Jordan, sunset on October 25), v2 Active, both
//     rendered by Coral;
//   - High-Yield Savings (Deposits): v2 Active on round 3 after two send-backs, v1 Superseded;
//   - Cash Back: v3 in review on round 2, v2 Active, v1 Superseded;
//   - Annual Fee Waiver: v1 sent back, and an open draft;
//   - Holiday Points: v1 Revoked.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function versionsContract(h: ContractHarness, base: Date) {
  describe("versions.history", () => {
    it("reads Balance Transfer's versions with their dates, decisions, renders and what the viewer may do", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const history = await h
        .services()
        .versions.history(await h.as("jordan"), { templateId });
      if (!history.ok) throw new Error(history.code);
      expect(history.asOf).toBe(base.toISOString());
      expect(history.template).toEqual({
        id: templateId,
        teamId: "t_coral",
        teamSlug: "coral-offers",
        name: "Balance Transfer Intro — Terms",
      });
      expect(history.versions.map((v) => [v.number, v.state, v.head])).toEqual([
        [2, "active", true],
        [1, "superseded", true],
      ]);
      const [v2, v1] = history.versions;
      expect(v1).toMatchObject({
        submittedBy: "priya",
        submittedAt: expect.stringMatching(ISO),
        activatedAt: expect.stringMatching(ISO),
        supersededAt: expect.stringMatching(ISO),
        sunsetDay: "2026-10-25",
        sunsetAt: sunsetInstant("2026-10-25", "America/New_York").toISOString(),
        sunsetPassed: false,
        decisions: [
          expect.objectContaining({
            kind: "approved",
            stageName: "Team approver",
            by: "jordan",
          }),
        ],
        lastRenderAt: expect.stringMatching(ISO),
        can: {
          setSunset: { ok: true },
          startRevoke: { ok: true },
          confirmRevoke: { ok: false, code: REFUSALS.noRevokePending.code },
          cancelRevoke: { ok: false, code: REFUSALS.noRevokePending.code },
        },
      });
      expect(v1!.renders30d).toBeGreaterThan(0);
      expect(v2!.can.setSunset).toMatchObject({
        ok: false,
        code: REFUSALS.sunsetNotSuperseded.code,
      });
      expect(v2!.revoke).toBeNull();
      expect(
        history.consumerUsage.map((u) => [u.consumerId, u.versionNumber]),
      ).toEqual([
        ["coral", 2],
        ["coral", 1],
      ]);
      expect(history.sunsetCalendar).toEqual({
        zone: "America/New_York",
        today: "2026-10-04",
      });
      expect(history.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(["jordan", "priya"]),
      );

      // An author may not set a sunset: the permission's refusal, not the state's.
      const author = await h
        .services()
        .versions.history(await h.as("maya"), { templateId });
      if (!author.ok) throw new Error(author.code);
      expect(author.versions[1]!.can.setSunset).toMatchObject({
        ok: false,
        code: REASONS.generic.code,
      });
    });

    it("once Balance Transfer v1's sunset passes, its sunset is refused to everyone, with the reason", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const sunsetAt = sunsetInstant("2026-10-25", "America/New_York");
      const v1At = async (userId: string, at: Date) => {
        h.setClock(at);
        const history = await h
          .services()
          .versions.history(await h.as(userId), { templateId });
        if (!history.ok) throw new Error(history.code);
        return history.versions;
      };

      expect(
        (await v1At("jordan", new Date(sunsetAt.getTime() - 1)))[1],
      ).toMatchObject({
        sunsetPassed: false,
        can: { setSunset: { ok: true } },
      });

      const passed = { ok: false, code: REFUSALS.sunsetPassed.code };
      const [v2, v1] = await v1At("jordan", sunsetAt);
      expect(v1).toMatchObject({
        state: "superseded",
        sunsetPassed: true,
        can: { setSunset: passed, startRevoke: { ok: true } },
      });
      expect(v2!.can.setSunset).toMatchObject({
        ok: false,
        code: REFUSALS.sunsetNotSuperseded.code,
      });
      // A fact about the version, not the viewer: an author reads the same reason.
      expect((await v1At("maya", sunsetAt))[1]!.can.setSunset).toMatchObject(
        passed,
      );
    });

    it("lists every row, the open draft first then newest first, and marks each number's head", async () => {
      const rows = async (userId: string, key: string) => {
        const history = await h
          .services()
          .versions.history(await h.as(userId), {
            templateId: h.templates[key]!,
          });
        if (!history.ok) throw new Error(history.code);
        return history.versions.map((v) => [
          v.number,
          v.round,
          v.state,
          v.head,
        ]);
      };
      expect(await rows("eli", "high-yield-savings")).toEqual([
        [2, 3, "active", true],
        [2, 2, "changes_requested", false],
        [2, 1, "changes_requested", false],
        [1, 1, "superseded", true],
      ]);
      expect(await rows("maya", "cash-back")).toEqual([
        [3, 2, "in_review", true],
        [3, 1, "changes_requested", false],
        [2, 1, "active", true],
        [1, 1, "superseded", true],
      ]);
      expect(await rows("maya", "annual-fee-waiver")).toEqual([
        [null, null, "draft", true],
        [1, 1, "changes_requested", true],
      ]);
    });

    it("reads a revoke with its people, and refuses to revoke it again", async () => {
      const history = await h
        .services()
        .versions.history(await h.as("jordan"), {
          templateId: h.templates["holiday-points"]!,
        });
      if (!history.ok) throw new Error(history.code);
      const revoked = history.versions.find((v) => v.state === "revoked")!;
      expect(revoked.revoke).toMatchObject({
        reason: expect.any(String),
        startedBy: expect.any(String),
        confirmedBy: expect.any(String),
        confirmedAt: expect.stringMatching(ISO),
      });
      expect(history.people.map((p) => p.id)).toEqual(
        expect.arrayContaining([
          revoked.revoke!.startedBy,
          revoked.revoke!.confirmedBy,
        ]),
      );
      expect(revoked.can.startRevoke).toMatchObject({
        ok: false,
        code: REFUSALS.alreadyRevoked.code,
      });
      expect(revoked.can.confirmRevoke).toMatchObject({
        ok: false,
        code: REFUSALS.alreadyRevoked.code,
      });
    });

    it("reads a template the viewer can't see exactly as one that doesn't exist", async () => {
      const maya = await h.as("maya");
      const unavailable = {
        ok: false,
        status: 404,
        code: REQUEST_REFUSALS.templateUnavailable.code,
      };
      expect(
        await h.services().versions.history(maya, {
          templateId: h.templates["high-yield-savings"]!,
        }),
      ).toMatchObject(unavailable);
      expect(
        await h.services().versions.history(maya, { templateId: "UC-000000" }),
      ).toMatchObject(unavailable);
    });
  });
}

/**
 * The two reads of a version's content the workspace makes on demand: Compare's pair and "Revert to vN"'s base.
 * Morgan has no team; Sam views Coral Offers; Eli is on Deposits.
 */
export function versionContentContract(h: ContractHarness) {
  /** A version row as the Versions read lists it: a number's head, or the open draft (number null). */
  async function row(templateKey: string, number: number | null) {
    const history = await h.services().versions.history(await h.as("jordan"), {
      templateId: h.templates[templateKey]!,
    });
    if (!history.ok) throw new Error(history.code);
    return history.versions.find((v) => v.number === number && v.head)!;
  }

  describe("versions.compare", () => {
    it("reads two versions' content, older first, for anyone who may see the template", async () => {
      const templateId = h.templates["cash-back"]!;
      const [v1, v2] = [await row("cash-back", 1), await row("cash-back", 2)];
      for (const userId of ["maya", "sam"]) {
        const pair = await h.services().versions.compare(await h.as(userId), {
          templateId,
          from: v1.id,
          to: v2.id,
        });
        expect(pair).toMatchObject({
          ok: true,
          family: "document",
          from: { id: v1.id, number: 1, round: 1, state: "superseded" },
          to: {
            id: v2.id,
            number: 2,
            round: 1,
            state: "active",
            smsFooter: null,
          },
        });
        if (!pair.ok) throw new Error(pair.code);
        expect(pair.to).toEqual(
          expect.objectContaining({
            name: expect.any(String),
            body: expect.objectContaining({ type: "doc" }),
            channels: expect.any(Array),
            channelFields: expect.any(Object),
            variables: expect.any(Array),
          }),
        );
      }
    });

    it("gives the open draft no number and no round", async () => {
      const [v1, draft] = [
        await row("annual-fee-waiver", 1),
        await row("annual-fee-waiver", null),
      ];
      expect(
        await h.services().versions.compare(await h.as("maya"), {
          templateId: h.templates["annual-fee-waiver"]!,
          from: v1.id,
          to: draft.id,
        }),
      ).toMatchObject({
        ok: true,
        to: { id: draft.id, number: null, round: null, state: "draft" },
      });
    });

    it("refuses, in order: 400 for an id missing or malformed, 404 and 403 for the template, 404 for a version that isn't its", async () => {
      const templateId = h.templates["cash-back"]!;
      const v1 = await row("cash-back", 1);
      const maya = await h.as("maya");
      for (const [from, to] of [
        [null, null],
        [v1.id, null],
        [v1.id, ""],
        [v1.id, "v".repeat(65)],
      ])
        expect(
          await h.services().versions.compare(maya, { templateId, from, to }),
        ).toMatchObject({
          ok: false,
          status: 400,
          code: REQUEST_REFUSALS.templateUnavailable.code,
        });
      const other = await row("balance-transfer", 2);
      expect(
        await h.services().versions.compare(maya, {
          templateId: "UC-ZZZZZZ",
          from: v1.id,
          to: other.id,
        }),
      ).toMatchObject({ ok: false, status: 404 });
      expect(
        await h.services().versions.compare(await h.as("morgan"), {
          templateId,
          from: v1.id,
          to: other.id,
        }),
      ).toMatchObject({
        ok: false,
        status: 403,
        code: REQUEST_REFUSALS.templateUnavailable.code,
      });
      expect(
        await h.services().versions.compare(maya, {
          templateId,
          from: v1.id,
          to: other.id,
        }),
      ).toMatchObject({
        ok: false,
        status: 404,
        code: REQUEST_REFUSALS.versionUnavailable.code,
      });
    });
  });

  describe("versions.baseVersion", () => {
    it("reads the content of the version the draft on screen was started from", async () => {
      const [v1, draft] = [
        await row("annual-fee-waiver", 1),
        await row("annual-fee-waiver", null),
      ];
      const base = await h.services().versions.baseVersion(await h.as("maya"), {
        templateId: h.templates["annual-fee-waiver"]!,
        versionId: draft.id,
      });
      expect(base).toMatchObject({
        ok: true,
        base: { number: 1, round: 1, state: "changes_requested" },
      });
      if (!base.ok) throw new Error(base.code);
      // Every field of every channel, by id: null when the version has none.
      expect(base.base).toHaveProperty(["email.subject"]);
      expect(v1.state).toBe("changes_requested");
    });

    it("refuses, in order: 400 for an id missing or malformed, 404 for the template, 403 to someone who may not edit, then 404 and 409 for a version that isn't an open draft of it", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      const [v1, draft] = [
        await row("annual-fee-waiver", 1),
        await row("annual-fee-waiver", null),
      ];
      const maya = await h.as("maya");
      for (const versionId of [null, "", "v".repeat(65)])
        expect(
          await h
            .services()
            .versions.baseVersion(maya, { templateId, versionId }),
        ).toMatchObject({
          ok: false,
          status: 400,
          code: REQUEST_REFUSALS.templateUnavailable.code,
        });
      expect(
        await h.services().versions.baseVersion(maya, {
          templateId: "UC-ZZZZZZ",
          versionId: draft.id,
        }),
      ).toMatchObject({
        ok: false,
        status: 404,
        code: REQUEST_REFUSALS.templateUnavailable.code,
      });
      for (const userId of ["sam", "eli", "morgan"])
        expect(
          await h.services().versions.baseVersion(await h.as(userId), {
            templateId,
            versionId: draft.id,
          }),
          userId,
        ).toMatchObject({ ok: false, status: 403 });
      expect(
        await h.services().versions.baseVersion(maya, {
          templateId: h.templates["cash-back"]!,
          versionId: draft.id,
        }),
        "a draft of another template",
      ).toMatchObject({
        ok: false,
        status: 404,
        code: REQUEST_REFUSALS.noDraftToRevert.code,
      });
      expect(
        await h.services().versions.baseVersion(maya, {
          templateId,
          versionId: v1.id,
        }),
        "not a draft any more",
      ).toMatchObject({
        ok: false,
        status: 409,
        code: REQUEST_REFUSALS.noDraftToRevert.code,
      });
    });
  });
}
