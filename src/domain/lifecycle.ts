// Template lifecycle rules (build plan, "Template lifecycle" and "Review and approval").
// Pure TypeScript: no framework, no database, no clock. The caller passes `now` and the ids it
// has generated; the server actions write the result inside one transaction.
//
// Each transition returns `{ changes, effects }`. `changes` are the field values to write;
// `effects` are the side records (audit events, notifications, consumer notices) that
// `server/effects.ts` writes in the same transaction.
//
//   createDraft    — → Draft (a new template from a starter)
//   editActive     Active → a new Draft copied from it ("Draft of v3")
//   submit         Draft → In review, numbered; the approvers are notified
//   requestChanges In review → Changes requested, plus a new Draft carrying the block ids (and so the threads)
//   approve        In review → the next stage, or Active at the last one (the previous Active → Superseded)
//   setSunset      Superseded → Superseded with a sunset date (or a moved one), until that date passes
//   startRevoke    Active or Superseded → revoke pending (one approver)
//   confirmRevoke  revoke pending → Revoked (a different approver)
//   cancelRevoke   revoke pending → no revoke
//
// The transitions the review phase added refuse with a one-line reason (`{ ok: false, reason }`)
// rather than throwing: a second tab or a slower colleague gets there first, and the person reads why.

import { diffVariables, isBreaking } from "@/editor/model/contract";
import { usageFromJSON } from "@/editor/model/usage";
import { orderedStages, stageAt, stageRecipients } from "./approval-chain";
import { describeChanges } from "./contract";
import { REASONS, makerCheckerRefusal } from "./permissions";
import { formatLongDate } from "./render/errors";
import {
  DOCUMENT_THREAD,
  type ApprovalStage,
  type LifecycleEffect,
  type NotificationEffect,
  type Recipients,
} from "./review-types";
import type {
  Channel,
  ContractChange,
  JSONContent,
  RevokeRecord,
  SampleSet,
  Variable,
  VersionState,
} from "./types";

export type {
  AuditEffect,
  ConsumerNoticeEffect,
  LifecycleEffect,
  NotificationEffect,
} from "./review-types";

// ── Defaults ──────────────────────────────────────────────────

/** Name of a template made from Blank. The author renames it straight away. */
export const UNTITLED_TEMPLATE_NAME = "Untitled template";

/** Key of the starter that has no example content (just the required sections). */
export const BLANK_STARTER_KEY = "blank";

/** A new template renders PDF and Web. Email is a deliberate opt-in, as in the seed. */
export const DEFAULT_CHANNELS: readonly Channel[] = ["pdf", "web"];

// ── Shapes ────────────────────────────────────────────────────

export interface LifecycleResult<C> {
  changes: C;
  effects: LifecycleEffect[];
}

/** Everything a starter contributes to a new template's first draft. */
export interface StarterContent {
  /** snake_case key; `blank` for the empty starter. Stored on the template as `starter_key`. */
  key: string;
  /** Display name, e.g. "Card offer terms". */
  name: string;
  body: JSONContent;
  variables: Variable[];
  sampleSets: SampleSet[];
  /** Defaults to `DEFAULT_CHANNELS`. */
  channels?: readonly Channel[];
  emailSubject?: JSONContent | null;
  emailPreheader?: JSONContent | null;
}

/** The content of a version that a draft is made from. */
export interface VersionSnapshot {
  id: string;
  number: number | null;
  state: VersionState;
  body: JSONContent;
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
  channels: readonly Channel[];
  variables: readonly Variable[];
  sampleSets: readonly SampleSet[];
}

