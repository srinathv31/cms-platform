import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { ChannelFields } from "@/domain/channel-fields";
import type { JSONContent } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { RequestContext } from "../types";
import { findRound } from "./find-round";
import { localServices } from "./index";

// The review commands of the local implementation, where a case needs a world no moved service can make yet: a
// two-stage chain (the platform area's `saveApprovalChain`), a draft open beside a round in review, an alert's
// own content and its content type's message rules, and what the database itself holds (the comment threads a
// submit resolves, the unique indexes). Each becomes a contract case (src/server/services/contract/review.ts)
// once the service that makes its world, and a read that shows what it checks, have moved. What the contract
// suite already pins (the refusals, the effects, the compare-and-set) isn't repeated here.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-local-review-");
});

const { approvals, approvalStages, commentThreads, contentTypes, versions } =
  schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
const ids = seededDatabasePerTest({ base: BASE });
let clock = BASE;
const { review } = localServices({ clock: async () => clock });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

// Every step happens a minute after the last.
let minute = 0;
beforeEach(() => {
  minute = 0;
});
async function as(userId: string): Promise<RequestContext> {
  minute += 1;
  clock = new Date(BASE.getTime() + minute * 60_000);
  return {
    viewer: await loadPersona(db, userId),
    correlationId: "req_test",
    credential: { kind: "in_process", userId },
  };
}

const draftOf = (templateId: string) =>
  db.query.versions.findFirst({
    where: and(
      eq(versions.templateId, templateId),
      eq(versions.state, "draft"),
    ),
  });

/** Submits the template's draft as it stands, with the rev its summary shows. */
async function submitNow(userId: string, templateId: string) {
  const ctx = await as(userId);
  const summary = await review.submitSummary(ctx, { templateId });
  if (!summary.ok) throw new Error(summary.code);
  return review.submit(ctx, { templateId, rev: summary.rev });
}

async function approveNow(
  userId: string,
  templateId: string,
  versionNumber: number,
  round: number,
) {
  return review.approve(await as(userId), {
    templateId,
    versionNumber,
    round,
    outputsViewed: ["pdf", "web"],
    sampleSetsSeen: [],
  });
}

describe("a two-stage chain", () => {
  // Legal names Alex: he decides the second stage on any team.
  beforeEach(async () => {
    await db.insert(approvalStages).values({
      id: "stage_test_legal",
      contentTypeId: "ct_disclosure",
      position: 1,
      name: "Legal",
      approverRule: { kind: "user", userId: "alex" },
    });
  });

  it("records the chain's stages at submit and moves through them in order; only the named approver acts on Legal", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    expect(await submitNow("maya", templateId)).toEqual({
      ok: true,
      number: 1,
      round: 2,
    });
    expect((await findRound(db, templateId, 1, 2))?.stages).toEqual([
      { id: "stage_disclosure_0", name: "Team approver" },
      { id: "stage_test_legal", name: "Legal" },
    ]);

    expect(await approveNow("jordan", templateId, 1, 2)).toEqual({
      ok: true,
      wentLive: false,
      number: 1,
      round: 2,
    });
    expect(await findRound(db, templateId, 1, 2)).toMatchObject({
      state: "in_review",
      currentStage: 1,
      activatedAt: null,
    });
    expect(await approveNow("jordan", templateId, 1, 2)).toEqual({
      ok: false,
      code: "waiting_on_stage",
      reason: "Waiting on Legal.",
    });

    expect(await approveNow("alex", templateId, 1, 2)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 2,
    });
    const round2 = (await findRound(db, templateId, 1, 2))!;
    expect(round2.state).toBe("active");
    expect(
      (
        await db
          .select()
          .from(approvals)
          .where(eq(approvals.versionId, round2.id))
      ).map((a) => [a.stageName, a.actorId]),
    ).toEqual([
      ["Team approver", "jordan"],
      ["Legal", "alex"],
    ]);
  });
});

describe("a change request", () => {
  it("that finds a draft already open merges the round's writers into it rather than opening a second", async () => {
    const templateId = ids["cash-back"]!;
    // Nothing in the app opens a draft while a round is in review; put one there to check the guard.
    const round2 = (await findRound(db, templateId, 3, 2))!;
    await db.insert(versions).values({
      ...round2,
      id: "v_test_open",
      number: null,
      round: null,
      state: "draft",
      basedOnVersionId: round2.id,
      submittedBy: null,
      submittedAt: null,
      submitNote: null,
      writers: ["priya"],
    });
    expect(
      await review.requestChanges(await as("jordan"), {
        templateId,
        versionNumber: 3,
        round: 2,
        reason: "Spell out the fee.",
      }),
    ).toEqual({ ok: true });
    expect(
      await db
        .select({ id: versions.id, writers: versions.writers })
        .from(versions)
        .where(
          and(eq(versions.templateId, templateId), eq(versions.state, "draft")),
        ),
    ).toEqual([{ id: "v_test_open", writers: ["priya", "maya"] }]);
  });

  it("opens a draft with the round's content and the same block ids, so every thread keeps its anchor", async () => {
    const templateId = ids["cash-back"]!;
    const round2 = (await findRound(db, templateId, 3, 2))!;
    expect(
      await review.requestChanges(await as("jordan"), {
        templateId,
        versionNumber: 3,
        round: 2,
        reason: "Spell out the fee.",
      }),
    ).toEqual({ ok: true });
    expect(await draftOf(templateId)).toMatchObject({
      basedOnVersionId: round2.id,
      createdBy: "maya",
      writers: round2.writers,
      rev: 0,
      body: round2.body,
      variables: round2.variables,
      channels: round2.channels,
      channelFields: round2.channelFields,
    });
  });
});

