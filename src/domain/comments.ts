// Review comments: which versions take comments, who may start a thread, reply, resolve and reopen,
// what a comment may say, and who hears about it. Pure TypeScript: no framework, no database, no
// clock. The read models ask `canComment` to decide `can.comment`; the server actions ask the
// transitions below inside their transaction, with the rows they re-read, and write what comes back.
//
//   addComment     a new thread on a block of a draft or a version in review (or on the whole version)
//   reply          one more comment in a thread, open or resolved (it doesn't reopen it)
//   resolveThread  open → resolved
//   reopenThread   resolved → open
//
// What a thread anchors to. A block of the body, by its id, or a channel field, by its id ("push.title"):
// a message (an Alert) has no body, so its fields are where its threads go (`commentAnchors`). A thread
// on the whole version (a change request's reason) anchors to `DOCUMENT_THREAD`.
//
// Where a thread can be answered. Threads belong to the template and anchor to block ids, so one thread
// shows on several versions. It is answered on a version that takes comments and shows it: the open
// draft, whose margin shows every thread of the template, or the version in review, whose screen shows
// the threads that began by its round (`threadBeganBy`). Authors and approvers on the template's team act on
// either. Someone the waiting stage names acts from any team, but only on the version in review and the
// threads its screen shows (docs/decisions/0010-comments-are-answered-where-they-show.md).

import type { Outcome } from "./lifecycle";
import { formatCount } from "./numbers";
import { can } from "./permissions";
import { refusal, refuse } from "./refusals";
import {
  DOCUMENT_THREAD,
  type LifecycleEffect,
  type NotificationEffect,
  type NotificationLink,
} from "./review-types";
import { fieldsOfChannels } from "./channel-fields";
import { asNumbered, compareRounds, reviewLink, versionLabel, type RoundRef } from "./rounds";
import type { Channel, PermissionResult, VersionState, Viewer } from "./types";

// ── Limits and sentences ──────────────────────────────────────

/** A comment's longest text, in characters, after trimming. */
export const COMMENT_MAX = 4000;
/** The quoted text a thread keeps, in characters; a longer selection is cut. */
export const QUOTE_MAX = 500;

/** What a refused comment returns (who may comment at all comes from `REASONS`). */
export const COMMENT_REFUSALS = {
  empty: refusal("comment_empty", "Write a comment first."),
  tooLong: refusal("comment_too_long", `Keep a comment under ${formatCount(COMMENT_MAX)} characters.`),
  noBlock: refusal("block_gone", "That block isn't in this version any more."),
  closed: refusal("comments_closed", "Only a draft or a version in review takes comments."),
} as const;

// ── Facts ─────────────────────────────────────────────────────

/** A version as the comment rules read it. */
export interface CommentVersion {
  id: string;
  /** Null while it is the open draft. */
  number: number | null;
  /** Which submission of `number` it is; null while it is the open draft. */
  round: number | null;
  state: VersionState;
  createdBy: string;
  submittedBy: string | null;
  /**
   * The users the stage it waits on names (`{kind:"user"}` rules): they comment on it from any team
   * while it is in review. Empty for a team-role stage, and ignored unless the version is in review.
   */
  stageApproverIds: readonly string[];
}

/** The template a thread belongs to, and the versions on it that take comments right now. */
export interface CommentTemplate {
  id: string;
  /** What its notifications call it: the name of the version the comment is about (the name is versioned). */
  name: string;
  teamId: string;
  /** The template has an open draft. Its margin shows every thread of the template. */
  hasDraft: boolean;
  /** The version in review, if there is one. Its screen shows the threads that began by its round. */
  inReview: { number: number; round: number; stageApproverIds: readonly string[] } | null;
  /** The round the open draft's submit will be (`nextRound`): a thread begun in the draft counts as it. */
  next: RoundRef;
}

/** A thread, with the version it began on (its "origin"). */
export interface CommentThread {
  id: string;
  blockId: string;
  status: "open" | "resolved";
  origin: Pick<CommentVersion, "id" | "number" | "round" | "state" | "createdBy" | "submittedBy">;
}