/** Field values for a new `draft` version row (ids and the template id are assigned by the caller). */
export interface DraftFields {
  state: "draft";
  /** Null until the draft is submitted; the number is assigned at submit and then frozen. */
  number: null;
  basedOnVersionId: string | null;
  body: JSONContent;
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
  channels: Channel[];
  variables: Variable[];
  sampleSets: SampleSet[];
  contractChanges: null;
  currentStage: 0;
  /** Autosave ordering starts at zero. */
  rev: 0;
  createdBy: string;
  /**
   * Who has written the draft so far (maker-checker, `makerCheckerRefusal`): whoever started it, and for
   * the draft a change request opens, everyone who wrote the version that was sent back. Autosave adds
   * each person who saves an edit and submit adds the submitter (`withWriter`).
   */
  writers: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

// ── New template ──────────────────────────────────────────────

export interface NewTemplateChanges {
  template: {
    name: string;
    /** Null for Blank, as in the seed. */
    starterKey: string | null;
    createdBy: string;
    createdAt: Date;
  };
  draft: DraftFields;
}

/** The template's first name: Blank is untitled (renamed at once), an example keeps its own name. */
export function initialTemplateName(starter: Pick<StarterContent, "key" | "name">): string {
  return starter.key === BLANK_STARTER_KEY ? UNTITLED_TEMPLATE_NAME : starter.name;
}

/** A new template and its first draft, from a starter. Block ids in the body are kept as given. */
export function createDraft(input: {
  starter: StarterContent;
  createdBy: string;
  now: Date;
}): LifecycleResult<NewTemplateChanges> {
  const { starter, createdBy, now } = input;
  const name = initialTemplateName(starter);
  const isBlank = starter.key === BLANK_STARTER_KEY;

  return {
    changes: {
      template: { name, starterKey: isBlank ? null : starter.key, createdBy, createdAt: now },
      draft: {
        state: "draft",
        number: null,
        basedOnVersionId: null,
        body: clone(starter.body),
        emailSubject: clone(starter.emailSubject ?? null),
        emailPreheader: clone(starter.emailPreheader ?? null),
        channels: [...(starter.channels ?? DEFAULT_CHANNELS)],
        variables: clone([...starter.variables]),
        sampleSets: clone([...starter.sampleSets]),
        contractChanges: null,
        currentStage: 0,
        rev: 0,
        createdBy,
        writers: [createdBy],
        createdAt: now,
        updatedAt: now,
      },
    },
    effects: [
      {
        kind: "audit",
        action: "template.created",
        details: { name, source: isBlank ? "blank" : `starter:${starter.key}` },
      },
    ],
  };
}

// ── Editing an Active template ────────────────────────────────

/**
 * What "Edit" on a template does, given its versions: go to the open draft if there is one
 * (one open draft per template), copy the Active version if it is the template's latest, or say
 * it can't. A newer version in review (or any other newer version) blocks it: editing the Active
 * version then would fork the template and drop the newer version's changes.
 */
export type DraftStartPlan =
  | { kind: "open"; versionId: string }
  | { kind: "create"; from: string }
  | { kind: "blocked"; reason: string };

export function planDraftStart(
  versions: readonly { id: string; state: VersionState; number: number | null }[],
): DraftStartPlan {
  const open = versions.find((v) => v.state === "draft");
  if (open) return { kind: "open", versionId: open.id };

  const latest = versions.reduce<(typeof versions)[number] | undefined>(
    (best, v) => (best === undefined || (v.number ?? 0) > (best.number ?? 0) ? v : best),
    undefined,
  );
  if (latest?.state === "active") return { kind: "create", from: latest.id };
  if (latest?.state === "in_review") {
    return { kind: "blocked", reason: "A newer version is in review." };
  }
  return { kind: "blocked", reason: "Only an Active template can be edited." };
}

/**
 * A new draft copied from the Active version: body (block ids included, so comments and the redline
 * keep their anchors), variables, channels, email fields and sample sets. Contract changes are
 * worked out against the Active version when the draft is submitted, so none are recorded here.
 * Its writers start afresh with the person who pressed Edit: who wrote a released version doesn't
 * keep anyone from deciding the next one.
 */
export function editActive(input: {
  active: VersionSnapshot;
  createdBy: string;
  now: Date;
}): LifecycleResult<{ draft: DraftFields }> {
  const { active, createdBy, now } = input;
  if (active.state !== "active") {
    throw new LifecycleError(`Only an Active version can be edited, not ${active.state}.`);
  }

  return {
    changes: { draft: copyToDraft(active, createdBy, now, [createdBy]) },
    effects: [{ kind: "audit", action: "draft.started", details: { basedOn: active.number } }],
  };
}

// ── Writers (maker-checker) ───────────────────────────────────

/**
 * The version's writers with `userId` among them: unchanged when they already are, otherwise added at
 * the end. Autosave calls it for each person whose save lands; submit for the submitter.
 */
export function withWriter(writers: readonly string[], userId: string): string[] {
  return writers.includes(userId) ? [...writers] : [...writers, userId];
}

// ── Submit for review ─────────────────────────────────────────

/** What `submit` reads from the draft. The caller loads it from the version row. */
export interface SubmitDraft {
  state: VersionState;
  variables: readonly Variable[];
  body: JSONContent;
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
  channels: readonly Channel[];
  /** Who has written the draft (`DraftFields.writers`). */
  writers: readonly string[];
}

export interface SubmitChanges {
  state: "in_review";
  /** Assigned here and then frozen: one above the template's highest existing version number. */
  number: number;
  submittedBy: string;
  submittedAt: Date;
  /** The draft's writers with the submitter among them: whoever submits can't decide it either. */
  writers: string[];
  /** The author's note to reviewers, trimmed; null when there is none. */
  submitNote: string | null;
  /** The approval chain starts at its first stage. */
  currentStage: 0;
  /** How the variable list differs from the Active version's; null when there is no Active version. */
  contractChanges: ContractChange[] | null;
}

/** Either the changes to write and the effects to record, or the one-line reason it can't be done. */
export type SubmitResult = ({ ok: true } & LifecycleResult<SubmitChanges>) | { ok: false; reason: string };

export interface SubmitInput {
  draft: SubmitDraft;
  /** The template's highest version number (0 when it has none). */
  highestNumber: number;
  /** The Active version's variable list, or null when nothing is Active. */
  baseline: readonly Variable[] | null;
  now: Date;
  submittedBy: string;
  /** For the notification: "Maya Chen submitted Spring Travel Rewards — Terms v1 for review." */
  submitterName: string;
  templateId: string;
  templateName: string;
  /** The optional note to reviewers. */
  note?: string | null;
  /**
   * The content type's approval chain. Its first stage's rule says who is asked to review; without
   * it, the team's approvers are (the Release 1 chain, "Team approver").
   */
  chain?: readonly ApprovalStage[];
}

/**
 * Draft → In review, as the template's next version: a version number, the contract changes, the note,
 * an audit event, and a `review_requested` notification to the first stage's approvers (never anyone
 * who wrote it, the submitter included).
 *
 * Refuses, with the sentence the author reads, when
 *   - the version isn't a draft (a second tab, a double click);
 *   - a chip names a key the variable list doesn't have: in the document, and in the email subject
 *     and preheader while Email is on (they are not part of the output otherwise);
 *   - Email is on and the subject is empty.
 *
 * Renamed keys read as "removed" plus "added" here: the rename history lives in the editor session.
 */
export function submit(input: SubmitInput): SubmitResult {
  const { draft, highestNumber, baseline, now, submittedBy } = input;

  if (draft.state === "in_review") return { ok: false, reason: "This version is already in review." };
  if (draft.state !== "draft") return { ok: false, reason: "Only a draft can be submitted." };

  const emailOn = draft.channels.includes("email");

  const defined = new Set(draft.variables.map((v) => v.key));
  const fields = emailOn ? [draft.body, draft.emailSubject, draft.emailPreheader] : [draft.body];
  const undefinedKeys = unique(fields.flatMap((doc) => chipKeys(doc))).filter((key) => !defined.has(key));
  if (undefinedKeys.length > 0) {
    return { ok: false, reason: `Define or remove ${listKeys(undefinedKeys)} before submitting.` };
  }

  if (emailOn && isBlankField(draft.emailSubject)) {
    return { ok: false, reason: "Add an email subject before submitting." };
  }

  const number = highestNumber + 1;
  const contractChanges = baseline ? diffVariables(baseline, draft.variables) : null;
  const submitNote = trimmed(input.note);
  const firstStage = input.chain ? stageAt(input.chain, 0) : null;
  const writers = withWriter(draft.writers, submittedBy);

  return {
    ok: true,
    changes: {
      state: "in_review",
      number,
      submittedBy,
      submittedAt: now,
      writers,
      submitNote,
      currentStage: 0,
      contractChanges,
    },
    effects: [
      {
        kind: "audit",
        action: "version.submitted",
        details: {
          number,
          note: submitNote,
          contractChanges: contractChanges?.length ?? 0,
          breaking: contractChanges ? isBreaking(contractChanges) : false,
        },
      },
      notify({
        notification: "review_requested",
        to: firstStage ? stageRecipients(firstStage, writers) : teamApproversExcept(...writers),
        title: `${input.submitterName} submitted ${input.templateName} v${number} for review.`,
        body: submitNote,
        link: { to: "review", templateId: input.templateId, versionNumber: number },
      }),
    ],
  };
}

/** The keys of the chips in a document, in order of first use. */
function chipKeys(doc: JSONContent | null): string[] {
  return doc ? [...usageFromJSON(doc, { sections: false }).keys()] : [];
}

/** `{{a}}`, `{{a}} and {{b}}`, `{{a}}, {{b}} and {{c}}`. */
function listKeys(keys: readonly string[]): string {
  const named = keys.map((key) => `{{${key}}}`);
  return named.length <= 1 ? (named[0] ?? "") : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/** True when a one-line field has no text (spaces don't count) and no chip. */
function isBlankField(doc: JSONContent | null): boolean {
  if (!doc) return true;
  if (doc.type === "variable") return false;
  if (typeof doc.text === "string" && doc.text.trim() !== "") return false;
  return (doc.content ?? []).every(isBlankField);
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

// ── Review: shapes ────────────────────────────────────────────

export type Ok<T> = { ok: true } & T;
export type Refused = { ok: false; reason: string };
export type Outcome<T> = Ok<T> | Refused;

/** The sentences a refused review transition returns (maker-checker reasons come from `REASONS`). */
export const REFUSALS = {
  notInReview: "This version isn't in review.",
  stageMissing: "This version's approval stage no longer exists.",
  giveReason: "Give a reason.",
  sunsetAfterToday: "Pick a date after today.",
  sunsetNotSuperseded: "Only a Superseded version can have a sunset date.",
  sunsetPassed: "This version's sunset has passed. It can't render again.",
  notRevocable: "Only an Active or Superseded version can be revoked.",
  alreadyRevoked: "This version is already revoked.",
  revokePending: "A revoke is already waiting for confirmation.",
  noRevokePending: "There's no revoke waiting for confirmation.",
  approvedEarlierStage: "You approved an earlier stage.",
} as const;

/**
 * A numbered version as the review transitions read it. A `versions` row satisfies it as is
 * (the content fields are what a change request copies into the new draft).
 */
export interface ReviewVersion extends VersionSnapshot {
  templateId: string;
  submittedBy: string | null;
  /** Everyone who wrote it, the submitter included (`DraftFields.writers`): none of them may decide it. */
  writers: readonly string[];
  /** Index into the approval chain (in position order). */
  currentStage: number;
  contractChanges: readonly ContractChange[] | null;
  sunsetAt: Date | null;
  revoke: RevokeRecord | null;
}

/** A row for the `approvals` table (the id is assigned by the caller). Records what the approver saw. */
export interface ApprovalRecord {
  versionId: string;
  stagePosition: number;
  stageName: string;
  actorId: string;
  decision: "approved" | "changes_requested";
  reason: string | null;
  sampleSetsSeen: string[] | null;
  decidedAt: Date;
}

/** The change request's reason, posted as the first comment of a thread about the whole version. */
export interface ReasonComment {
  blockId: typeof DOCUMENT_THREAD;
  body: string;
  kind: "change_request";
}

// ── Request changes ───────────────────────────────────────────

export type RequestChangesResult = Outcome<{
  changes: { state: "changes_requested" };
  approval: ApprovalRecord;
  /** The author's next draft: the version's content with the SAME block ids, so the threads re-anchor. */
  newDraft: DraftFields;
  reasonComment: ReasonComment;
  effects: LifecycleEffect[];
}>;

/**
 * In review → Changes requested (kept read-only as a record), with a new Draft copied from it for the
 * author. Approver, never someone who wrote it (`makerCheckerRefusal`); the reason is required and
 * becomes a comment. The new draft keeps the version's writers, so they stay barred from deciding the
 * next round; the approver who sent it back joins them only by editing it. Resubmitting the draft gets
 * the next number.
 */
export function requestChanges(input: {
  version: ReviewVersion;
  chain: readonly ApprovalStage[];
  actorId: string;
  actorName: string;
  reason: string;
  now: Date;
  templateName: string;
}): RequestChangesResult {
  const { version, actorId, now } = input;

  if (version.state !== "in_review") return refuse(REFUSALS.notInReview);
  const wrote = makerCheckerRefusal(actorId, version);
  if (wrote) return refuse(wrote);
  const stage = stageAt(input.chain, version.currentStage);
  if (!stage) return refuse(REFUSALS.stageMissing);
  const reason = trimmed(input.reason);
  if (!reason) return refuse(REFUSALS.giveReason);

  const number = numberOf(version);
  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "version.changes_requested",
      details: { number, stage: stage.name, reason },
    },
  ];
  if (version.submittedBy) {
    effects.push(
      notify({
        notification: "changes_requested",
        to: { kind: "user", userId: version.submittedBy },
        title: `${input.actorName} requested changes on ${input.templateName} v${number}.`,
        body: reason,
        link: { to: "template", templateId: version.templateId },
      }),
    );
  }

  return {
    ok: true,
    changes: { state: "changes_requested" },
    approval: {
      versionId: version.id,
      stagePosition: stage.position,
      stageName: stage.name,
      actorId,
      decision: "changes_requested",
      reason,
      sampleSetsSeen: null,
      decidedAt: now,
    },
    // The draft is the author's to fix, so it is theirs, not the approver's. Its writers are the version's.
    newDraft: copyToDraft(version, version.submittedBy ?? actorId, now, version.writers),
    reasonComment: { blockId: DOCUMENT_THREAD, body: reason, kind: "change_request" },
    effects,
  };
}

// ── Approve ───────────────────────────────────────────────────

export interface ApproveChanges {
  /** "active" when this was the chain's last stage; otherwise the version stays in review. */
  state: "in_review" | "active";
  /** The next stage's index; unchanged at the last stage (it records the stage that decided). */
  currentStage: number;
  activatedAt: Date | null;
}

export interface SupersedeChanges {
  state: "superseded";
  supersededAt: Date;
  /** Only when the approver set a sunset for the previous version in the same step. */
  sunsetAt?: Date;
  sunsetSetBy?: string;
}

export interface Approved {
  changes: ApproveChanges;
  approval: ApprovalRecord;
  /** The version that was Active, now Superseded. Present only when this approval went live over one. */
  previous?: { id: string; changes: SupersedeChanges };
  wentLive: boolean;
  effects: LifecycleEffect[];
}

export type ApproveResult = Outcome<Approved>;

/**
 * Approve the stage the version is waiting on. At an earlier stage the version moves to the next one;
 * at the last stage it goes live: Active, and the previous Active becomes Superseded (pinned consumers
 * keep rendering it), with an optional sunset date for it in the same step.
 *
 * The caller checks who may act on the stage (`canActOnStage`); this refuses anyone who wrote the
 * version (maker-checker: its `writers` and submitter), a version no longer in review, a missing stage,
 * someone who already approved an earlier stage of this round (`approvedBy`: two stages need two
 * people), and a sunset date that isn't after today. `sampleSetsSeen` records which sample sets the
 * approver previewed.
 */
export function approve(input: {
  version: ReviewVersion;
  chain: readonly ApprovalStage[];
  actorId: string;
  actorName: string;
  now: Date;
  /** The template's Active version, which this one replaces when it goes live. */
  active: { id: string; number: number } | null;
  sunsetPrevious: Date | null;
  sampleSetsSeen: readonly string[];
  templateName: string;
  /**
   * Who approved a stage of this version already (its `approved` decisions; a version is reviewed in
   * one round, since a change request sends the next one in as a new number).
   */
  approvedBy?: readonly string[];
}): ApproveResult {
  const { version, chain, actorId, actorName, now, active, sunsetPrevious, templateName } = input;

  if (version.state !== "in_review") return refuse(REFUSALS.notInReview);
  const wrote = makerCheckerRefusal(actorId, version);
  if (wrote) return refuse(wrote);
  if (input.approvedBy?.includes(actorId)) return refuse(REFUSALS.approvedEarlierStage);
  const stages = orderedStages(chain);
  const index = version.currentStage;
  const stage = stages[index];
  if (!stage) return refuse(REFUSALS.stageMissing);
  if (sunsetPrevious && !isAfterToday(sunsetPrevious, now)) return refuse(REFUSALS.sunsetAfterToday);

  const number = numberOf(version);
  const approval: ApprovalRecord = {
    versionId: version.id,
    stagePosition: stage.position,
    stageName: stage.name,
    actorId,
    decision: "approved",
    reason: null,
    sampleSetsSeen: unique(input.sampleSetsSeen),
    decidedAt: now,
  };
  const review = { to: "review", templateId: version.templateId, versionNumber: number } as const;

  // ── An earlier stage: on to the next one ──
  const next = stages[index + 1];
  if (next) {
    const effects: LifecycleEffect[] = [
      {
        kind: "audit",
        action: "version.stage_approved",
        details: { number, stage: stage.name, stagePosition: stage.position, next: next.name },
      },
      notify({
        notification: "review_requested",
        to: stageRecipients(next, version.writers),
        title: `${templateName} v${number} is waiting on ${next.name}.`,
        link: review,
      }),
    ];
    if (version.submittedBy) {
      effects.push(
        notify({
          notification: "stage_approved",
          to: { kind: "user", userId: version.submittedBy },
          title: `${actorName} approved ${templateName} v${number} for ${stage.name}.`,
          body: `Next: ${next.name}.`,
          link: review,
        }),
      );
    }
    return {
      ok: true,
      changes: { state: "in_review", currentStage: index + 1, activatedAt: null },
      approval,
      wentLive: false,
      effects,
    };
  }

  // ── The last stage: the version goes live ──
  // The sunset goes on the version that is Active now (the action's compare-and-set checks it still is):
  // it is still rendering, so this starts a sunset and can't bring back one that has passed.
  const sunsetAt = active && sunsetPrevious ? sunsetPrevious : null;
  const contractChanges = [...(version.contractChanges ?? [])];
  const contractLines = describeChanges(contractChanges, number);

  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "version.activated",
      details: { number, supersedes: active?.number ?? null, stage: stage.name },
    },
  ];
  if (active) {
    effects.push({
      kind: "audit",
      action: "version.superseded",
      versionId: active.id,
      details: { number: active.number, supersededBy: number },
    });
  }
  if (active && sunsetAt) {
    effects.push({
      kind: "audit",
      action: "version.sunset_set",
      versionId: active.id,
      details: { number: active.number, sunsetAt: sunsetAt.toISOString(), previousSunsetAt: null },
    });
  }
  if (version.submittedBy) {
    effects.push(
      notify({
        notification: "version_live",
        to: { kind: "user", userId: version.submittedBy },
        title: `${templateName} v${number} is now Active.`,
        body: `${actorName} approved it.`,
        link: { to: "template", templateId: version.templateId },
      }),
    );
  }
  effects.push({
    kind: "consumer_notice",
    notice: "new_version",
    versionId: version.id,
    payload: { versionNumber: number, activeVersion: number, contractChanges, contractLines },
  });
  if (active && sunsetAt) {
    effects.push({
      kind: "consumer_notice",
      notice: "sunset_scheduled",
      versionId: active.id,
      payload: {
        versionNumber: active.number,
        activeVersion: number,
        sunsetAt: sunsetAt.toISOString(),
        contractChanges,
        contractLines,
      },
    });
  }

  const result: Ok<Approved> = {
    ok: true,
    changes: { state: "active", currentStage: index, activatedAt: now },
    approval,
    wentLive: true,
    effects,
  };
  if (active) {
    result.previous = {
      id: active.id,
      changes: sunsetAt
        ? { state: "superseded", supersededAt: now, sunsetAt, sunsetSetBy: actorId }
        : { state: "superseded", supersededAt: now },
    };
  }
  return result;
}

