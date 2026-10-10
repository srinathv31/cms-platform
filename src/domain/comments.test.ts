import { describe, expect, it } from "vitest";
import {
  COMMENT_MAX,
  COMMENT_REFUSALS,
  QUOTE_MAX,
  addComment,
  canActOnThread,
  canComment,
  commentAnchors,
  commentText,
  reopenThread,
  reply,
  resolveThread,
  takesComments,
  threadBeganBy,
  type CommentTemplate,
  type CommentThread,
  type CommentVersion,
} from "./comments";
import { REASONS } from "./permissions";
import { DOCUMENT_THREAD } from "./review-types";
import { VERSION_STATES, type TeamRole, type Viewer } from "./types";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const GENERIC = { ok: false, ...REASONS.generic };
const CLOSED = { ok: false, ...COMMENT_REFUSALS.closed };

function person(userId: string, teams: Record<string, TeamRole[]> = {}, platformRole: Viewer["platformRole"] = null): Viewer {
  return {
    userId,
    name: userId[0]!.toUpperCase() + userId.slice(1),
    initials: userId.slice(0, 2).toUpperCase(),
    title: "",
    platformRole,
    memberships: Object.entries(teams).map(([teamId, roles]) => ({
      teamId,
      teamSlug: teamId,
      teamName: teamId,
      roles,
      status: "active" as const,
    })),
  };
}

// Seed personas: Maya writes and Jordan approves on Coral Offers, Sam only views it. Naomi is on Deposits
// only; a stage that names her makes her a reviewer of Coral Offers' versions too.
const maya = person("maya", { "coral-offers": ["author"] });
const jordan = person("jordan", { "coral-offers": ["approver"] });
const sam = person("sam", { "coral-offers": ["viewer"] });
const naomi = person("naomi", { deposits: ["approver", "team_admin"] });
const taylor = person("taylor", {}, "auditor");

const TEMPLATE = { id: "UC-4F7K2Q", name: "Spring Travel Rewards — Terms", teamId: "coral-offers" };

function version(patch: Partial<CommentVersion> = {}): CommentVersion {
  return {
    id: "v_3",
    number: 3,
    round: 1,
    state: "in_review",
    createdBy: "maya",
    submittedBy: "maya",
    stageApproverIds: [],
    ...patch,
  };
}

/**
 * The template with v3 round 1 in review (its waiting stage names `named`), and an open draft when `draft`.
 * A draft would be v3 round 2 (`next`): nothing above v2 was released.
 */
function template(patch: Partial<CommentTemplate> = {}): CommentTemplate {
  return {
    ...TEMPLATE,
    hasDraft: false,
    inReview: { number: 3, round: 1, stageApproverIds: [] },
    next: { number: 3, round: 2 },
    ...patch,
  };
}
const reviewNaming = (...ids: string[]) => template({ inReview: { number: 3, round: 1, stageApproverIds: ids } });

function thread(origin: Partial<CommentThread["origin"]> = {}, patch: Partial<Omit<CommentThread, "origin">> = {}): CommentThread {
  return {
    id: "th_1",
    blockId: "b_two",
    status: "open",
    origin: { id: "v_3", number: 3, round: 1, state: "in_review", createdBy: "maya", submittedBy: "maya", ...origin },
    ...patch,
  };
}
const onDraft = () => thread({ id: "v_draft", number: null, round: null, state: "draft", submittedBy: null });

describe("which versions take comments", () => {
  it("a draft and a version in review do; a decided version is a record", () => {
    for (const state of VERSION_STATES) {
      expect(takesComments(state), state).toBe(state === "draft" || state === "in_review");
    }
  });

  it("a frozen round shows the threads that began by it; a draft's thread counts as the next round", () => {
    const r = (number: number, round = 1) => ({ number, round });
    expect(threadBeganBy(r(1), r(2), r(4))).toBe(true);
    expect(threadBeganBy(r(2), r(2), r(4))).toBe(true);
    expect(threadBeganBy(r(4), r(2), r(5))).toBe(false);
    expect(threadBeganBy(null, r(3), r(4))).toBe(false);
    expect(threadBeganBy(null, r(4), r(4))).toBe(true);
  });

  it("orders the rounds of one number: an earlier round's thread shows on the later round, not the other way", () => {
    const r = (number: number, round: number) => ({ number, round });
    expect(threadBeganBy(r(3, 1), r(3, 2), r(3, 3))).toBe(true);
    expect(threadBeganBy(r(3, 2), r(3, 1), r(3, 3))).toBe(false);
    // Begun in the draft that resubmits v1: part of round 2's review, not round 1's record.
    expect(threadBeganBy(null, r(1, 1), r(1, 2))).toBe(false);
    expect(threadBeganBy(null, r(1, 2), r(1, 2))).toBe(true);
  });
});