/** A `comment_threads` row to insert. */
export interface NewThread {
  id: string;
  templateId: string;
  originVersionId: string;
  blockId: string;
  quote: string | null;
  status: "open";
  resolvedBy: null;
  resolvedAt: null;
  createdAt: Date;
}

/** A `comments` row to insert. */
export interface NewComment {
  id: string;
  threadId: string;
  authorId: string;
  body: string;
  kind: "comment";
  createdAt: Date;
}

/** A thread's status as it is written: who resolved it, and when, go with "resolved" only. */
export type ThreadStatusChanges =
  | { status: "resolved"; resolvedBy: string; resolvedAt: Date }
  | { status: "open"; resolvedBy: null; resolvedAt: null };

// ── Which versions take comments ──────────────────────────────

/**
 * Comments belong to a version while it is being written (a draft) or reviewed (in review). Once it has
 * been decided (Active, Superseded, Revoked, or sent back) it is a record: its threads are read there, and
 * answered in the next draft.
 */
export function takesComments(state: VersionState): boolean {
  return state === "draft" || state === "in_review";
}

/**
 * Whether a thread belongs on a frozen round's screen: it began no later than that round, by number and
 * then round (`compareRounds`). A thread that began in the open draft (no number yet) counts as `next`,
 * the round the draft will be. (A thread begun in v4's review is not part of v2's record, and one begun
 * in the draft that resubmits v1 is not part of v1 round 1's.)
 */
export function threadBeganBy(origin: RoundRef | null, through: RoundRef, next: RoundRef): boolean {
  return compareRounds(origin ?? next, through) <= 0;
}

/**
 * Where a thread on a version can anchor, in reading order: the fields of each channel that is on (a
 * message's whole content; a document's email subject and preheader, which show above its body), then
 * each block of the body (`blockIds`, top-level and nested). A thread on a field is about its whole text,
 * as one on a block is about the block's.
 */
export function commentAnchors(blockIds: readonly string[], channels: readonly Channel[]): string[] {
  return [...fieldsOfChannels(channels).map((field) => field.id), ...blockIds];
}

// ── Who may comment ───────────────────────────────────────────

/**
 * May the viewer start a thread on this version? Authors and approvers on the template's team, and anyone
 * the stage it waits on names (`review.comment`, from any team, while it is in review); then the version
 * must take comments. The read models return this as `can.comment`, and `addComment` asks it again.
 */
export function canComment(
  viewer: Viewer,
  input: { teamId: string; version: Pick<CommentVersion, "state" | "stageApproverIds"> },
): PermissionResult {
  const { version } = input;
  const named = version.state === "in_review" ? [...version.stageApproverIds] : [];
  const permitted = can(viewer, "review.comment", { teamId: input.teamId, stageApproverIds: named });
  if (!permitted.ok) return permitted;
  return takesComments(version.state) ? permitted : refuse(COMMENT_REFUSALS.closed);
}

/**
 * May the viewer reply to, resolve or reopen this thread? Only where it can be answered: on the open
 * draft (every thread shows there) or on the version in review (the threads that began by it). Someone the
 * waiting stage names, on no role of the team, counts only for the threads the version in review shows:
 * a thread begun in the draft is one they can't see, and they are refused it as if it weren't there.
 */
export function canActOnThread(
  viewer: Viewer,
  input: { template: CommentTemplate; thread: Pick<CommentThread, "origin"> },
): PermissionResult {
  const { template, thread } = input;
  const review = template.inReview;
  const onReview = review !== null && threadBeganBy(originOf(thread), review, template.next);
  const named = onReview ? [...review.stageApproverIds] : [];
  const permitted = can(viewer, "review.comment", { teamId: template.teamId, stageApproverIds: named });
  if (!permitted.ok) return permitted;
  return template.hasDraft || onReview ? permitted : refuse(COMMENT_REFUSALS.closed);
}