// ── Sunset ────────────────────────────────────────────────────

export type SetSunsetResult = Outcome<{
  changes: { sunsetAt: Date; sunsetSetBy: string };
  effects: LifecycleEffect[];
}>;

/**
 * True once a version's sunset has come: from that instant consumer renders of it fail
 * (`checkVersion` in render/version-rules.ts asks the same question).
 */
export function sunsetPassed(version: { sunsetAt: Date | null }, now: Date): boolean {
  return version.sunsetAt !== null && version.sunsetAt.getTime() <= now.getTime();
}

/**
 * Set, or move, the date a Superseded version stops rendering. Consumers still rendering it are
 * notified with the date and, when given, the contract changes the Active version brought
 * (`contractChanges`, worded against `activeNumber`).
 *
 * Once the sunset has passed it is final: the version has stopped rendering and its consumers have
 * moved on, so a new date would bring withdrawn content back. There is no clearing a sunset either,
 * and `approve` sets one only on the version that was Active a moment ago, which was still rendering.
 */
export function setSunset(input: {
  version: ReviewVersion;
  actorId: string;
  now: Date;
  sunsetAt: Date;
  activeNumber: number | null;
  templateName: string;
  contractChanges?: readonly ContractChange[] | null;
}): SetSunsetResult {
  const { version, actorId, now, sunsetAt, activeNumber, templateName } = input;

  if (version.state !== "superseded") return refuse(REFUSALS.sunsetNotSuperseded);
  if (sunsetPassed(version, now)) return refuse(REFUSALS.sunsetPassed);
  if (!isAfterToday(sunsetAt, now)) return refuse(REFUSALS.sunsetAfterToday);

  const number = numberOf(version);
  const at = sunsetAt.toISOString();
  const changes = [...(input.contractChanges ?? [])];

  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "version.sunset_set",
      details: { number, sunsetAt: at, previousSunsetAt: version.sunsetAt?.toISOString() ?? null },
    },
    {
      kind: "consumer_notice",
      notice: "sunset_scheduled",
      versionId: version.id,
      payload: {
        versionNumber: number,
        activeVersion: activeNumber,
        sunsetAt: at,
        ...(changes.length > 0 && activeNumber !== null
          ? { contractChanges: changes, contractLines: describeChanges(changes, activeNumber) }
          : {}),
      },
    },
  ];
  // The version's author hears about it, unless they set it themselves.
  if (version.submittedBy && version.submittedBy !== actorId) {
    effects.push(
      notify({
        notification: "sunset_scheduled",
        to: { kind: "user", userId: version.submittedBy },
        title: `${templateName} v${number} will stop rendering on ${formatLongDate(sunsetAt)}.`,
        link: { to: "versions", templateId: version.templateId },
      }),
    );
  }

  return { ok: true, changes: { sunsetAt, sunsetSetBy: actorId }, effects };
}