describe("canComment: who may start a thread", () => {
  it("the team's authors and approvers, on a draft or a version in review", () => {
    for (const viewer of [maya, jordan]) {
      expect(canComment(viewer, { teamId: "coral-offers", version: version() })).toEqual({ ok: true });
      expect(canComment(viewer, { teamId: "coral-offers", version: version({ state: "draft", number: null, round: null }) })).toEqual({
        ok: true,
      });
    }
  });

  it("nobody, on a decided version, and the reason says why", () => {
    for (const state of ["active", "superseded", "revoked", "changes_requested"] as const) {
      expect(canComment(jordan, { teamId: "coral-offers", version: version({ state }) }), state).toEqual(CLOSED);
    }
  });

  it("not a viewer of the team, nor someone on another team", () => {
    expect(canComment(sam, { teamId: "coral-offers", version: version() })).toEqual(GENERIC);
    expect(canComment(naomi, { teamId: "coral-offers", version: version() })).toEqual(GENERIC);
  });

  it("someone the waiting stage names, from any team, while the version is in review only", () => {
    const named = { stageApproverIds: ["naomi"] };
    expect(canComment(naomi, { teamId: "coral-offers", version: version(named) })).toEqual({ ok: true });
    expect(canComment(naomi, { teamId: "coral-offers", version: version({ ...named, state: "active" }) })).toEqual(GENERIC);
    // The Auditor stays read-only, named or not.
    expect(canComment(taylor, { teamId: "coral-offers", version: version({ stageApproverIds: ["taylor"] }) })).toEqual(GENERIC);
  });
});

describe("canActOnThread: who may reply, resolve and reopen", () => {
  it("the team acts on any thread while the template has an open draft (its margin shows them all)", () => {
    const withDraft = template({ hasDraft: true, inReview: null, next: { number: 3, round: 1 } });
    expect(canActOnThread(maya, { template: withDraft, thread: onDraft() })).toEqual({ ok: true });
    expect(canActOnThread(jordan, { template: withDraft, thread: thread({ number: 1, state: "active" }) })).toEqual({ ok: true });
  });

  it("the team acts on the threads the version in review shows", () => {
    expect(canActOnThread(jordan, { template: template(), thread: thread() })).toEqual({ ok: true });
    expect(canActOnThread(jordan, { template: template(), thread: thread({ number: 1, state: "changes_requested" }) })).toEqual({ ok: true });
  });

  it("nobody acts on a thread when nothing on the template takes comments", () => {
    const record = template({ hasDraft: false, inReview: null, next: { number: 3, round: 1 } });
    expect(canActOnThread(maya, { template: record, thread: thread({ number: 2, state: "active" }) })).toEqual(CLOSED);
  });

  it("someone the stage names acts on the version in review's threads, and on no other", () => {
    const named = reviewNaming("naomi");
    expect(canActOnThread(naomi, { template: named, thread: thread() })).toEqual({ ok: true });
    // An earlier version's thread: the version in review shows it.
    expect(canActOnThread(naomi, { template: named, thread: thread({ number: 2, state: "active" }) })).toEqual({ ok: true });
    // A thread begun in the open draft: they can't see it, and it is refused as if it weren't there.
    const withDraft = { ...named, hasDraft: true };
    expect(canActOnThread(naomi, { template: withDraft, thread: onDraft() })).toEqual(GENERIC);
    // With nothing in review, being named on a stage gives them nothing.
    expect(canActOnThread(naomi, { template: { ...withDraft, inReview: null }, thread: thread({ state: "active" }) })).toEqual(GENERIC);
  });

  it("not a viewer of the team", () => {
    expect(canActOnThread(sam, { template: template({ hasDraft: true }), thread: thread() })).toEqual(GENERIC);
  });
});

describe("commentText: what a comment may say", () => {
  it("is trimmed, not empty, and at most COMMENT_MAX characters", () => {
    expect(commentText("  Fine.  ")).toEqual({ ok: true, body: "Fine." });
    expect(commentText(" \n ")).toEqual({ ok: false, ...COMMENT_REFUSALS.empty });
    expect(commentText("x".repeat(COMMENT_MAX))).toEqual({ ok: true, body: "x".repeat(COMMENT_MAX) });
    expect(commentText("x".repeat(COMMENT_MAX + 1))).toEqual({ ok: false, ...COMMENT_REFUSALS.tooLong });
    expect(COMMENT_REFUSALS.tooLong.reason).toBe("Keep a comment under 4,000 characters.");
  });
});

