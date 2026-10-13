import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { diffChannelFields } from "@/domain/redline/channel-fields";
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

// The review commands of the local implementation, where a case needs a world no command makes, written as rows:
// a draft open beside a round in review (Edit refuses to open one), a content type's message rules changed (no
// command sets an SMS footer or part budget), and what the database itself holds (the unique indexes). A two-stage
// chain is written as a stage row here too. Every case the commands can make is the contract suite's
// (src/server/services/contract/review.ts and review-reads.ts), and what it pins isn't repeated here.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-local-review-");
});

const { approvals, approvalStages, contentTypes, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
const ids = seededDatabasePerTest({ base: BASE });
let clock = BASE;
const { review, drafts, templates } = localServices({
  clock: async () => clock,
});

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
});

// The message rules of the alert's content type (decisions 0034 and 0035). How submit applies them is the contract
// suite's; these change the rules themselves, which no command does.
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
  const alertType = (set: { smsFooter?: string; smsMaxParts?: number }) =>
    db.update(contentTypes).set(set).where(eq(contentTypes.id, "ct_alert"));

  it("takes the part budget from the content type", async () => {
    // Rate Change Heads-up is Maya's draft of an alert; she saves an SMS of two parts with the footer.
    const templateId = ids["rate-change-heads-up"]!;
    const draft = (await draftOf(templateId))!;
    expect(
      await drafts.save(await as("maya"), {
        versionId: draft.id,
        patch: {
          rev: draft.rev,
          sessionKey: "session-local-review-01",
          "sms.text": field(
            t("Hi "),
            chip("first_name"),
            t(". " + "Your rate changes Friday. ".repeat(4)),
          ),
        },
      }),
    ).toMatchObject({ ok: true });
    await alertType({ smsMaxParts: 1 });
    expect(await submitNow("maya", templateId)).toMatchObject({
      ok: false,
      code: "sms_too_many_parts",
    });
    await alertType({ smsMaxParts: 3 });
    expect(await submitNow("maya", templateId)).toMatchObject({ ok: true });
  });

  it("freezes the content type's footer into each version as it is submitted: a later change reaches neither it nor the live version it is redlined against", async () => {
    // Card Used Abroad v1, in review, froze the seeded footer. It goes live, and v2 is submitted under a new one.
    const templateId = ids["card-used-abroad"]!;
    const seeded = (await findRound(db, templateId, 1))!.smsFooter;
    expect(seeded).toEqual(expect.any(String));
    expect(
      await review.approve(await as("jordan"), {
        templateId,
        versionNumber: 1,
        round: 1,
        outputsViewed: ["push.ios", "push.android", "sms"],
        sampleSetsSeen: [],
      }),
    ).toMatchObject({ ok: true, wentLive: true });
    expect(
      await templates.startDraft(await as("maya"), { templateId }),
    ).toMatchObject({ ok: true });
    await alertType({ smsFooter: "Coral: Text STOP to end." });
    expect(await submitNow("maya", templateId)).toEqual({
      ok: true,
      number: 2,
      round: 1,
    });

    await alertType({ smsFooter: "Coral: Reply STOP to stop." });
    const screen = await review.screen(await as("jordan"), {
      teamId: "t_coral",
      templateId,
      versionNumber: 2,
      round: null,
    });
    if (!screen.ok) throw new Error(screen.code);
    expect([
      screen.version.smsFooter,
      screen.messageRules.smsFooter,
      screen.baseline?.smsFooter,
    ]).toEqual([
      "Coral: Text STOP to end.",
      "Coral: Text STOP to end.",
      seeded,
    ]);
    expect(diffChannelFields(screen.baseline, screen.version).footer).toEqual({
      from: seeded,
      to: "Coral: Text STOP to end.",
      status: "changed",
    });
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