// ── Revoke (two people) ───────────────────────────────────────

export type StartRevokeResult = Outcome<{ changes: { revoke: RevokeRecord }; effects: LifecycleEffect[] }>;
export type ConfirmRevokeResult = Outcome<{
  changes: { state: "revoked"; revoke: RevokeRecord };
  effects: LifecycleEffect[];
}>;
export type CancelRevokeResult = Outcome<{ changes: { revoke: null }; effects: LifecycleEffect[] }>;

/** True while a revoke has been started and not yet confirmed or cancelled. */
export function revokePending(version: { revoke: RevokeRecord | null }): boolean {
  return version.revoke !== null && !version.revoke.confirmedAt;
}

/**
 * One approver starts a revoke (emergencies only) with a reason. Nothing stops rendering yet: a
 * different approver must confirm. The team's other approvers are asked to confirm or cancel.
 */
export function startRevoke(input: {
  version: ReviewVersion;
  actorId: string;
  actorName: string;
  reason: string;
  now: Date;
  templateName: string;
}): StartRevokeResult {
  const { version, actorId, now } = input;

  if (version.state === "revoked") return refuse(REFUSALS.alreadyRevoked);
  if (version.state !== "active" && version.state !== "superseded") return refuse(REFUSALS.notRevocable);
  if (revokePending(version)) return refuse(REFUSALS.revokePending);
  const reason = trimmed(input.reason);
  if (!reason) return refuse(REFUSALS.giveReason);

  const number = numberOf(version);
  return {
    ok: true,
    changes: { revoke: { reason, startedBy: actorId, startedAt: now.toISOString() } },
    effects: [
      { kind: "audit", action: "version.revoke_started", details: { number, reason } },
      notify({
        notification: "revoke_started",
        to: teamApproversExcept(actorId),
        title: `${input.actorName} started revoking ${input.templateName} v${number}. Confirm or cancel.`,
        body: reason,
        link: { to: "versions", templateId: version.templateId },
      }),
    ],
  };
}