describe("commentAnchors: where a thread can anchor", () => {
  it("is the fields of the channels that are on, in registry order, then the body's blocks", () => {
    expect(commentAnchors(["b_one", "b_two"], ["pdf", "email"])).toEqual(["email.subject", "email.preheader", "b_one", "b_two"]);
    expect(commentAnchors([], ["sms", "push"])).toEqual(["push.title", "push.subtitle", "push.body", "sms.text"]);
    expect(commentAnchors(["b_one"], ["pdf", "web"])).toEqual(["b_one"]);
  });
});

describe("addComment", () => {
  const input =(patch: Partial<Parameters<typeof addComment>[0]> = {}) => ({
    viewer: jordan,
    template: TEMPLATE,
    version: version(),
    blockIds: ["b_one", "b_two"],
    blockId: "b_two",
    quote: "  spend $1,000  ",
    body: "  Still right?  ",
    threadId: "th_new",
    commentId: "cm_new",
    now: NOW,
    ...patch,
  });

  it("starts a thread with its first comment, and tells the version's author where to look", () => {
    expect(addComment(input())).toEqual({
      ok: true,
      thread: {
        id: "th_new",
        templateId: TEMPLATE.id,
        originVersionId: "v_3",
        blockId: "b_two",
        quote: "spend $1,000",
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
        createdAt: NOW,
      },
      comment: { id: "cm_new", threadId: "th_new", authorId: "jordan", body: "Still right?", kind: "comment", createdAt: NOW },
      effects: [
        {
          kind: "audit",
          action: "comment.added",
          details: { threadId: "th_new", blockId: "b_two", number: 3, round: 1, quote: "spend $1,000" },
        },
        {
          kind: "notification",
          notification: "comment_added",
          to: { kind: "user", userId: "maya" },
          title: "Jordan commented on Spring Travel Rewards — Terms v3.",
          body: "Still right?",
          link: { to: "review", templateId: TEMPLATE.id, versionNumber: 3 },
        },
      ],
    });
  });

  it("names a second round in review, and links to it", () => {
    const result = addComment(input({ version: version({ id: "v_3r2", round: 2 }) }));
    expect(result.ok && result.effects[1]).toMatchObject({
      title: "Jordan commented on Spring Travel Rewards — Terms v3, round 2.",
      link: { to: "review", templateId: TEMPLATE.id, versionNumber: 3, round: 2 },
    });
  });

  it("asks who may comment and whether the version takes comments", () => {
    expect(addComment(input({ viewer: sam }))).toEqual(GENERIC);
    expect(addComment(input({ version: version({ state: "active" }) }))).toEqual(CLOSED);
  });

  it("refuses a comment with nothing in it, or too much", () => {
    expect(addComment(input({ body: "   " }))).toEqual({ ok: false, ...COMMENT_REFUSALS.empty });
    expect(addComment(input({ body: "x".repeat(COMMENT_MAX + 1) }))).toEqual({ ok: false, ...COMMENT_REFUSALS.tooLong });
  });

  it("needs the block in a frozen version's body; a draft takes any block, and any version takes the whole-version thread", () => {
    expect(addComment(input({ blockId: "b_gone" }))).toEqual({ ok: false, ...COMMENT_REFUSALS.noBlock });
    expect(addComment(input({ blockId: DOCUMENT_THREAD }))).toMatchObject({ ok: true });
    const draft = version({ id: "v_draft", number: null, round: null, state: "draft", submittedBy: null });
    expect(addComment(input({ version: draft, blockId: "b_not_saved_yet" }))).toMatchObject({ ok: true });
  });

  it("takes a thread on a field of a channel that is on (a message's threads are on its fields), not of one that is off", () => {
    const blockIds = commentAnchors([], ["push", "sms"]);
    expect(addComment(input({ blockIds, blockId: "push.title", quote: null }))).toMatchObject({ ok: true, thread: { blockId: "push.title", quote: null } });
    expect(addComment(input({ blockIds, blockId: "email.subject", quote: null }))).toEqual({ ok: false, ...COMMENT_REFUSALS.noBlock });
  });

  it("cuts a long quote to QUOTE_MAX characters, and keeps none when it is blank", () => {
    const long = addComment(input({ quote: "q".repeat(QUOTE_MAX + 50) }));
    expect(long.ok && long.thread.quote).toBe("q".repeat(QUOTE_MAX));
    const blank = addComment(input({ quote: "   " }));
    expect(blank.ok && blank.thread.quote).toBeNull();
    expect(blank.ok && blank.effects[0]).toEqual({
      kind: "audit",
      action: "comment.added",
      details: { threadId: "th_new", blockId: "b_two", number: 3, round: 1 },
    });
  });

  it("tells a draft's author, with a link to the template; nobody hears of their own comment", () => {
    const draft = version({ id: "v_draft", number: null, round: null, state: "draft", submittedBy: null, createdBy: "maya" });
    const onDraftResult = addComment(input({ version: draft }));
    expect(onDraftResult.ok && onDraftResult.effects[1]).toMatchObject({
      to: { kind: "user", userId: "maya" },
      title: "Jordan commented on the draft of Spring Travel Rewards — Terms.",
      link: { to: "template", templateId: TEMPLATE.id },
    });
    const own = addComment(input({ viewer: maya }));
    expect(own.ok && own.effects.map((e) => e.kind)).toEqual(["audit"]);
  });
});

