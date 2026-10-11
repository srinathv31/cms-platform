import { OUTPUT_KEYS } from "../review-outputs";
import { describe, expect, it } from "vitest";
import { LifecycleError, type ReviewVersion } from "./types";
import { REFUSALS } from "./refusals";
import { approve } from "./approve";
import { cancelRevoke, confirmRevoke, revokePending } from "./revoke";
import { createDraft, editLatest, withWriter } from "./drafts";
import { isAfterToday, setSunset, sunsetPassed } from "./sunset";
import { requestChanges } from "./request-changes";
import { submit, type SubmitDraft } from "./submit";
import { REASONS } from "../permissions";
import type { Refusal } from "../refusals";
import type { RoundRow } from "../rounds";
import { VERSION_STATES, type VersionState } from "../types";
import {
  NOW,
  TEMPLATE,
  CHAIN_1,
  NO_MESSAGE_RULES,
  BODY,
  VARIABLES,
  SAMPLE_SETS,
  ZONE,
  TOMORROW_DAY,
  TOMORROW,
  MARCH_1_DAY,
  LATE_EVENING,
  REASON,
  PENDING,
  CONFIRMED,
  reviewVersion,
  tryRequestChanges,
  tryStartRevoke,
} from "./fixtures";

/** A version as it would be in a state: drafts have no number, a revoked one has a confirmed revoke. */
function inState(state: VersionState, over: Partial<ReviewVersion> = {}): ReviewVersion {
  return reviewVersion({
    state,
    number: state === "draft" ? null : 1,
    round: state === "draft" ? null : 1,
    submittedBy: state === "draft" ? null : "maya",
    revoke: state === "revoked" ? CONFIRMED : null,
    ...over,
  });
}

const tryApprove = (version: ReviewVersion) =>
  approve({
    version,
    chain: CHAIN_1,
    actorId: "jordan",
    actorName: "Jordan Ellis",
    now: NOW,
    active: null,
    sunsetPrevious: null,
    zone: ZONE,
    sampleSetsSeen: ["typical"],
    outputsViewed: OUTPUT_KEYS,
    templateName: TEMPLATE.name,
  });
const trySetSunset = (version: ReviewVersion) =>
  setSunset({ version, actorId: "jordan", now: NOW, sunsetDay: MARCH_1_DAY, zone: ZONE, activeNumber: 2, templateName: TEMPLATE.name });

const tryConfirmRevoke = (version: ReviewVersion) =>
  confirmRevoke({ version, actorId: "alex", actorName: "Alex Kim", now: NOW, activeNumber: 2, templateName: TEMPLATE.name });
const tryCancelRevoke = (version: ReviewVersion) => cancelRevoke({ version, actorId: "alex", now: NOW });

describe("the transitions table: every review move from every state", () => {
  // `true` = allowed; otherwise the exact refusal. Confirm and cancel are tried with a revoke pending.
  const { notInReview, sunsetNotSuperseded, notRevocable, alreadyRevoked, noRevokePending } = REFUSALS;
  const TABLE: Record<string, { attempt: (v: ReviewVersion) => { ok: boolean }; pending?: true; to: Record<VersionState, true | Refusal> }> = {
    "request changes": {
      attempt: tryRequestChanges,
      to: { draft: notInReview, in_review: true, changes_requested: notInReview, active: notInReview, superseded: notInReview, revoked: notInReview },
    },
    approve: {
      attempt: tryApprove,
      to: { draft: notInReview, in_review: true, changes_requested: notInReview, active: notInReview, superseded: notInReview, revoked: notInReview },
    },
    "set sunset": {
      attempt: trySetSunset,
      to: {
        draft: sunsetNotSuperseded,
        in_review: sunsetNotSuperseded,
        changes_requested: sunsetNotSuperseded,
        active: sunsetNotSuperseded,
        superseded: true,
        revoked: sunsetNotSuperseded,
      },
    },
    "start revoke": {
      attempt: tryStartRevoke,
      to: { draft: notRevocable, in_review: notRevocable, changes_requested: notRevocable, active: true, superseded: true, revoked: alreadyRevoked },
    },
    "confirm revoke": {
      attempt: tryConfirmRevoke,
      pending: true,
      to: { draft: noRevokePending, in_review: noRevokePending, changes_requested: noRevokePending, active: true, superseded: true, revoked: alreadyRevoked },
    },
    "cancel revoke": {
      attempt: tryCancelRevoke,
      pending: true,
      to: { draft: noRevokePending, in_review: noRevokePending, changes_requested: noRevokePending, active: true, superseded: true, revoked: alreadyRevoked },
    },
  };

  const cases = Object.entries(TABLE).flatMap(([move, row]) =>
    VERSION_STATES.map((state) => ({ move, state, row, expected: row.to[state] })),
  );

  it.each(cases)("$move from $state", ({ state, row, expected }) => {
    const version = inState(state, row.pending && state !== "revoked" ? { revoke: PENDING } : {});
    const result = row.attempt(version);
    if (expected === true) expect(result.ok).toBe(true);
    else expect(result).toEqual({ ok: false, ...expected });
  });
});