/**
 * A different approver confirms: Revoked, and its renders fail at once. Revoking the Active version
 * leaves the template with no Active version; nothing is reinstated automatically.
 */
export function confirmRevoke(input: {
  version: ReviewVersion;
  actorId: string;
  actorName: string;
  now: Date;
  /** The template's Active version number (this one's, when it is the Active version). */
  activeNumber: number | null;
  templateName: string;
}): ConfirmRevokeResult {
  const { version, actorId, actorName, now, templateName } = input;

  const pending = pendingRevoke(version);
  if (!pending.ok) return pending;
  const started = pending.revoke;
  if (started.startedBy === actorId) return refuse(REASONS.ownRevoke);

  const number = numberOf(version);
  const wasActive = version.state === "active";
  const revoke: RevokeRecord = { ...started, confirmedBy: actorId, confirmedAt: now.toISOString() };
  const versions = { to: "versions", templateId: version.templateId } as const;
  const title = `${actorName} confirmed the revoke of ${templateName} v${number}.`;

  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "version.revoked",
      details: { number, reason: started.reason, startedBy: started.startedBy, wasActive },
    },
    {
      kind: "consumer_notice",
      notice: "revoked",
      versionId: version.id,
      payload: {
        versionNumber: number,
        activeVersion: wasActive ? null : input.activeNumber,
        reason: started.reason,
      },
    },
    // The approvers who were asked to confirm or cancel, the one who started it included.
    notify({ notification: "version_revoked", to: teamApproversExcept(actorId), title, body: started.reason, link: versions }),
  ];
  if (version.submittedBy && version.submittedBy !== actorId) {
    effects.push(
      notify({
        notification: "version_revoked",
        to: { kind: "user", userId: version.submittedBy },
        title,
        body: started.reason,
        link: versions,
      }),
    );
  }

  return { ok: true, changes: { state: "revoked", revoke }, effects };
}