// ── What a comment may say ────────────────────────────────────

/** A comment's text: trimmed, not empty, at most `COMMENT_MAX` characters. */
export function commentText(body: string): Outcome<{ body: string }> {
  const trimmed = body.trim();
  if (!trimmed) return refuse(COMMENT_REFUSALS.empty);
  if (trimmed.length > COMMENT_MAX) return refuse(COMMENT_REFUSALS.tooLong);
  return { ok: true, body: trimmed };
}

// ── Transitions ───────────────────────────────────────────────

export type AddCommentResult = Outcome<{ thread: NewThread; comment: NewComment; effects: LifecycleEffect[] }>;

/**
 * Starts a thread on one block of a version or one of its fields (or on the whole version:
 * `DOCUMENT_THREAD`), with its first comment. On a frozen version the anchor must be on it; a draft's
 * newest blocks may not be saved yet, so a draft takes any block id (a thread whose block never lands
 * reads as orphaned). The version's author is notified, unless they wrote it.
 */
export function addComment(input: {
  viewer: Viewer;
  template: Pick<CommentTemplate, "id" | "name" | "teamId">;
  version: CommentVersion;
  /** Every anchor on the version (`commentAnchors`): its channels' fields, and every block id in its body. */
  blockIds: readonly string[];
  blockId: string;
  quote?: string | null;
  body: string;
  /** Ids the caller assigned. */
  threadId: string;
  commentId: string;
  now: Date;
}): AddCommentResult {
  const { viewer, template, version, blockId, threadId, now } = input;

  const allowed = canComment(viewer, { teamId: template.teamId, version });
  if (!allowed.ok) return allowed;
  const text = commentText(input.body);
  if (!text.ok) return text;
  if (blockId !== DOCUMENT_THREAD && version.state !== "draft" && !input.blockIds.includes(blockId)) {
    return refuse(COMMENT_REFUSALS.noBlock);
  }
  const quote = input.quote?.trim().slice(0, QUOTE_MAX) || null;

  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "comment.added",
      details: { threadId, blockId, number: version.number, round: version.round, ...(quote ? { quote } : {}) },
    },
    ...notifyEach([authorOf(version)], viewer.userId, {
      title: `${viewer.name} commented on ${versionPhrase(template.name, version)}.`,
      body: text.body,
      link: commentLink(template.id, version),
    }),
  ];

  return {
    ok: true,
    thread: {
      id: threadId,
      templateId: template.id,
      originVersionId: version.id,
      blockId,
      quote,
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      createdAt: now,
    },
    comment: newComment(input.commentId, threadId, viewer.userId, text.body, now),
    effects,
  };
}

export type ReplyResult = Outcome<{ comment: NewComment; effects: LifecycleEffect[] }>;

/**
 * Adds a reply to a thread, open or resolved (a reply doesn't reopen it). Everyone who has written in the
 * thread and the author of the version it began on are notified, never the one replying. The audit row
 * and the notifications are about the version the thread began on.
 */
export function reply(input: {
  viewer: Viewer;
  template: CommentTemplate;
  thread: CommentThread;
  /** Everyone who has written in the thread so far. */
  participants: readonly string[];
  body: string;
  /** The id the caller assigned. */
  commentId: string;
  now: Date;
}): ReplyResult {
  const { viewer, template, thread, now } = input;

  const allowed = canActOnThread(viewer, { template, thread });
  if (!allowed.ok) return allowed;
  const text = commentText(input.body);
  if (!text.ok) return text;

  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "comment.added",
      details: {
        threadId: thread.id,
        blockId: thread.blockId,
        number: thread.origin.number,
        round: thread.origin.round,
        reply: true,
      },
    },
    ...notifyEach([authorOf(thread.origin), ...input.participants], viewer.userId, {
      title: `${viewer.name} replied on ${versionPhrase(template.name, thread.origin)}.`,
      body: text.body,
      link: commentLink(template.id, thread.origin),
    }),
  ];

  return { ok: true, comment: newComment(input.commentId, thread.id, viewer.userId, text.body, now), effects };
}

