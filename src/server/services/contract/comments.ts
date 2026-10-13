import { describe, expect, it } from "vitest";
import { COMMENT_MAX, COMMENT_REFUSALS } from "@/domain/comments";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { ContractHarness } from "./harness";

// Review comments, as every implementation must show them (CommentService in src/server/services/comments.ts).
// Cases act through the services, from the seed: Cash Back v3 round 2 is in review (submitted by Maya, who is an
// author on Coral Offers, with Jordan and Alex approving there), Annual Fee Waiver has Maya's open draft and two
// threads on its sent-back v1, Balance Transfer has an Active v2 with a resolved thread and nothing in review, so
// no version of it takes comments. Sam is a viewer on Coral and Eli an author on Deposits.
//
// Each case sets the backend's clock, then compares what the reads and the probe show before and after. A refusal
// is checked by its code: the sentence is the BFF's.

export function commentsContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);

  /** A template's threads as the probe shows them now. */
  const threadsOf = (key: string) =>
    h.probe.threads({ templateId: h.templates[key]! });

  /** The bell's rows now, newest first. */
  async function bellOf(userId: string) {
    const bell = await h
      .services()
      .notifications.list(await h.as(userId), { limit: 100 });
    if (!bell.ok) throw new Error(bell.code);
    return bell.items;
  }

  /** The rows in `after` that `before` didn't have (the bell lists newest first). */
  const told = <T extends { id: string }>(
    before: readonly T[],
    after: readonly T[],
  ) => after.filter((n) => !before.some((b) => b.id === n.id));

  /** What a comment can have written about a template: its threads, its audit rows, and the people's bells. */
  async function written(key: string, people: readonly string[]) {
    const templateId = h.templates[key]!;
    return {
      threads: await threadsOf(key),
      audit: (await h.probe.template({ templateId }))!.audit,
      bells: Object.fromEntries(
        await Promise.all(
          people.map(async (userId) => [userId, await bellOf(userId)] as const),
        ),
      ),
    };
  }

  /** A template's version rows as the probe shows them, by state. */
  async function versionIn(key: string, state: string) {
    const rows = (await h.probe.template({ templateId: h.templates[key]! }))!
      .versions;
    return rows.find((v) => v.state === state)!;
  }

  /** The id of the n-th top-level block of a version. */
  const blockAt = (
    body: { content?: { attrs?: Record<string, unknown> }[] },
    n: number,
  ) => String(body.content?.[n]?.attrs?.id);

  /** Jordan starts a thread on a block of Cash Back v3 (round 2); returns it. */
  async function threadOnCashBack(at = minute(1)) {
    const v3 = await versionIn("cash-back", "in_review");
    h.setClock(at);
    const result = await h.services().comments.add(await h.as("jordan"), {
      templateId: h.templates["cash-back"]!,
      versionId: v3.id,
      blockId: blockAt(v3.body, 1),
      quote: "  spend $1,000  ",
      body: "  Is the $1,000 threshold still right?  ",
    });
    if (!result.ok)
      throw new Error(`could not start the thread: ${result.code}`);
    return { threadId: result.threadId, v3 };
  }

  describe("comments.add", () => {
    it("starts a thread on a block of a version in review, dated by the backend's clock, and tells the version's author", async () => {
      const templateId = h.templates["cash-back"]!;
      const v3 = await versionIn("cash-back", "in_review");
      const blockId = blockAt(v3.body, 1);
      const before = await written("cash-back", ["maya", "jordan"]);

      h.setClock(minute(1));
      const result = await h.services().comments.add(await h.as("jordan"), {
        templateId,
        versionId: v3.id,
        blockId,
        quote: "  spend $1,000  ",
        body: "  Is the $1,000 threshold still right?  ",
      });
      expect(result).toEqual({
        ok: true,
        threadId: expect.stringMatching(/^th_/),
      });
      if (!result.ok) return;

      const after = await written("cash-back", ["maya", "jordan"]);
      expect(after.threads.slice(before.threads.length)).toEqual([
        {
          id: result.threadId,
          originVersionId: v3.id,
          blockId,
          quote: "spend $1,000",
          status: "open",
          resolvedBy: null,
          resolvedAt: null,
          createdAt: minute(1).toISOString(),
          comments: [
            {
              authorId: "jordan",
              body: "Is the $1,000 threshold still right?",
              kind: "comment",
              at: minute(1).toISOString(),
            },
          ],
        },
      ]);
      expect(after.audit.slice(before.audit.length)).toEqual([
        {
          action: "comment.added",
          at: minute(1).toISOString(),
          actorId: "jordan",
          teamId: "t_coral",
          templateId,
          versionId: v3.id,
          details: {
            threadId: result.threadId,
            blockId,
            number: 3,
            round: 2,
            quote: "spend $1,000",
          },
        },
      ]);
      // Maya, who submitted it, is told, with a link to the round's review; Jordan, who wrote it, isn't.
      expect(told(before.bells.maya!, after.bells.maya!)).toEqual([
        {
          id: expect.any(String),
          kind: "comment_added",
          facts: {
            actorName: "Jordan Ellis",
            templateName: v3.name,
            number: 3,
            round: 2,
            state: "in_review",
            reply: false,
          },
          link: {
            to: "review",
            teamId: "t_coral",
            templateId,
            versionNumber: 3,
            round: 2,
          },
          body: "Is the $1,000 threshold still right?",
          createdAt: minute(1).toISOString(),
          readAt: null,
        },
      ]);
      expect(told(before.bells.jordan!, after.bells.jordan!)).toEqual([]);
    });

    it("takes a thread about the whole version, and any block id on a draft, whose author is told with a link to the template", async () => {
      const cashBack = await versionIn("cash-back", "in_review");
      h.setClock(minute(1));
      expect(
        await h.services().comments.add(await h.as("alex"), {
          templateId: h.templates["cash-back"]!,
          versionId: cashBack.id,
          blockId: DOCUMENT_THREAD,
          body: "Overall fine.",
        }),
      ).toMatchObject({ ok: true });

      const templateId = h.templates["annual-fee-waiver"]!;
      const draft = await versionIn("annual-fee-waiver", "draft");
      const before = await bellOf("maya");
      h.setClock(minute(2));
      expect(
        await h.services().comments.add(await h.as("jordan"), {
          templateId,
          versionId: draft.id,
          blockId: "not_saved_yet",
          body: "Hm.",
        }),
      ).toMatchObject({ ok: true });
      expect(told(before, await bellOf("maya"))).toEqual([
        expect.objectContaining({
          kind: "comment_added",
          facts: expect.objectContaining({
            actorName: "Jordan Ellis",
            number: null,
            round: null,
            state: "draft",
          }),
          link: { to: "template", teamId: "t_coral", templateId },
        }),
      ]);
    });

    it("takes a thread on a field of an alert in review, and not on a field of a channel it doesn't have", async () => {
      const templateId = h.templates["card-used-abroad"]!;
      const alert = await versionIn("card-used-abroad", "in_review");
      h.setClock(minute(1));
      const field = await h.services().comments.add(await h.as("jordan"), {
        templateId,
        versionId: alert.id,
        blockId: "push.title",
        body: "Too vague?",
      });
      expect(field).toMatchObject({ ok: true });
      expect(await threadsOf("card-used-abroad")).toContainEqual(
        expect.objectContaining({ blockId: "push.title", quote: null }),
      );
      expect(
        await h.services().comments.add(await h.as("jordan"), {
          templateId,
          versionId: alert.id,
          blockId: "email.subject",
          body: "x",
        }),
      ).toMatchObject({ ok: false, code: COMMENT_REFUSALS.noBlock.code });
    });

    it("refuses an unknown block on a version in review, an empty or too long comment, and a version of another template, writing nothing", async () => {
      const v3 = await versionIn("cash-back", "in_review");
      const jordan = await h.as("jordan");
      const before = await written("cash-back", ["maya"]);
      const add = (over: {
        templateId?: string;
        blockId?: string;
        body?: string;
      }) =>
        h.services().comments.add(jordan, {
          templateId: over.templateId ?? h.templates["cash-back"]!,
          versionId: v3.id,
          blockId: over.blockId ?? DOCUMENT_THREAD,
          body: over.body ?? "x",
        });
      h.setClock(minute(1));
      expect(await add({ blockId: "nope" })).toMatchObject({
        ok: false,
        code: COMMENT_REFUSALS.noBlock.code,
      });
      expect(await add({ body: "  " })).toMatchObject({
        ok: false,
        code: COMMENT_REFUSALS.empty.code,
      });
      expect(await add({ body: "x".repeat(COMMENT_MAX + 1) })).toMatchObject({
        ok: false,
        code: COMMENT_REFUSALS.tooLong.code,
      });
      // A version that isn't the template's is refused like one the viewer may not comment on.
      expect(
        await add({ templateId: h.templates["balance-transfer"]! }),
      ).toMatchObject({ ok: false, code: "generic" });
      expect(await written("cash-back", ["maya"])).toEqual(before);
    });

    it("refuses a comment on a version that is decided: Active, Superseded, Revoked or sent back", async () => {
      const history = async (key: string) => {
        const read = await h.services().versions.history(await h.as("maya"), {
          templateId: h.templates[key]!,
        });
        if (!read.ok) throw new Error(read.code);
        return read.versions;
      };
      for (const [key, number, state] of [
        ["cash-back", 2, "active"],
        ["balance-transfer", 1, "superseded"],
        ["holiday-points", 1, "revoked"],
        ["annual-fee-waiver", 1, "changes_requested"],
      ] as const) {
        const version = (await history(key)).find(
          (v) => v.number === number && v.head,
        )!;
        expect(version.state).toBe(state);
        const before = await written(key, ["maya", "jordan"]);
        h.setClock(minute(1));
        expect(
          await h.services().comments.add(await h.as("maya"), {
            templateId: h.templates[key]!,
            versionId: version.id,
            blockId: DOCUMENT_THREAD,
            body: "x",
          }),
          `${key} v${number}`,
        ).toMatchObject({ ok: false, code: COMMENT_REFUSALS.closed.code });
        expect(await written(key, ["maya", "jordan"]), key).toEqual(before);
      }
    });

    it("refuses someone who can't comment on the team, and a version that isn't there, with the permission refusal", async () => {
      const v3 = await versionIn("cash-back", "in_review");
      const before = await written("cash-back", ["maya"]);
      for (const userId of ["sam", "eli"])
        expect(
          await h.services().comments.add(await h.as(userId), {
            templateId: h.templates["cash-back"]!,
            versionId: v3.id,
            blockId: DOCUMENT_THREAD,
            body: "x",
          }),
          userId,
        ).toMatchObject({ ok: false, code: "generic" });
      expect(
        await h.services().comments.add(await h.as("jordan"), {
          templateId: h.templates["cash-back"]!,
          versionId: "v_missing",
          blockId: DOCUMENT_THREAD,
          body: "x",
        }),
      ).toMatchObject({ ok: false, code: "generic" });
      expect(await written("cash-back", ["maya"])).toEqual(before);
    });
  });

  describe("comments.reply", () => {
    it("adds a comment to the thread and tells the others who wrote in it, never the one replying", async () => {
      const { threadId, v3 } = await threadOnCashBack();
      const before = await written("cash-back", ["maya", "jordan"]);

      h.setClock(minute(2));
      expect(
        await h.services().comments.reply(await h.as("maya"), {
          threadId,
          body: "  Yes, confirmed with Product.  ",
        }),
      ).toEqual({ ok: true });

      const after = await written("cash-back", ["maya", "jordan"]);
      const thread = after.threads.find((t) => t.id === threadId)!;
      expect(thread.comments.slice(1)).toEqual([
        {
          authorId: "maya",
          body: "Yes, confirmed with Product.",
          kind: "comment",
          at: minute(2).toISOString(),
        },
      ]);
      // A reply doesn't reopen or resolve anything.
      expect(thread.status).toBe("open");
      expect(after.audit.slice(before.audit.length)).toEqual([
        expect.objectContaining({
          action: "comment.added",
          at: minute(2).toISOString(),
          actorId: "maya",
          versionId: v3.id,
          details: expect.objectContaining({
            threadId,
            reply: true,
            number: 3,
            round: 2,
          }),
        }),
      ]);
      // Jordan wrote in the thread, so he is told; Maya wrote the reply, so she isn't.
      expect(told(before.bells.jordan!, after.bells.jordan!)).toEqual([
        expect.objectContaining({
          kind: "comment_added",
          facts: expect.objectContaining({
            actorName: "Maya Chen",
            reply: true,
          }),
          body: "Yes, confirmed with Product.",
        }),
      ]);
      expect(told(before.bells.maya!, after.bells.maya!)).toEqual([]);
    });

    it("answers a thread on a sent-back version while the template has an open draft, to a resolved thread too", async () => {
      // Annual Fee Waiver: Maya's draft shows v1's threads, one open and one resolved.
      const threads = await threadsOf("annual-fee-waiver");
      expect(threads.map((t) => t.status).sort()).toEqual(["open", "resolved"]);
      for (const [n, thread] of threads.entries()) {
        const before = thread.comments.length;
        h.setClock(minute(n + 1));
        expect(
          await h.services().comments.reply(await h.as("maya"), {
            threadId: thread.id,
            body: "Done.",
          }),
          thread.status,
        ).toEqual({ ok: true });
        const after = (await threadsOf("annual-fee-waiver")).find(
          (t) => t.id === thread.id,
        )!;
        expect(after.comments).toHaveLength(before + 1);
        // A reply doesn't change the thread's status.
        expect(after.status).toBe(thread.status);
      }
    });

    it("refuses, writing nothing: a thread no version of the template shows the viewer, an empty comment, someone who can't comment, an unknown thread", async () => {
      // Balance Transfer has an Active v2, no draft and nothing in review: nothing takes comments.
      const [closed] = await threadsOf("balance-transfer");
      const [open] = (await threadsOf("annual-fee-waiver")).filter(
        (t) => t.status === "open",
      );
      const people = ["maya", "jordan"];
      const before = {
        balanceTransfer: await written("balance-transfer", people),
        annualFeeWaiver: await written("annual-fee-waiver", people),
      };
      const reply = async (userId: string, threadId: string, body = "x") =>
        h.services().comments.reply(await h.as(userId), { threadId, body });

      h.setClock(minute(1));
      expect(await reply("maya", closed!.id)).toMatchObject({
        ok: false,
        code: COMMENT_REFUSALS.closed.code,
      });
      expect(await reply("maya", open!.id, "  ")).toMatchObject({
        ok: false,
        code: COMMENT_REFUSALS.empty.code,
      });
      expect(
        await reply("maya", open!.id, "x".repeat(COMMENT_MAX + 1)),
      ).toMatchObject({ ok: false, code: COMMENT_REFUSALS.tooLong.code });
      for (const userId of ["sam", "eli"])
        expect(await reply(userId, open!.id), userId).toMatchObject({
          ok: false,
          code: "generic",
        });
      expect(await reply("maya", "th_missing")).toMatchObject({
        ok: false,
        code: "generic",
      });
      expect({
        balanceTransfer: await written("balance-transfer", people),
        annualFeeWaiver: await written("annual-fee-waiver", people),
      }).toEqual(before);
    });
  });

  describe("comments.resolve and comments.reopen", () => {
    it("resolves an open thread, records who and when, and a second resolve writes nothing; reopening clears who resolved it", async () => {
      const { threadId } = await threadOnCashBack();
      const before = await written("cash-back", ["jordan"]);

      h.setClock(minute(2));
      expect(
        await h.services().comments.resolve(await h.as("maya"), { threadId }),
      ).toEqual({ ok: true, changed: true });
      const resolved = await written("cash-back", ["jordan"]);
      expect(resolved.threads.find((t) => t.id === threadId)).toMatchObject({
        status: "resolved",
        resolvedBy: "maya",
        resolvedAt: minute(2).toISOString(),
      });
      expect(resolved.audit.slice(before.audit.length)).toEqual([
        expect.objectContaining({
          action: "thread.resolved",
          at: minute(2).toISOString(),
          actorId: "maya",
          details: expect.objectContaining({ threadId, number: 3, round: 2 }),
        }),
      ]);

      // A second click, or a second person: the thread is as asked, and nothing is written.
      h.setClock(minute(3));
      expect(
        await h.services().comments.resolve(await h.as("jordan"), { threadId }),
      ).toEqual({ ok: true, changed: false });
      expect(await written("cash-back", ["jordan"])).toEqual(resolved);

      h.setClock(minute(4));
      expect(
        await h.services().comments.reopen(await h.as("jordan"), { threadId }),
      ).toEqual({ ok: true, changed: true });
      const reopened = await written("cash-back", ["jordan"]);
      expect(reopened.threads.find((t) => t.id === threadId)).toMatchObject({
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
      });
      expect(reopened.audit.slice(resolved.audit.length)).toEqual([
        expect.objectContaining({
          action: "thread.reopened",
          at: minute(4).toISOString(),
          actorId: "jordan",
        }),
      ]);
      h.setClock(minute(5));
      expect(
        await h.services().comments.reopen(await h.as("maya"), { threadId }),
      ).toEqual({ ok: true, changed: false });
      expect(await written("cash-back", ["jordan"])).toEqual(reopened);
    });

    it("finds nothing to change when another writer moves the thread first (a compare-and-set on its status)", async () => {
      const { threadId } = await threadOnCashBack();
      const before = await written("cash-back", ["jordan"]);
      h.hooks({
        beforeCompareAndSet: (target) =>
          target.table === "comment_threads" && target.id === threadId
            ? "competing_write"
            : undefined,
      });

      h.setClock(minute(2));
      expect(
        await h.services().comments.resolve(await h.as("maya"), { threadId }),
      ).toEqual({ ok: true, changed: false });

      // The competing writer's resolve stands; this one wrote no second audit row and told no one.
      const after = await written("cash-back", ["jordan"]);
      expect(after.threads.find((t) => t.id === threadId)?.status).toBe(
        "resolved",
      );
      expect(after.audit).toEqual(before.audit);
      expect(after.bells).toEqual(before.bells);
    });

    it("refuses the permission refusal to someone who can't comment, and `comments_closed` where no version of the template takes comments", async () => {
      const [closed] = await threadsOf("balance-transfer");
      const [open] = (await threadsOf("annual-fee-waiver")).filter(
        (t) => t.status === "open",
      );
      const before = {
        balanceTransfer: await written("balance-transfer", ["maya"]),
        annualFeeWaiver: await written("annual-fee-waiver", ["maya"]),
      };
      h.setClock(minute(1));
      for (const userId of ["sam", "eli"]) {
        const ctx = await h.as(userId);
        for (const act of [
          h.services().comments.resolve(ctx, { threadId: open!.id }),
          h.services().comments.reopen(ctx, { threadId: open!.id }),
        ])
          expect(await act, userId).toMatchObject({
            ok: false,
            code: "generic",
          });
      }
      const maya = await h.as("maya");
      expect(
        await h.services().comments.resolve(maya, { threadId: "th_missing" }),
      ).toMatchObject({ ok: false, code: "generic" });
      // Balance Transfer's thread is resolved, and no draft or review shows it any more.
      for (const act of [
        h.services().comments.resolve(maya, { threadId: closed!.id }),
        h.services().comments.reopen(maya, { threadId: closed!.id }),
      ])
        expect(await act).toMatchObject({
          ok: false,
          code: COMMENT_REFUSALS.closed.code,
        });
      expect({
        balanceTransfer: await written("balance-transfer", ["maya"]),
        annualFeeWaiver: await written("annual-fee-waiver", ["maya"]),
      }).toEqual(before);
    });
  });
}
