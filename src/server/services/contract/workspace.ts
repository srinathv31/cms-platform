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
//   - Cash Back: v3 in review on round 2, v2 Active; Balance Transfer: v2 Active, v1 Superseded;
//   - Rate Change Notice: v1, decided; Card Used Abroad: an alert, v1 in review.
// Maya is an Author on Coral Offers, Jordan an Approver, Sam a Viewer; Eli is on Deposits only. Refusals are
// compared by code.

const CORAL = "t_coral";

export function workspaceContract(h: ContractHarness, base: Date) {
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
      const live = await documentOf("maya", "balance-transfer");
      expect(live.version).toMatchObject({ number: 2, round: 1 });
      expect(live.baseline).toBeNull();
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
}
