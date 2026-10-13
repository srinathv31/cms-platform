import { describe, expect, it } from "vitest";
import { COMMENT_REFUSALS } from "@/domain/comments";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { ContractHarness } from "./harness";

// A template's workspace, as every implementation must answer it (`TemplateService.workspaceHeader` and
// `.workspaceDocument` in src/server/services/templates.ts), read from the seed:
//   - Annual Fee Waiver: v1 sent back by Jordan, and Maya's open draft started from it (with its threads);
//   - Cash Back: v3 in review on round 2, v2 Active; Balance Transfer: v2 Active (it adds an optional
//     `offer_end_date`), v1 Superseded and still rendering until its sunset on October 25;
//   - Rate Change Notice: v1, decided; Card Used Abroad: an alert, v1 in review.
// Maya is an Author on Coral Offers, Jordan and Alex Approvers, Sam a Viewer; Eli is on Deposits only. A case
// that acts (a revoke, Edit, a submit) sets the backend's clock first and compares the reads before and after.
// Refusals are compared by code.

const CORAL = "t_coral";

export function workspaceContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);

  async function headerOf(userId: string, templateKey: string) {
    const header = await h
      .services()
      .templates.workspaceHeader(await h.as(userId), {
        templateId: h.templates[templateKey]!,
      });
    if (!header.ok) throw new Error(header.code);
    return header;
  }

  async function documentOf(userId: string, templateKey: string) {
    const document = await h
      .services()
      .templates.workspaceDocument(await h.as(userId), {
        templateId: h.templates[templateKey]!,
      });
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

  /** A version's name and content, as Compare reads it. */
  async function contentOf(templateId: string, versionId: string) {
    const pair = await h.services().versions.compare(await h.as("taylor"), {
      templateId,
      from: versionId,
      to: versionId,
    });
    if (!pair.ok) throw new Error(pair.code);
    const { name, body, variables, channels, channelFields, smsFooter } =
      pair.to;
    return { name, body, variables, channels, channelFields, smsFooter };
  }

  /** Revokes a version at minutes 1 and 2: Jordan starts it, Alex confirms it. */
  async function revoke(templateId: string, versionNumber: number) {
    h.setClock(minute(1));
    expect(
      await h.services().review.startRevoke(await h.as("jordan"), {
        templateId,
        versionNumber,
        reason: "Wrong APR in the legal notices.",
      }),
    ).toEqual({ ok: true });
    h.setClock(minute(2));
    expect(
      await h.services().review.confirmRevoke(await h.as("alex"), {
        templateId,
        versionNumber,
      }),
    ).toEqual({ ok: true });
  }

  /** Edit, as Maya: opens a draft of the template; it must open one. */
  async function edit(templateId: string) {
    expect(
      await h
        .services()
        .templates.startDraft(await h.as("maya"), { templateId }),
    ).toMatchObject({ ok: true, changed: true });
  }

  describe("templates.workspaceHeader", () => {
    it("shows Annual Fee Waiver's open draft, numbered as its submit will number it, based on v1 sent back", async () => {
      const header = await headerOf("maya", "annual-fee-waiver");
      expect(header.asOf).toBe(base.toISOString());
      expect(header.template).toMatchObject({
        id: h.templates["annual-fee-waiver"],
        teamId: CORAL,
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
      });
      expect(header.shown).toMatchObject({
        number: null,
        round: null,
        state: "draft",
        sunsetDay: null,
        sunsetPassed: false,
        rev: expect.any(Number),
      });
      expect(header.numbered).toEqual({ number: 1, round: 2 });
      expect(header.basedOn).toEqual({
        number: 1,
        round: 1,
        state: "changes_requested",
      });
      expect(header.active).toBeNull();
      expect(header.inReview).toBeNull();
      expect(header.can).toEqual({
        edit: { ok: true },
        startDraft: { ok: true },
        submit: { ok: true },
      });
    });

    it("says why a viewer may do nothing, and an approver may not submit", async () => {
      const viewer = await headerOf("sam", "annual-fee-waiver");
      expect(viewer.can).toMatchObject({
        edit: { ok: false, code: REASONS.generic.code },
        startDraft: { ok: false, code: REASONS.generic.code },
        submit: { ok: false, code: REASONS.generic.code },
      });
      const approver = await headerOf("jordan", "annual-fee-waiver");
      expect(approver.can.submit).toMatchObject({ ok: false });
      expect(approver.can.edit).toMatchObject({ ok: false });
    });

    it("shows Cash Back's round in review, with nothing to submit and Edit blocked by it", async () => {
      const header = await headerOf("maya", "cash-back");
      expect(header.shown).toMatchObject({
        number: 3,
        round: 2,
        state: "in_review",
        name: "Cash Back Welcome Bonus — Terms",
      });
      expect(header.numbered).toEqual({ number: 3, round: 2 });
      expect(header.basedOn).toBeNull();
      expect(header.active).toEqual({
        number: 2,
        name: expect.any(String),
      });
      expect(header.inReview).toEqual({
        number: 3,
        round: 2,
        state: "in_review",
      });
      expect(header.can).toMatchObject({
        edit: { ok: true },
        startDraft: { ok: false, code: REFUSALS.newerInReview.code },
        submit: { ok: false, code: REQUEST_REFUSALS.noDraftToSubmit.code },
      });
    });

    it("offers Edit on a live template", async () => {
      const header = await headerOf("maya", "balance-transfer");
      expect(header.shown).toMatchObject({ number: 2, state: "active" });
      expect(header.active).toMatchObject({ number: 2 });
      expect(header.can.startDraft).toEqual({ ok: true });
    });

    it("reads a template the viewer can't see exactly as one that doesn't exist", async () => {
      const unavailable = {
        ok: false,
        status: 404,
        code: REQUEST_REFUSALS.templateUnavailable.code,
      };
      for (const [userId, templateId] of [
        ["eli", h.templates["cash-back"]!],
        ["maya", "UC-ZZZZZZ"],
      ] as const) {
        const ctx = await h.as(userId);
        expect(
          await h.services().templates.workspaceHeader(ctx, { templateId }),
        ).toMatchObject(unavailable);
        expect(
          await h.services().templates.workspaceDocument(ctx, { templateId }),
        ).toMatchObject(unavailable);
      }
    });
  });

  describe("templates.workspaceDocument", () => {
    it("shows Annual Fee Waiver's open draft with its margin's threads, which its authors and approvers may comment on", async () => {
      const document = await documentOf("maya", "annual-fee-waiver");
      expect(document.asOf).toBe(base.toISOString());
      expect(document.template).toMatchObject({
        id: h.templates["annual-fee-waiver"],
        teamId: CORAL,
        teamName: "Coral Offers",
        family: "document",
      });
      expect(document.version).toMatchObject({
        number: null,
        round: null,
        state: "draft",
        rev: expect.any(Number),
      });
      expect(document.threads.map((t) => [t.blockId, t.status])).toEqual([
        [DOCUMENT_THREAD, "open"],
        [expect.any(String), "resolved"],
      ]);
      expect(document.can).toEqual({
        edit: { ok: true },
        comment: { ok: true },
      });
      expect(document.importOriginal).toBeNull();
      expect(document.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(["maya", "jordan"]),
      );
      expect((await documentOf("jordan", "annual-fee-waiver")).can).toEqual({
        edit: {
          ok: false,
          code: expect.any(String),
          reason: expect.any(String),
        },
        comment: { ok: true },
      });
      expect(
        (await documentOf("sam", "annual-fee-waiver")).can.comment,
      ).toMatchObject({ ok: false, code: REASONS.generic.code });
    });

    it("on a draft, gives the variables of the version that still renders; on a submitted version, none", async () => {
      // Balance Transfer has no draft: its latest is v2, Active.
      const templateId = h.templates["balance-transfer"]!;
      const live = await documentOf("maya", "balance-transfer");
      expect(live.version).toMatchObject({ number: 2, round: 1 });
      expect(live.baseline).toBeNull();

      h.setClock(minute(1));
      await edit(templateId);
      const draft = await documentOf("maya", "balance-transfer");
      expect(draft.version.state).toBe("draft");
      expect(draft.baseline).toEqual(
        (await contentOf(templateId, live.version.id)).variables,
      );
    });

    it("lets nobody comment on a template whose latest version has been decided", async () => {
      const document = await documentOf("maya", "rate-change-notice");
      expect(document.version.number).toBe(1);
      expect(document.can.comment).toMatchObject({
        ok: false,
        code: COMMENT_REFUSALS.closed.code,
      });
    });

    it("carries an alert's family and the SMS footer its version prints", async () => {
      const alert = await documentOf("priya", "card-used-abroad");
      expect(alert.template.family).toBe("message");
      expect(alert.template.allowedChannels.length).toBeGreaterThan(0);
      expect(alert.messageRules.smsFooter).toEqual(expect.any(String));
    });
  });

  // Balance Transfer's Active v2 is revoked (handoff review D1): nothing is Active, and v1 still renders.
  describe("after the Active version is revoked", () => {
    it("shows the revoked version with nothing Active and offers Edit, whose corrected draft is the revoked text, numbered next; once that is approved it is Active", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const v2 = await rowOf(templateId, 2);
      await revoke(templateId, 2);
      const revoked = await headerOf("maya", "balance-transfer");
      expect(revoked.shown).toMatchObject({
        id: v2.id,
        number: 2,
        round: 1,
        state: "revoked",
      });
      expect([revoked.active, revoked.inReview, revoked.basedOn]).toEqual([
        null,
        null,
        null,
      ]);
      expect(revoked.can.startDraft).toEqual({ ok: true });
      expect(
        (await headerOf("sam", "balance-transfer")).can.startDraft,
        "a viewer can't edit",
      ).toMatchObject({ ok: false, code: REASONS.generic.code });

      h.setClock(minute(3));
      await edit(templateId);
      const draft = await headerOf("maya", "balance-transfer");
      expect(draft.shown).toMatchObject({
        number: null,
        round: null,
        state: "draft",
      });
      expect(draft.basedOn).toEqual({ number: 2, round: 1, state: "revoked" });
      expect(draft.numbered).toEqual({ number: 3, round: 1 });
      expect(draft.active).toBeNull();
      expect(await contentOf(templateId, draft.shown!.id)).toEqual(
        await contentOf(templateId, v2.id),
      );
      expect((await rowOf(templateId, 2)).state, "it stays revoked").toBe(
        "revoked",
      );

      h.setClock(minute(4));
      expect(
        await h.services().review.submit(await h.as("maya"), {
          templateId,
          rev: draft.shown!.rev,
        }),
      ).toEqual({ ok: true, number: 3, round: 1 });
      h.setClock(minute(5));
      expect(
        await h.services().review.approve(await h.as("jordan"), {
          templateId,
          versionNumber: 3,
          round: 1,
          outputsViewed: ["pdf", "web"],
          sampleSetsSeen: [],
        }),
      ).toMatchObject({ ok: true, wentLive: true });
      const live = await headerOf("maya", "balance-transfer");
      expect(live.shown).toMatchObject({ number: 3, state: "active" });
      expect(live.active).toMatchObject({ number: 3 });
      expect(live.can.startDraft).toEqual({ ok: true });
    });

    it("compares the corrected draft's variables with the newest version that still renders, and with nothing once none does", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const v1 = await rowOf(templateId, 1);
      await revoke(templateId, 2);
      h.setClock(minute(3));
      await edit(templateId);
      const document = await documentOf("maya", "balance-transfer");
      // v1 lacks the optional offer_end_date that v2, and so the draft, has.
      expect(document.baseline).toEqual(
        (await contentOf(templateId, v1.id)).variables,
      );
      expect(document.baseline!.map((v) => v.key)).not.toContain(
        "offer_end_date",
      );
      expect(document.version.variables.map((v) => v.key)).toContain(
        "offer_end_date",
      );

      // At v1's sunset nothing renders: no baseline, as for a first version.
      h.setClock(new Date(v1.sunsetAt!));
      expect(
        (await documentOf("maya", "balance-transfer")).baseline,
      ).toBeNull();
    });
  });
}
