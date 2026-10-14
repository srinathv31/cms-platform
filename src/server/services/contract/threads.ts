import { describe, expect, it } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { ContractHarness } from "./harness";

// Review threads, as every implementation must answer them (`CommentService.threads` in
// src/server/services/comments.ts), read from the seed:
//   - Annual Fee Waiver: v1 sent back by Jordan (his change request, an open thread about the whole version) and
//     an open draft started from it; a thread Jordan began on v1 that Maya resolved;
//   - Cash Back: v3 in review on round 2, after Jordan sent round 1 back (his change request, resolved);
//     v2 Active.
// Maya is an Author on Coral Offers, Jordan an Approver; Eli is on Deposits only. Refusals are compared by code.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function threadsContract(h: ContractHarness) {
  /** A version row's id, from the Versions read: a number's round, or the open draft (number null). */
  async function versionId(
    templateId: string,
    number: number | null,
    round?: number,
  ) {
    const history = await h
      .services()
      .versions.history(await h.as("jordan"), { templateId });
    if (!history.ok) throw new Error(history.code);
    const row = history.versions.find(
      (v) =>
        v.number === number &&
        (round === undefined ? v.head : v.round === round),
    );
    if (!row) throw new Error(`No version ${number} of ${templateId}.`);
    return row.id;
  }

  async function threadsOf(
    templateId: string,
    versionId?: string,
    userId = "maya",
  ) {
    const threads = await h
      .services()
      .comments.threads(await h.as(userId), { templateId, versionId });
    if (!threads.ok) throw new Error(threads.code);
    return threads;
  }

  describe("comments.threads", () => {
    it("shows the Annual Fee Waiver threads against its open draft: the change request first, then by block", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      const draft = await versionId(templateId, null);
      const read = await threadsOf(templateId);
      expect(read.template).toEqual({ id: templateId, teamId: "t_coral" });
      expect(read.versionId, "the workspace's: the open draft").toBe(draft);
      expect(read.threads).toHaveLength(2);
      const [request, resolved] = read.threads;
      expect(request).toMatchObject({
        blockId: DOCUMENT_THREAD,
        quote: null,
        status: "open",
        origin: { number: 1, round: 1, state: "changes_requested" },
        resolvedBy: null,
        resolvedAt: null,
        orphaned: false,
      });
      expect(request!.comments[0]).toMatchObject({
        authorId: "jordan",
        kind: "change_request",
        createdAt: expect.stringMatching(ISO),
      });
      expect(resolved).toMatchObject({
        quote: "after your first year",
        status: "resolved",
        resolvedBy: "maya",
        resolvedAt: expect.stringMatching(ISO),
        orphaned: false,
      });
      expect(resolved!.comments.map((c) => c.authorId)).toEqual([
        "jordan",
        "maya",
      ]);
      expect(read.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(["jordan", "maya"]),
      );
      // The draft named by its id reads the same.
      expect((await threadsOf(templateId, draft)).threads).toEqual(
        read.threads,
      );
    });

    it("shows a submitted round only the threads that began by it", async () => {
      const templateId = h.templates["cash-back"]!;
      const [round1, round2, v2] = await Promise.all([
        versionId(templateId, 3, 1),
        versionId(templateId, 3, 2),
        versionId(templateId, 2),
      ]);
      const requests = async (id: string) =>
        (await threadsOf(templateId, id, "jordan")).threads
          .filter((t) => t.comments[0]?.kind === "change_request")
          .map((t) => [t.origin?.number, t.origin?.round, t.status]);
      expect(await requests(round1)).toEqual([[3, 1, "resolved"]]);
      expect(await requests(round2)).toEqual([[3, 1, "resolved"]]);
      expect(await requests(v2), "v2's record is older than v3").toEqual([]);
    });

    it("refuses a template the viewer can't see as one that doesn't exist, then a version that isn't the template's", async () => {
      const templateId = h.templates["annual-fee-waiver"]!;
      for (const [userId, id] of [
        ["eli", templateId],
        ["maya", "UC-ZZZZZZ"],
      ] as const)
        expect(
          await h
            .services()
            .comments.threads(await h.as(userId), { templateId: id }),
        ).toMatchObject({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.templateUnavailable.code,
        });
      const other = await versionId(h.templates["cash-back"]!, 2);
      expect(
        await h.services().comments.threads(await h.as("maya"), {
          templateId,
          versionId: other,
        }),
      ).toMatchObject({
        ok: false,
        status: 404,
        code: REQUEST_REFUSALS.versionUnavailable.code,
      });
    });
  });
}