/**
 * Withdraw a pending revoke. Any approver may: the one who started it (a mistake) or another one
 * (the "Confirm or cancel" they were asked). Cancelling returns to the safe state, where the version
 * keeps rendering, so the two-person rule that guards confirming isn't needed here. The caller checks
 * the approver permission.
 */
export function cancelRevoke(input: { version: ReviewVersion; actorId: string; now: Date }): CancelRevokeResult {
  const { version, actorId } = input;

  const pending = pendingRevoke(version);
  if (!pending.ok) return pending;
  const started = pending.revoke;

  return {
    ok: true,
    changes: { revoke: null },
    effects: [
      {
        kind: "audit",
        action: "version.revoke_cancelled",
        details: {
          number: numberOf(version),
          reason: started.reason,
          startedBy: started.startedBy,
          ownRevoke: started.startedBy === actorId,
        },
      },
    ],
  };
}

function pendingRevoke(version: ReviewVersion): ({ ok: true; revoke: RevokeRecord }) | Refused {
  if (version.state === "revoked") return refuse(REFUSALS.alreadyRevoked);
  if ((version.state !== "active" && version.state !== "superseded") || !version.revoke || version.revoke.confirmedAt) {
    return refuse(REFUSALS.noRevokePending);
  }
  return { ok: true, revoke: version.revoke };
}