describe("a submit answers the change request that sent the last round back", () => {
  it("resolves it as the submitter's at the submit, and leaves a block comment open", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    const v1 = (await findRound(db, templateId, 1, 1))!;
    await db.insert(commentThreads).values({
      id: "th_test_block",
      templateId,
      originVersionId: v1.id,
      blockId: "blk_test",
      quote: null,
      status: "open",
      createdAt: BASE,
    });
    const request = (
      await db
        .select()
        .from(commentThreads)
        .where(
          and(
            eq(commentThreads.templateId, templateId),
            eq(commentThreads.blockId, DOCUMENT_THREAD),
          ),
        )
    ).find((t) => t.status === "open")!;

    expect(await submitNow("maya", templateId)).toMatchObject({ ok: true });
    const thread = (id: string) =>
      db.query.commentThreads.findFirst({ where: eq(commentThreads.id, id) });
    expect(await thread(request.id)).toMatchObject({
      status: "resolved",
      resolvedBy: "maya",
      resolvedAt: clock,
    });
    expect(await thread("th_test_block")).toMatchObject({
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    });
  });
});

// The message rules (decisions 0034 and 0035), read from the alert's content type: the seed's Rate Change Heads-up
// is Maya's draft of an alert, Push and SMS on.
describe("submitting an alert", () => {
  const t = (text: string): JSONContent => ({ type: "text", text });
  const chip = (key: string): JSONContent => ({
    type: "variable",
    attrs: { key },
  });
  const field = (...inline: JSONContent[]): JSONContent => ({
    type: "doc",
    content: [{ type: "paragraph", content: inline }],
  });

  /** The alert's draft with this SMS (and a short push), as autosave would have stored it. */
  async function alertWithSms(sms: JSONContent) {
    const templateId = ids["rate-change-heads-up"]!;
    const draft = (await draftOf(templateId))!;
    const variables = draft.variables.some((v) => v.key === "first_name")
      ? draft.variables
      : [
          ...draft.variables,
          {
            key: "first_name",
            label: "First name",
            type: "text" as const,
            required: true,
            sample: "Maya",
          },
        ];
    const channelFields: ChannelFields = {
      push: {
        title: field(t("Your rate changes soon")),
        body: field(t("Hi "), chip("first_name"), t(", it changes Friday.")),
      },
      sms: { text: sms },
    };
    await db
      .update(versions)
      .set({ channelFields, variables, rev: draft.rev + 1 })
      .where(eq(versions.id, draft.id));
    return templateId;
  }
  const alertType = (set: { smsFooter?: string; smsMaxParts?: number }) =>
    db.update(contentTypes).set(set).where(eq(contentTypes.id, "ct_alert"));

  it("refuses characters the author typed outside GSM-7, and writes nothing", async () => {
    const templateId = await alertWithSms(
      field(t("Hi "), chip("first_name"), t(", it’s changing.")),
    );
    const before = await draftOf(templateId);
    expect(await submitNow("maya", templateId)).toMatchObject({
      ok: false,
      code: "sms_characters",
    });
    expect(await draftOf(templateId)).toEqual(before);
  });

  it("measures the SMS with the content type's footer and part budget, using the long sample values", async () => {
    const templateId = await alertWithSms(
      field(
        t("Hi "),
        chip("first_name"),
        t(". " + "Your rate changes Friday. ".repeat(4)),
      ),
    );
    await alertType({ smsMaxParts: 1 });
    expect(await submitNow("maya", templateId)).toMatchObject({
      ok: false,
      code: "sms_too_many_parts",
    });
    await alertType({ smsMaxParts: 3 });
    expect(await submitNow("maya", templateId)).toMatchObject({ ok: true });
  });

  it("refuses a public link shortener in the SMS", async () => {
    const templateId = await alertWithSms(field(t("Details at bit.ly/coral")));
    expect(await submitNow("maya", templateId)).toMatchObject({
      ok: false,
      code: "public_shortener",
    });
  });

  it("freezes the content type's footer into the version: a later change to it doesn't reach the submitted round", async () => {
    const templateId = await alertWithSms(
      field(t("Hi "), chip("first_name"), t(", your rate changes Friday.")),
    );
    await alertType({ smsFooter: "Coral: Text STOP to end." });
    const answer = await submitNow("maya", templateId);
    expect(answer).toMatchObject({ ok: true });
    const { number, round } = answer as { number: number; round: number };
    await alertType({ smsFooter: "Coral: Reply STOP to stop." });
    expect((await findRound(db, templateId, number, round))?.smsFooter).toBe(
      "Coral: Text STOP to end.",
    );
  });
});

describe("the database", () => {
  it("holds one released row per number, and one row per round: a second fails the index", async () => {
    const templateId = ids["cash-back"]!;
    const v2 = (await findRound(db, templateId, 2))!;
    await expect(
      db.insert(versions).values({
        ...v2,
        id: "v_test_dup",
        round: 3,
        state: "superseded",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(versions).values({
        ...v2,
        id: "v_test_dup2",
        state: "changes_requested",
      }),
    ).rejects.toThrow();
  });
});
