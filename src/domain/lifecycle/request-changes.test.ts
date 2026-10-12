import { describe, expect, it } from "vitest";
import { requestChanges } from "./request-changes";
import { REASONS } from "../permissions";
import type { ApprovalStage } from "../review-types";
import {
  NOW,
  TEMPLATE,
  CHAIN_1,
  BODY,
  VARIABLES,
  SAMPLE_SETS,
  CHAIN_2,
  STAGES_2,
  REASON,
  EMAIL_SUBJECT,
  reviewVersion,
} from "./fixtures";

describe("requestChanges", () => {
  const run = (over: Partial<Parameters<typeof requestChanges>[0]> = {}) =>
    requestChanges({
      version: reviewVersion(),
      chain: CHAIN_1,
      actorId: "jordan",
      actorName: "Jordan Ellis",
      reason: REASON,
      now: NOW,
      templateName: TEMPLATE.name,
      ...over,
    });

  it("sends the version back, records the decision, and leaves the author a new draft", () => {
    expect(run()).toEqual({
      ok: true,
      changes: { state: "changes_requested" },
      approval: {
        versionId: "v_1",
        stageId: "st_team",
        stagePosition: 0,
        stageName: "Team approver",
        actorId: "jordan",
        decision: "changes_requested",
        reason: REASON,
        sampleSetsSeen: null,
        decidedAt: NOW,
      },
      newDraft: {
        state: "draft",
        number: null,
        round: null,
        basedOnVersionId: "v_1",
        name: TEMPLATE.name,
        body: BODY,
        channelFields: { email: { subject: EMAIL_SUBJECT } },
        channels: ["pdf", "web", "email"],
        variables: VARIABLES,
        sampleSets: SAMPLE_SETS,
        contractChanges: null,
        currentStage: 0,
        rev: 0,
        createdBy: "maya",
        writers: ["maya"],
        createdAt: NOW,
        updatedAt: NOW,
      },
      reasonComment: { blockId: "doc", body: REASON, kind: "change_request" },
      effects: [
        {
          kind: "audit",
          action: "version.changes_requested",
          details: {
            number: 1,
            round: 1,
            stage: "Team approver",
            reason: REASON,
          },
        },
        {
          kind: "notification",
          notification: "changes_requested",
          to: { kind: "user", userId: "maya" },
          // Sent back, the round shows: "v1, round 1".
          title:
            "Jordan Ellis requested changes on Spring Travel Rewards — Terms v1, round 1.",
          body: REASON,
          link: { to: "template", templateId: TEMPLATE.id },
        },
      ],
    });
  });

  it("carries the version's name into the new draft, a rename included", () => {
    const result = run({
      version: reviewVersion({ name: "Spring Travel Rewards — Card Terms" }),
    });
    expect(result.ok && result.newDraft.name).toBe(
      "Spring Travel Rewards — Card Terms",
    );
  });

  it("keeps every block id in the new draft, so the review threads re-anchor in the editor", () => {
    const result = run();
    const ids = (result.ok ? (result.newDraft.body.content ?? []) : []).map(
      (b) => b.attrs?.id,
    );
    expect(ids).toEqual(["b_one", "b_two", "b_three", "b_four"]);
  });

  it("copies, so editing the new draft never changes the version under review", () => {
    const result = run();
    if (!result.ok) throw new Error(result.reason);
    result.newDraft.body.content![1]!.content![0]!.text = "Changed";
    result.newDraft.variables[0]!.label = "Changed";
    result.newDraft.sampleSets[0]!.values.first_name = "Changed";
    result.newDraft.channelFields.email!.subject!.content![0]!.content![0]!.text =
      "Changed";
    expect(BODY.content![1]!.content![0]!.text).toBe("Hi ");
    expect(VARIABLES[0]!.label).toBe("First name");
    expect(SAMPLE_SETS[0]!.values.first_name).toBe("Maya");
    expect(EMAIL_SUBJECT.content![0]!.content![0]!.text).toBe("Your offer");
  });

  it("trims the reason before it becomes the comment", () => {
    const result = run({ reason: `  ${REASON}\n` });
    expect(result.ok && result.reasonComment.body).toBe(REASON);
    expect(result.ok && result.approval.reason).toBe(REASON);
  });

  it.each(["", "   ", "\n\t"])("refuses an empty reason (%j)", (reason) => {
    expect(run({ reason })).toEqual({
      ok: false,
      code: "reason_missing",
      reason: "Give a reason.",
    });
  });

  it("refuses the submitter: nobody decides their own version", () => {
    expect(run({ actorId: "maya", actorName: "Maya Chen" })).toEqual({
      ok: false,
      ...REASONS.ownVersion,
    });
  });

  it("refuses anyone else who wrote it: Priya edited Maya's draft, so she can't send it back", () => {
    const version = reviewVersion({ writers: ["maya", "priya"] });
    expect(
      run({ version, actorId: "priya", actorName: "Priya Raman" }),
    ).toEqual({
      ok: false,
      ...REASONS.wroteVersion,
    });
    expect(run({ version }).ok, "Jordan wrote none of it").toBe(true);
  });

  it("hands the version's writers to the new draft, and not the approver who sent it back", () => {
    const result = run({
      version: reviewVersion({ writers: ["maya", "priya"] }),
    });
    expect(result.ok && result.newDraft.writers).toEqual(["maya", "priya"]);
  });

  it("checks the state before who is asking", () => {
    expect(
      run({ version: reviewVersion({ state: "active" }), actorId: "maya" }),
    ).toEqual({
      ok: false,
      code: "not_in_review",
      reason: "This version isn't in review.",
    });
  });

  it("records the stage that sent it back", () => {
    const result = run({
      version: reviewVersion({ currentStage: 1 }),
      chain: CHAIN_2,
      actorId: "dana",
      actorName: "Dana Park",
    });
    expect(result.ok && result.approval).toMatchObject({
      stagePosition: 1,
      stageName: "Legal reviewer",
      actorId: "dana",
    });
    expect(result.ok && result.effects[0]).toEqual({
      kind: "audit",
      action: "version.changes_requested",
      details: { number: 1, round: 1, stage: "Legal reviewer", reason: REASON },
    });
  });

  it("names the round it sends back, in the audit row and the author's notification", () => {
    const result = run({ version: reviewVersion({ id: "v_1r2", round: 2 }) });
    expect(result.ok && result.effects).toMatchObject([
      { action: "version.changes_requested", details: { number: 1, round: 2 } },
      {
        title:
          "Jordan Ellis requested changes on Spring Travel Rewards — Terms v1, round 2.",
      },
    ]);
    // The new draft is the next round's: no number and no round until it is submitted.
    expect(
      result.ok && [result.newDraft.number, result.newDraft.round],
    ).toEqual([null, null]);
  });

  it("records the stage of the version's own that sent it back, by id, after the chain was reordered and renamed", () => {
    const edited: ApprovalStage[] = [
      { ...CHAIN_2[1]!, position: 0, name: "Legal sign-off" },
      { ...CHAIN_2[0]!, position: 1 },
    ];
    const version = reviewVersion({ stages: STAGES_2, currentStage: 1 });
    const result = run({
      version,
      chain: edited,
      actorId: "dana",
      actorName: "Dana Park",
    });
    expect(result.ok && result.approval).toMatchObject({
      stageId: "st_legal",
      stagePosition: 1,
      stageName: "Legal reviewer",
    });
  });

  it("refuses when the chain has no stage for the version", () => {
    expect(run({ chain: [] })).toEqual({
      ok: false,
      code: "stage_missing",
      reason: "This version's approval stage no longer exists.",
    });
    expect(run({ version: reviewVersion({ currentStage: 1 }) })).toEqual({
      ok: false,
      code: "stage_missing",
      reason: "This version's approval stage no longer exists.",
    });
  });

  it("gives the draft to the approver, and notifies nobody, when no submitter is on record", () => {
    const result = run({ version: reviewVersion({ submittedBy: null }) });
    expect(result.ok && result.newDraft.createdBy).toBe("jordan");
    expect(result.ok && result.effects.map((e) => e.kind)).toEqual(["audit"]);
  });
});