/** `changes` is null when the thread already has the asked status: a second click writes nothing, and is still ok. */
export type ThreadStatusResult = Outcome<{ changes: ThreadStatusChanges | null; effects: LifecycleEffect[] }>;

/** Resolves an open thread: who resolved it and when, and an audit row. */
export function resolveThread(input: {
  viewer: Viewer;
  template: CommentTemplate;
  thread: CommentThread;
  now: Date;
}): ThreadStatusResult {
  return setStatus(input, "resolved");
}

/** Reopens a resolved thread: who resolved it is cleared, and an audit row. */
export function reopenThread(input: {
  viewer: Viewer;
  template: CommentTemplate;
  thread: CommentThread;
  now: Date;
}): ThreadStatusResult {
  return setStatus(input, "open");
}

function setStatus(
  input: { viewer: Viewer; template: CommentTemplate; thread: CommentThread; now: Date },
  to: "open" | "resolved",
): ThreadStatusResult {
  const { viewer, template, thread, now } = input;

  const allowed = canActOnThread(viewer, { template, thread });
  if (!allowed.ok) return allowed;
  if (thread.status === to) return { ok: true, changes: null, effects: [] };

  return {
    ok: true,
    changes:
      to === "resolved"
        ? { status: "resolved", resolvedBy: viewer.userId, resolvedAt: now }
        : { status: "open", resolvedBy: null, resolvedAt: null },
    effects: [
      {
        kind: "audit",
        action: to === "resolved" ? "thread.resolved" : "thread.reopened",
        details: { threadId: thread.id, blockId: thread.blockId, number: thread.origin.number, round: thread.origin.round },
      },
    ],
  };
}

// ── Who hears about it ────────────────────────────────────────

/** Who a comment on a version tells: whoever submitted it, else whoever started its draft. */
function authorOf(version: Pick<CommentVersion, "createdBy" | "submittedBy">): string {
  return version.submittedBy ?? version.createdBy;
}

/** One `comment_added` notification per person, in id order, never to the one who wrote the comment. */
function notifyEach(
  userIds: readonly string[],
  actorId: string,
  n: { title: string; body: string; link: NotificationLink },
): NotificationEffect[] {
  return [...new Set(userIds)]
    .filter((userId) => userId !== actorId)
    .sort()
    .map((userId) => ({ kind: "notification", notification: "comment_added", to: { kind: "user", userId }, ...n }));
}

/**
 * Where a comment notification leads: the review screen while the version is in review, else the
 * template. A numbered version also names itself (and its round, as `reviewLink` does), so a stage
 * reviewer outside the team (who can't open the template's workspace) gets its review screen in their
 * own space.
 */
function commentLink(
  templateId: string,
  version: { number: number | null; round: number | null; state: VersionState },
): NotificationLink {
  if (version.number === null) return { to: "template", templateId };
  const review = reviewLink(templateId, asNumbered(version));
  if (version.state === "in_review") return review;
  const { versionNumber: number, round } = review;
  return { to: "template", templateId, reviewVersion: round === undefined ? { number } : { number, round } };
}

/** "the draft of Spring Travel", "Spring Travel v2", or "Spring Travel v1, round 2" once v1 was sent back. */
function versionPhrase(
  templateName: string,
  version: { number: number | null; round: number | null; state: VersionState },
): string {
  if (version.number === null) return `the draft of ${templateName}`;
  return `${templateName} ${versionLabel(asNumbered(version), { style: "sentence" })}`;
}

/** The round a thread began on; null when it began in the open draft. */
function originOf(thread: Pick<CommentThread, "origin">): RoundRef | null {
  return thread.origin.number === null ? null : asNumbered(thread.origin);
}

function newComment(id: string, threadId: string, authorId: string, body: string, now: Date): NewComment {
  return { id, threadId, authorId, body, kind: "comment", createdAt: now };
}