describe("review helpers", () => {
  it("revokePending: started and not yet confirmed", () => {
    expect(revokePending({ revoke: null })).toBe(false);
    expect(revokePending({ revoke: PENDING })).toBe(true);
    expect(revokePending({ revoke: CONFIRMED })).toBe(false);
  });

  it("sunsetPassed: a sunset at or before now (the instant renders start failing)", () => {
    expect(sunsetPassed({ sunsetAt: null }, NOW)).toBe(false);
    expect(sunsetPassed({ sunsetAt: TOMORROW }, NOW)).toBe(false);
    expect(sunsetPassed({ sunsetAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(false);
    expect(sunsetPassed({ sunsetAt: NOW }, NOW)).toBe(true);
    expect(sunsetPassed({ sunsetAt: new Date("2026-10-04T00:00:00.000Z") }, NOW)).toBe(true);
  });

  it("isAfterToday: a later day than today in the business time zone", () => {
    expect(isAfterToday(TOMORROW_DAY, NOW, ZONE)).toBe(true);
    expect(isAfterToday("2026-10-04", NOW, ZONE)).toBe(false);
    expect(isAfterToday("2026-10-03", NOW, ZONE)).toBe(false);
    // 23:30 Eastern on October 4 (03:30 UTC on the 5th): the 5th is after today in New York, not in UTC.
    expect(isAfterToday(TOMORROW_DAY, LATE_EVENING, ZONE)).toBe(true);
    expect(isAfterToday(TOMORROW_DAY, LATE_EVENING, "UTC")).toBe(false);
  });

  it("throws, rather than refuses, on a reviewed version with no number (a data bug)", () => {
    expect(() => tryApprove(reviewVersion({ number: null }))).toThrow(LifecycleError);
  });
});

describe("scenario 3: the review loop", () => {
  it("submit v1, changes requested, resubmit as v1 round 2, approve: v1 is Active", () => {
    const draft: SubmitDraft = {
      state: "draft",
      variables: VARIABLES,
      body: BODY,
      channelFields: {},
      channels: ["pdf", "web"],
      sampleSets: SAMPLE_SETS,
      writers: ["maya"],
      rev: 3,
    };
    const base = {
      now: NOW,
      submittedBy: "maya",
      submitterName: "Maya Chen",
      templateId: TEMPLATE.id,
      templateName: TEMPLATE.name,
      chain: CHAIN_1,
      messageRules: NO_MESSAGE_RULES,
    };

    const first = submit({ ...base, draft, seenRev: 3, versions: [{ number: null, round: null, state: "draft" }], baseline: null });
    if (!first.ok) throw new Error(first.reason);
    const v1 = reviewVersion({ ...first.changes, id: "v_1" });

    // Maya can't approve her own version; Jordan sends it back.
    expect(approve({ ...approveArgs(v1), actorId: "maya" })).toEqual({ ok: false, ...REASONS.ownVersion });
    const returned = tryRequestChanges(v1);
    if (!returned.ok) throw new Error(returned.reason);
    expect(returned.newDraft.basedOnVersionId).toBe("v_1");

    // Sending it back doesn't use up a number: the resubmission is round 2 of v1.
    const rows = [{ number: 1, round: 1, state: "changes_requested" as const }, { ...returned.newDraft }];
    const second = submit({ ...base, draft: { ...returned.newDraft }, seenRev: returned.newDraft.rev, versions: rows, baseline: null });
    if (!second.ok) throw new Error(second.reason);
    expect([second.changes.number, second.changes.round]).toEqual([1, 2]);

    const approved = approve(approveArgs(reviewVersion({ ...second.changes, id: "v_1r2" })));
    expect(approved).toMatchObject({ ok: true, wentLive: true, changes: { state: "active" } });
    // Released, it is the v1 consumers know; the audit row keeps the round it was approved on.
    expect(approved.ok && approved.effects).toContainEqual(
      expect.objectContaining({ kind: "notification", title: "Spring Travel Rewards — Terms v1 is now Active." }),
    );
    expect(approved.ok && approved.effects[0]).toMatchObject({ action: "version.activated", details: { number: 1, round: 2 } });
  });

  function approveArgs(version: ReviewVersion): Parameters<typeof approve>[0] {
    return {
      version,
      chain: CHAIN_1,
      actorId: "jordan",
      actorName: "Jordan Ellis",
      now: NOW,
      active: null,
      sunsetPrevious: null,
      zone: ZONE,
      sampleSetsSeen: ["typical"],
      outputsViewed: OUTPUT_KEYS,
      templateName: TEMPLATE.name,
    };
  }
});

// Maker-checker reaches everyone who wrote the version, not only whoever pressed Submit. Priya holds
// Author and Approver on Coral Offers (an access request can add the role).
describe("maker-checker: nobody decides a version they wrote", () => {
  /** The template's rows before the submit: none, v1 sent back (round 2 next), or v1 Active (v2 next). */
  const BEFORE = {
    first: [],
    sentBack: [{ number: 1, round: 1, state: "changes_requested" }],
    released: [{ number: 1, round: 1, state: "active" }],
  } as const satisfies Record<string, readonly RoundRow[]>;
  const submitAs = (draft: SubmitDraft, submittedBy: string, versions: readonly RoundRow[]) => {
    const result = submit({
      draft,
      seenRev: draft.rev,
      versions,
      baseline: null,
      now: NOW,
      submittedBy,
      submitterName: submittedBy,
      templateId: TEMPLATE.id,
      templateName: TEMPLATE.name,
      chain: CHAIN_1,
      messageRules: NO_MESSAGE_RULES,
    });
    if (!result.ok) throw new Error(result.reason);
    return reviewVersion({ ...draft, ...result.changes, id: `v_${result.changes.number}_${result.changes.round}` });
  };
  const decide = (version: ReviewVersion, actorId: string) => ({
    approve: approve({
      version,
      chain: CHAIN_1,
      actorId,
      actorName: actorId,
      now: NOW,
      active: null,
      sunsetPrevious: null,
      zone: ZONE,
      sampleSetsSeen: [],
      outputsViewed: OUTPUT_KEYS,
      templateName: TEMPLATE.name,
    }),
    requestChanges: requestChanges({
      version,
      chain: CHAIN_1,
      actorId,
      actorName: actorId,
      reason: REASON,
      now: NOW,
      templateName: TEMPLATE.name,
    }),
  });
  const wrote = { ok: false, ...REASONS.wroteVersion };

  const starter = { key: "card_offer_terms", name: "Card offer terms", body: BODY, variables: VARIABLES, sampleSets: SAMPLE_SETS };

  it("a new template's writer is whoever made it", () => {
    expect(createDraft({ starter, createdBy: "maya", now: NOW }).changes.draft.writers).toEqual(["maya"]);
  });

  it("withWriter adds a person once, keeping the order they first wrote in", () => {
    expect(withWriter(["maya"], "priya")).toEqual(["maya", "priya"]);
    expect(withWriter(["maya", "priya"], "maya")).toEqual(["maya", "priya"]);
  });

  it("Priya edits Maya's draft and Maya submits it: Priya can neither approve nor send it back; Jordan can", () => {
    const { draft } = createDraft({ starter, createdBy: "maya", now: NOW }).changes;
    const edited = { ...draft, writers: withWriter(draft.writers, "priya") };
    const v1 = submitAs(edited, "maya", BEFORE.first);
    expect(v1.writers).toEqual(["maya", "priya"]);

    expect(decide(v1, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
    expect(decide(v1, "maya").approve).toEqual({ ok: false, ...REASONS.ownVersion });
    expect(decide(v1, "jordan").approve.ok).toBe(true);
  });

  it("Priya started the draft and someone else submitted it: she can't decide it", () => {
    const active = { ...reviewVersion({ state: "active" }), writers: ["eli"] };
    const { draft } = editLatest({ from: active, createdBy: "priya", now: NOW }).changes;
    const v2 = submitAs({ ...draft, writers: withWriter(draft.writers, "maya") }, "maya", BEFORE.released);
    expect(decide(v2, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
  });

  it("writers carry across a change request; the approver who sent it back can approve the next round", () => {
    const { draft } = createDraft({ starter, createdBy: "maya", now: NOW }).changes;
    const v1 = submitAs({ ...draft, writers: withWriter(draft.writers, "priya") }, "maya", BEFORE.first);

    const returned = decide(v1, "jordan").requestChanges;
    if (!returned.ok) throw new Error(returned.reason);
    expect(returned.newDraft.writers, "Jordan isn't a writer for asking").toEqual(["maya", "priya"]);

    // Maya fixes it alone and resubmits: Priya wrote round one, so round two isn't hers to decide either.
    const v2 = submitAs({ ...returned.newDraft, writers: withWriter(returned.newDraft.writers, "maya") }, "maya", BEFORE.sentBack);
    expect(decide(v2, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
    expect(decide(v2, "jordan").approve).toMatchObject({ ok: true, wentLive: true });
  });

  it("whoever submitted round one stays barred from round two, even without editing", () => {
    const { draft } = createDraft({ starter, createdBy: "maya", now: NOW }).changes;
    const v1 = submitAs(draft, "priya", BEFORE.first);
    expect(v1.writers).toEqual(["maya", "priya"]);

    const returned = decide(v1, "jordan").requestChanges;
    if (!returned.ok) throw new Error(returned.reason);
    const v2 = submitAs({ ...returned.newDraft, writers: withWriter(returned.newDraft.writers, "maya") }, "maya", BEFORE.sentBack);
    expect(v2.submittedBy).toBe("maya");
    expect(decide(v2, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
  });

  it("the approver who sent it back becomes a writer only by editing the next round", () => {
    const { draft } = createDraft({ starter, createdBy: "maya", now: NOW }).changes;
    const v1 = submitAs(draft, "maya", BEFORE.first);
    const returned = decide(v1, "priya").requestChanges;
    if (!returned.ok) throw new Error(returned.reason);

    const v2 = submitAs({ ...returned.newDraft, writers: withWriter(returned.newDraft.writers, "priya") }, "maya", BEFORE.sentBack);
    expect(decide(v2, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
  });

  it("a draft from the Active version starts afresh: writing v1 doesn't keep anyone from deciding v2", () => {
    const active = { ...reviewVersion({ state: "active" }), writers: ["maya", "priya"] };
    const { draft } = editLatest({ from: active, createdBy: "maya", now: NOW }).changes;
    const v2 = submitAs(draft, "maya", BEFORE.released);
    expect(v2.writers).toEqual(["maya"]);
    expect(decide(v2, "priya").approve.ok).toBe(true);
  });
});

describe("scenario 6: two-person revoke", () => {
  it("Jordan starts, can't confirm; Alex confirms", () => {
    const v1 = reviewVersion({ state: "superseded", submittedBy: "priya" });
    const started = tryStartRevoke(v1);
    if (!started.ok) throw new Error(started.reason);
    const pending = { ...v1, ...started.changes };

    expect(confirmRevoke({ version: pending, actorId: "jordan", actorName: "Jordan Ellis", now: NOW, activeNumber: 2, templateName: "x" })).toEqual({
      ok: false,
      ...REASONS.ownRevoke,
    });
    const confirmed = tryConfirmRevoke(pending);
    expect(confirmed).toMatchObject({ ok: true, changes: { state: "revoked", revoke: { startedBy: "jordan", confirmedBy: "alex" } } });
  });
});