// ── Review helpers ────────────────────────────────────────────

function refuse(reason: string): Refused {
  return { ok: false, reason };
}

/** A version past Draft always has its number; a missing one is a bug, not a refusal. */
function numberOf(version: { number: number | null; state: VersionState }): number {
  if (version.number === null) throw new LifecycleError(`A ${version.state} version has no number.`);
  return version.number;
}

/** Text with surrounding whitespace removed; null when nothing is left. */
function trimmed(value: string | null | undefined): string | null {
  const t = value?.trim() ?? "";
  return t === "" ? null : t;
}

/**
 * A sunset date must fall on a later (UTC) day than `now`, the demo clock. A date picked as
 * YYYY-MM-DD arrives as that day's midnight, so this is the same as "after now" for it.
 */
export function isAfterToday(date: Date, now: Date): boolean {
  return utcDay(date) > utcDay(now);
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function teamApproversExcept(...userIds: string[]): Recipients {
  return { kind: "team_role", role: "approver", exceptUserIds: userIds };
}

/** A notification effect; `body` is left out when there is none. */
function notify(n: Omit<NotificationEffect, "kind" | "body"> & { body?: string | null }): NotificationEffect {
  const { body, ...rest } = n;
  return body ? { kind: "notification", ...rest, body } : { kind: "notification", ...rest };
}

/**
 * A new draft copied from a version (Edit on the Active version, or a change request): body with every
 * block id (so comment threads and the redline keep their anchors), variables, channels, email fields
 * and sample sets. Contract changes are worked out at submit, so none are recorded here.
 */
function copyToDraft(version: VersionSnapshot, createdBy: string, now: Date, writers: readonly string[]): DraftFields {
  return {
    state: "draft",
    number: null,
    basedOnVersionId: version.id,
    body: clone(version.body),
    emailSubject: clone(version.emailSubject),
    emailPreheader: clone(version.emailPreheader),
    channels: [...version.channels],
    variables: clone([...version.variables]),
    sampleSets: clone([...version.sampleSets]),
    contractChanges: null,
    currentStage: 0,
    rev: 0,
    createdBy,
    writers: [...writers],
    createdAt: now,
    updatedAt: now,
  };
}

// ── Helpers ───────────────────────────────────────────────────

/** A deep copy, so a draft never shares objects with the version (or starter) it came from. */
function clone<T>(value: T): T {
  return value === null || value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