describe("reply", () => {
  const input = (patch: Partial<Parameters<typeof reply>[0]> = {}) => ({
    viewer: jordan,
    template: template(),
    thread: thread(),
    participants: ["jordan", "priya"],
    body: " Agreed. ",
    commentId: "cm_reply",
    now: NOW,
    ...patch,
  });

  it("adds the comment and tells everyone in the thread and the version's author, never the one replying", () => {
    const result = reply(input());
    expect(result).toEqual({
      ok: true,
      comment: { id: "cm_reply", threadId: "th_1", authorId: "jordan", body: "Agreed.", kind: "comment", createdAt: NOW },
      effects: [
        {
          kind: "audit",
          action: "comment.added",
          details: { threadId: "th_1", blockId: "b_two", number: 3, round: 1, reply: true },
        },
        ...["maya", "priya"].map((userId) => ({
          kind: "notification",
          notification: "comment_added",
          to: { kind: "user", userId },
          title: "Jordan replied on Spring Travel Rewards — Terms v3.",
          body: "Agreed.",
          link: { to: "review", templateId: TEMPLATE.id, versionNumber: 3 },
        })),
      ],
    });
  });

  it("links a decided version's thread to its review screen, for whoever can't open the workspace", () => {
    const decided = reply(input({ template: template({ hasDraft: true }), thread: thread({ number: 2, state: "active" }) }));
    expect(decided.ok && decided.effects[1]).toMatchObject({
      link: { to: "template", templateId: TEMPLATE.id, reviewVersion: { number: 2 } },
    });
  });

  it("names a round sent back, in the sentence and the link: the bare link would open the newer round", () => {
    const sentBack = thread({ number: 3, round: 1, state: "changes_requested" });
    const result = reply(input({ template: template({ hasDraft: true, inReview: null }), thread: sentBack }));
    expect(result.ok && result.effects[1]).toMatchObject({
      title: "Jordan replied on Spring Travel Rewards — Terms v3, round 1.",
      link: { to: "template", templateId: TEMPLATE.id, reviewVersion: { number: 3, round: 1 } },
    });
  });

  it("answers a resolved thread too, without reopening it", () => {
    expect(reply(input({ thread: thread({}, { status: "resolved" }) }))).toMatchObject({ ok: true });
  });

  it("asks where the thread can be answered, then the text", () => {
    expect(reply(input({ template: template({ inReview: null }) }))).toEqual(CLOSED);
    expect(reply(input({ viewer: naomi, template: reviewNaming("naomi", "x"), thread: onDraft() }))).toEqual(GENERIC);
    expect(reply(input({ body: "" }))).toEqual({ ok: false, ...COMMENT_REFUSALS.empty });
  });
});

describe("resolveThread and reopenThread", () => {
  const input = (patch: Partial<Parameters<typeof resolveThread>[0]> = {}) => ({
    viewer: jordan,
    template: template(),
    thread: thread(),
    now: NOW,
    ...patch,
  });

  it("resolve records who and when; reopen clears them; each writes an audit row", () => {
    expect(resolveThread(input())).toEqual({
      ok: true,
      changes: { status: "resolved", resolvedBy: "jordan", resolvedAt: NOW },
      effects: [{ kind: "audit", action: "thread.resolved", details: { threadId: "th_1", blockId: "b_two", number: 3, round: 1 } }],
    });
    expect(reopenThread(input({ thread: thread({}, { status: "resolved" }) }))).toEqual({
      ok: true,
      changes: { status: "open", resolvedBy: null, resolvedAt: null },
      effects: [{ kind: "audit", action: "thread.reopened", details: { threadId: "th_1", blockId: "b_two", number: 3, round: 1 } }],
    });
  });

  it("asks for a thread already where it was asked to go: nothing to write, still ok", () => {
    expect(resolveThread(input({ thread: thread({}, { status: "resolved" }) }))).toEqual({ ok: true, changes: null, effects: [] });
    expect(reopenThread(input())).toEqual({ ok: true, changes: null, effects: [] });
  });

  it("refuses where the thread can't be answered, before anything else", () => {
    expect(resolveThread(input({ template: template({ inReview: null }) }))).toEqual(CLOSED);
    expect(reopenThread(input({ viewer: sam, thread: thread({}, { status: "resolved" }) }))).toEqual(GENERIC);
  });
});
