// Template lifecycle rules (build plan, "Template lifecycle" and "Review and approval").
// Pure TypeScript: no framework, no database, no clock. The caller passes `now` and the ids it
// has generated; the server actions write the result inside one transaction.
//
// Each transition returns `{ changes, effects }`. `changes` are the field values to write;
// `effects` are the side records (audit events, notifications, consumer notices) that
// `server/effects.ts` writes in the same transaction.
//
//   newTemplateContentType  the content type a new Document or Alert is made on, for life
//   createDraft    — → Draft (a new template from a starter)
//   editLatest     the latest version, Active or Revoked → a new Draft copied from it ("Based on v3")
//   submit         Draft → In review, numbered, with its contract changes against `contractBaseline`
//   requestChanges In review → Changes requested, plus a new Draft carrying the block ids (and so the threads)
//   approve        In review → the next stage, or Active at the last one (the previous Active → Superseded)
//   setSunset      Superseded → Superseded with a sunset date (or a moved one), until that date passes.
//                  A sunset date ends renders at 00:00 on that day in the business time zone (business-zone.ts).
//   sweepSunsets   the clock passed a sunset → its `version.sunset_passed` audit row, dated when renders stopped,
//                  and its `sunset_passed` consumer notice, once. Not a state change: `sunsetPassed` alone
//                  decides whether a version renders.
//   startRevoke    Active or Superseded → revoke pending (one approver)
//   confirmRevoke  revoke pending → Revoked (a different approver)
//   cancelRevoke   revoke pending → no revoke
//
// The transitions the review phase added refuse with a code and a one-line reason (`{ ok: false, code,
// reason }`, from `REFUSALS`) rather than throwing: a second tab or a slower colleague gets there first,
// and the person reads why.
//
// The name is a version field, like the body: a new draft copies it, the author renames the draft, and
// it freezes at submit. A transition's `templateName` is the name of the version it is about
// (`version.name`): that is what its notifications call it.

import { diffVariables, isBreaking } from "@/editor/model/contract";
import { withoutInvisible } from "@/editor/model/links";
import { usageFromJSON } from "@/editor/model/usage";
import {
  approvedThisRound,
  currentStageOf,
  ownStages,
  recordStages,
  stageOf,
  stageRecipients,
  type RecordedDecision,
} from "./approval-chain";
import { sunsetDay as sunsetDayIn, sunsetInstant, todayIn } from "./business-zone";
import {
  channelFieldValue,
  channelFieldsOf,
  fieldNoun,
  fieldsOfChannels,
  typedText,
  type ChannelField,
  type ChannelFields,
  type ChannelFieldSpec,
} from "./channel-fields";
import { describeChanges } from "./contract";
import { nonGsmCharacters, smsLength } from "./messages/gsm7";
import { findPublicShorteners } from "./messages/links";
import { PUSH_MAX_BYTES, PUSH_PLATFORMS, pushPayloadBytes, type PushPlatform } from "./messages/push";
import { formatCount } from "./numbers";
import { REASONS, makerCheckerRefusal } from "./permissions";
import type { MessageTypeRules } from "./platform-config";
import { plural } from "./plural";
import { refusal, refuse, type Refusal, type Refused } from "./refusals";
import { characterLabel, joinWithAnd, PLATFORM_LABELS } from "./render/errors";
import { longSampleValues, resolveMessage } from "./render/message";
import { formatLongDate, utcDay } from "./dates";
import {
  DOCUMENT_THREAD,
  type ApprovalStage,
  type LifecycleEffect,
  type NotificationEffect,
  type Recipients,
  type VersionStage,
} from "./review-types";
import {
  TEMPLATE_KIND_LABELS,
  contentTypeFamily,
  familyOf,
  type Channel,
  type ChannelFamily,
  type ContractChange,
  type JSONContent,
  type RevokeRecord,
  type SampleSet,
  type Variable,
  type VersionState,
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

/**
 * The channels a new template starts with, by its content type's family: a document renders PDF and Web
 * (Email is a deliberate opt-in, as in the seed); a message (an Alert) renders Push and SMS.
 */
export const DEFAULT_CHANNELS: { readonly [F in ChannelFamily]: readonly Channel[] } = {
  document: ["pdf", "web"],
  message: ["push", "sms"],
};

/**
 * A new template's channels, given the ones its starter wants (none: the family's defaults) and the ones
 * its content type allows: the wanted ones the type allows; else the family's defaults it allows; else
 * the first channel it allows. A content type is one family, so these never mix.
 */
export function newTemplateChannels(wanted: readonly Channel[] | undefined, allowed: readonly Channel[]): Channel[] {
  const family = contentTypeFamily(allowed);
  const fits = (channels: readonly Channel[]) => channels.filter((c) => allowed.includes(c));
  const fromStarter = fits(wanted ?? []);
  if (fromStarter.length > 0) return fromStarter;
  const defaults = fits(DEFAULT_CHANNELS[family]);
  return defaults.length > 0 ? defaults : allowed.slice(0, 1);
}

/**
 * Why a draft can't be saved with these channels, or null: at least one is on (the channel chips never turn
 * off the last one, so only a crafted save sends none), and every one is a channel its content type allows,
 * which keeps a template in its content type's family.
 */
export function draftChannelsRefusal(channels: readonly Channel[], allowed: readonly Channel[]): Refusal | null {
  if (channels.length === 0) return REFUSALS.noChannels;
  if (!channels.every((channel) => allowed.includes(channel))) return REFUSALS.channelNotAllowed;
  return null;
}

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
  /**
   * The channels it renders. A starter without any is a document's (it has a body): `DEFAULT_CHANNELS.document`.
   * Fitted to the content type before the draft is made (`newTemplateChannels`, via `conformToContentType`).
   */
  channels?: readonly Channel[];
  /** The channel fields it ships with (an email subject, say). Defaults to none. */
  channelFields?: ChannelFields;
}

/** The content of a version that a draft is made from. */
export interface VersionSnapshot {
  id: string;
  number: number | null;
  state: VersionState;
  /** The template's name as this version has it. A draft copies it; renaming the draft changes only the draft. */
  name: string;
  body: JSONContent;
  channelFields: ChannelFields;
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
  /** The template's name in this draft: what the author renames, and what customers see once it goes live. */
  name: string;
  body: JSONContent;
  /** Each channel's own fields (channel-fields.ts), kept whether or not the channel is on. */
  channelFields: ChannelFields;
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
  /** The template has no name of its own: the first draft carries it (`draft.name`). */
  template: {
    /** Null for Blank, as in the seed. */
    starterKey: string | null;
    createdBy: string;
    createdAt: Date;
  };
  draft: DraftFields;
}

/** A content type as New template and Import choose one: its name and the channels it allows. */
export interface NewTemplateType {
  name: string;
  allowedChannels: readonly Channel[];
}

/**
 * The content type a new template of `family` is made on (the author chose Document or Alert): the
 * platform's content type of that family, the first by name when there are several. The template keeps
 * it for life, and so keeps its family: a content type never changes family (decision 0033). Refused,
 * with the sentence the author reads, when no content type is of that family.
 */
export function newTemplateContentType<T extends NewTemplateType>(
  family: ChannelFamily,
  contentTypes: readonly T[],
): Outcome<{ contentType: T }> {
  const [contentType] = contentTypes
    .filter((type) => familyOf(type.allowedChannels) === family)
    .sort((a, b) => a.name.localeCompare(b.name));
  return contentType ? { ok: true, contentType } : refuse(REFUSALS.noContentType(family));
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
      template: { starterKey: isBlank ? null : starter.key, createdBy, createdAt: now },
      draft: {
        state: "draft",
        number: null,
        basedOnVersionId: null,
        name,
        body: clone(starter.body),
        channelFields: clone(starter.channelFields ?? {}),
        channels: [...(starter.channels ?? DEFAULT_CHANNELS.document)],
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

// ── Editing a template ────────────────────────────────────────

/**
 * What "Edit" on a template does, given its versions: go to the open draft if there is one
 * (one open draft per template), copy the template's latest version if it is Active or Revoked, or
 * say it can't. A Revoked latest version was the Active one until it was withdrawn: the corrected
 * draft starts from its content (decision 0009). A pending revoke leaves the version Active, so it is
 * edited as Active. A newer version in review (or any other newer version) blocks it: editing then
 * would fork the template and drop the newer version's changes. Blocked, it carries the refusal
 * (`REFUSALS.newerInReview`, `REFUSALS.notEditable`) that `startDraft` answers with.
 */
export type DraftStartPlan =
  | { kind: "open"; versionId: string }
  | { kind: "create"; from: string }
  | ({ kind: "blocked" } & Refusal);

export function planDraftStart(
  versions: readonly { id: string; state: VersionState; number: number | null }[],
): DraftStartPlan {
  const open = versions.find((v) => v.state === "draft");
  if (open) return { kind: "open", versionId: open.id };

  const latest = versions.reduce<(typeof versions)[number] | undefined>(
    (best, v) => (best === undefined || (v.number ?? 0) > (best.number ?? 0) ? v : best),
    undefined,
  );
  if (latest?.state === "active" || latest?.state === "revoked") return { kind: "create", from: latest.id };
  return { kind: "blocked", ...(latest?.state === "in_review" ? REFUSALS.newerInReview : REFUSALS.notEditable) };
}

/**
 * A new draft copied from the version `planDraftStart` chose, the template's latest, Active or
 * Revoked: its name, body (block ids included, so comments and the redline keep their anchors),
 * variables, channels, channel fields and sample sets. `basedOnVersionId` is that version, revoked or not.
 * Contract changes are worked out at submit, against `contractBaseline`, so none are recorded here.
 * Its writers start afresh with the person who pressed Edit: who wrote a released version doesn't
 * keep anyone from deciding the next one.
 */
export function editLatest(input: {
  from: VersionSnapshot;
  createdBy: string;
  now: Date;
}): LifecycleResult<{ draft: DraftFields }> {
  const { from, createdBy, now } = input;
  if (from.state !== "active" && from.state !== "revoked") {
    throw new LifecycleError(`Only an Active or Revoked version can be edited, not ${from.state}.`);
  }

  return {
    changes: { draft: copyToDraft(from, createdBy, now, [createdBy]) },
    effects: [{ kind: "audit", action: "draft.started", details: { basedOn: from.number } }],
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

// ── The contract baseline ─────────────────────────────────────

/**
 * The version a draft's contract changes are worked out against: the newest one consumers can still
 * render. That is the Active version when there is one. When there's none (the Active version was
 * revoked), it is the highest-numbered Superseded version whose sunset hasn't passed. A version
 * waiting on a revoke confirmation still renders, so it counts. Null when nothing renders, the same
 * as for a first version. Submit stores the diff against it, and the submit dialog and the
 * workspace's variable flags compare with the same version.
 */
export function contractBaseline<V extends { state: VersionState; number: number | null; sunsetAt: Date | null }>(
  versions: readonly V[],
  now: Date,
): V | null {
  const active = versions.find((v) => v.state === "active");
  if (active) return active;
  return versions
    .filter((v) => v.state === "superseded" && !sunsetPassed(v, now))
    .reduce<V | null>((best, v) => (best === null || (v.number ?? 0) > (best.number ?? 0) ? v : best), null);
}

// ── The review baseline ───────────────────────────────────────

/** What `reviewBaseline` reads of each of the template's versions. */
export interface BaselineFacts {
  id: string;
  state: VersionState;
  number: number | null;
  sunsetAt: Date | null;
  /** The version its draft was copied from (`DraftFields.basedOnVersionId`). */
  basedOnVersionId: string | null;
}

/** States a version reaches only once approved: one of them is text that was released. */
const RELEASED_STATES: ReadonlySet<VersionState> = new Set(["active", "superseded", "revoked"]);

/**
 * The version the review screen compares `versionId` with: its redline, the "vs vN" label and the
 * change count. The Active version when there is one (null when that is the version itself).
 *
 * With none Active (it was revoked), the released version the draft was based on: the revoked text
 * the correction started from, since checking the fix to it is the approver's job here. A draft a
 * change request opened is based on the version sent back, so the walk goes on through those to the
 * released one. When the walk finds none (a first version, or a based-on version that is missing),
 * the newest version that still renders (`contractBaseline`); null when nothing does, as for a first
 * version (decision 0031).
 *
 * Not the Approve dialog's previous version: that is the Active one only.
 */
export function reviewBaseline<V extends BaselineFacts>(versions: readonly V[], versionId: string, now: Date): V | null {
  const active = versions.find((v) => v.state === "active");
  if (active) return active.id === versionId ? null : active;

  const byId = new Map(versions.map((v) => [v.id, v]));
  const seen = new Set([versionId]);
  for (let id = byId.get(versionId)?.basedOnVersionId ?? null; id !== null && !seen.has(id); ) {
    seen.add(id);
    const base = byId.get(id);
    if (!base) break;
    if (RELEASED_STATES.has(base.state) && base.number !== null) return base;
    if (base.state !== "changes_requested") break;
    id = base.basedOnVersionId;
  }

  const live = contractBaseline(versions, now);
  return live && live.id !== versionId ? live : null;
}

// ── Submit for review ─────────────────────────────────────────

/** What `submit` reads from the draft. The caller loads it from the version row. */
export interface SubmitDraft {
  state: VersionState;
  variables: readonly Variable[];
  body: JSONContent;
  channelFields: ChannelFields;
  channels: readonly Channel[];
  /** Its sample sets: a message is measured with the "long" one (or that set's defaults when it has none). */
  sampleSets: readonly SampleSet[];
  /** Who has written the draft (`DraftFields.writers`). */
  writers: readonly string[];
  /** Moves with every write to the version row: each autosave that lands, and every transition. */
  rev: number;
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
  /**
   * The stages this version goes through, recorded now from the chain: by id and name, in order. Later
   * chain edits don't change them; each stage's rule is read from the chain when the version reaches it.
   */
  stages: VersionStage[];
  /** The version starts at the first of its stages. */
  currentStage: 0;
  /** How the variable list differs from the baseline's (`contractBaseline`); null when there is no baseline. */
  contractChanges: ContractChange[] | null;
  /**
   * The content type's SMS footer as it stands now, frozen into the version with the rest of what was
   * submitted (`versions.sms_footer`): every render of this version prints it, whatever the content type's
   * footer becomes later. Null when the content type has none (a document's never does).
   */
  smsFooter: string | null;
}

/** Either the changes to write and the effects to record, or the one-line reason it can't be done. */
export type SubmitResult = ({ ok: true } & LifecycleResult<SubmitChanges>) | Refused;

/**
 * The SMS footer a version prints (decision 0034): a draft's is its content type's as it stands, since it
 * isn't submitted yet; every submitted version's is the one frozen into it at submit (`SubmitChanges.smsFooter`),
 * so a later change to the content type's footer never reaches a version that was already reviewed.
 */
export function smsFooterOf(version: { state: VersionState; smsFooter: string | null }, contentTypeFooter: string | null): string | null {
  return version.state === "draft" ? contentTypeFooter : version.smsFooter;
}

export interface SubmitInput {
  draft: SubmitDraft;
  /**
   * The draft's `rev` when the submitter's summary was read (`SubmitSummary.rev`): what they were
   * shown is what gets frozen, so a draft that has moved on since is refused.
   */
  seenRev: number;
  /** The template's highest version number (0 when it has none). */
  highestNumber: number;
  /** The variable list of the newest version that still renders (`contractBaseline`), or null when none does. */
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
   * The content type's approval chain, never empty (the server falls back to Release 1's "Team
   * approver"). The version records its stages, and its first stage's rule says who is asked to review.
   */
  chain: readonly ApprovalStage[];
  /** The content type's SMS footer and part budget: a message's checks measure the SMS with them. */
  messageRules: MessageTypeRules;
}

/**
 * Draft → In review, as the template's next version: a version number, the contract changes, the note,
 * the stages it will go through (the chain as it is now), the content type's SMS footer (frozen with it),
 * an audit event, and a `review_requested` notification to the first stage's approvers (never anyone who
 * wrote it, the submitter included).
 *
 * Refuses, with the sentence the author reads, when
 *   - the version isn't a draft (a second tab, a double click);
 *   - the draft changed after the submitter's summary was read (`seenRev`): a save that landed
 *     meanwhile, from this page or another, would otherwise be frozen without being shown;
 *   - no channel is on (only a crafted save can store that: it would render nothing and skip every
 *     channel's rules);
 *   - a chip names a key the variable list doesn't have: in the document, and in the fields of the
 *     channels that are on (channel-fields.ts; a field isn't part of the output while its channel is off);
 *   - a required field of a channel that is on is blank (Email's subject): the first such field;
 *   - a message breaks a rule its channels have (`messageRefusal`, decisions 0033 and 0034): the SMS has
 *     characters the author typed outside GSM-7, or takes more parts than the content type allows with
 *     the "long" sample values; a push body or SMS links through a public shortener; or a push is over
 *     4,096 bytes on either platform with the long values.
 *
 * A renamed key is one `key_renamed` change: the renamed variable keeps its identity as its id
 * (`Variable.id`), so `diffVariables` pairs it with the baseline's variable whatever it is keyed now.
 */
export function submit(input: SubmitInput): SubmitResult {
  const { draft, highestNumber, baseline, now, submittedBy } = input;

  if (draft.state === "in_review") return refuse(REFUSALS.alreadyInReview);
  if (draft.state !== "draft") return refuse(REFUSALS.notDraft);
  if (draft.rev !== input.seenRev) return refuse(REFUSALS.summaryStale);
  if (draft.channels.length === 0) return refuse(REFUSALS.noChannels);

  const fields = fieldsOfChannels(draft.channels);

  const defined = new Set(draft.variables.map((v) => v.key));
  const docs = [draft.body, ...fields.map((field) => channelFieldValue(draft.channelFields, field))];
  const undefinedKeys = unique(docs.flatMap((doc) => chipKeys(doc))).filter((key) => !defined.has(key));
  if (undefinedKeys.length > 0) return refuse(REFUSALS.undefinedVariables(undefinedKeys));

  const missing = fields.find((field) => field.required && isBlankField(channelFieldValue(draft.channelFields, field)));
  if (missing) return refuse(REFUSALS.fieldMissing(missing));

  const message = messageRefusal(draft, input.messageRules, now);
  if (message) return refuse(message);

  const number = highestNumber + 1;
  const contractChanges = baseline ? diffVariables(baseline, draft.variables) : null;
  const submitNote = trimmed(input.note);
  const stages = recordStages(input.chain);
  const firstStage = stageOf(stages, 0, input.chain);
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
      stages,
      currentStage: 0,
      contractChanges,
      smsFooter: input.messageRules.smsFooter,
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
        // Nobody has approved anything yet, so the first stage always has someone to ask.
        to: (firstStage && stageRecipients(firstStage, writers)) || teamApproversExcept(...writers),
        title: `${input.submitterName} submitted ${input.templateName} v${number} for review.`,
        body: submitNote,
        link: { to: "review", templateId: input.templateId, versionNumber: number },
      }),
    ],
  };
}

/**
 * Why a message can't be submitted, or null: the rules of Push and SMS that render can't check, because
 * they hold for any values, or are tighter than render's own limits. In this order, the first that fails:
 *   1. SMS characters: every character the author typed in an SMS field is GSM-7. One that isn't would
 *      switch every message to UCS-2 (a third of the room); the composer offers a fix for each. Values
 *      aren't checked: a customer's "Gómez" prints as sent and the API reports the encoding.
 *   2. SMS parts: with the "long" sample values and the footer, the SMS takes at most the content
 *      type's budget of parts (`smsMaxParts`).
 *   3. Public shorteners: no link the author typed in a push body or SMS (`refusesShorteners`) is on a
 *      public URL shortener.
 *   4. Push size: with the long sample values, the push is at most PUSH_MAX_BYTES on each platform.
 * The long values are the draft's "long" sample set (its defaults when the draft has none). A value in
 * it that no longer validates (its variable changed type since) gives way to the generated long value
 * (`longSampleValues`), so 2 and 4 always measure something, as the composer's meta line does.
 */
function messageRefusal(draft: SubmitDraft, rules: MessageTypeRules, now: Date): Refusal | null {
  const on = (channel: Channel) => draft.channels.includes(channel);
  if (!on("push") && !on("sms")) return null;
  const valueOf = (field: ChannelField) => channelFieldValue(draft.channelFields, field);

  if (on("sms")) {
    for (const field of channelFieldsOf("sms")) {
      const outside = nonGsmCharacters(typedText(valueOf(field)));
      if (outside.length > 0) return REFUSALS.smsCharacters(field, outside.map((c) => c.char));
    }
  }

  const input = { fields: draft.channelFields, variables: draft.variables, values: longSampleValues(draft, utcDay(now)), rules };
  if (on("sms")) {
    const { parts } = smsLength(resolveMessage({ channel: "sms" }, input));
    if (parts > rules.smsMaxParts) return REFUSALS.smsParts(parts, rules.smsMaxParts);
  }

  for (const field of fieldsOfChannels(draft.channels)) {
    if (!field.refusesShorteners) continue;
    const links = findPublicShorteners(typedText(valueOf(field)));
    if (links.length > 0) return REFUSALS.publicShortener(field, links.map((link) => link.domain));
  }

  if (on("push")) {
    for (const platform of PUSH_PLATFORMS) {
      const bytes = pushPayloadBytes(platform, resolveMessage({ channel: "push", platform }, input));
      if (bytes > PUSH_MAX_BYTES) return REFUSALS.pushTooLarge(platform, bytes);
    }
  }
  return null;
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

/**
 * True when a field has no text and no chip. Spaces don't count, and neither do invisible characters, which a
 * message's field keeps (src/editor/model/characters.ts): a push title of a zero-width space shows nothing.
 */
function isBlankField(doc: JSONContent | null): boolean {
  if (!doc) return true;
  if (doc.type === "variable") return false;
  if (typeof doc.text === "string" && withoutInvisible(doc.text).trim() !== "") return false;
  return (doc.content ?? []).every(isBlankField);
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

// ── Review: shapes ────────────────────────────────────────────

export type Ok<T> = { ok: true } & T;
export type { Refused };
export type Outcome<T> = Ok<T> | Refused;

/**
 * What a refused submit or review transition returns: a code to branch on and the sentence people read
 * (maker-checker refusals come from `REASONS`).
 */
export const REFUSALS = {
  /** New template (`newTemplateContentType`): "No content type makes alerts yet." */
  noContentType: refusal(
    "no_content_type",
    (family: ChannelFamily) => `No content type makes ${TEMPLATE_KIND_LABELS[family].toLowerCase()}s yet.`,
  ),
  /** Edit (`planDraftStart`): a newer version is in review, so a draft now would fork the template. */
  newerInReview: refusal("newer_in_review", "A newer version is in review."),
  notEditable: refusal("not_editable", "Only an Active or Revoked template can be edited."),
  alreadyInReview: refusal("already_in_review", "This version is already in review."),
  notDraft: refusal("not_draft", "Only a draft can be submitted."),
  /** `submit` and a draft save (`draftChannelsRefusal`): a version with no channel renders nothing and skips every channel's rules. */
  noChannels: refusal("no_channels", "Turn on at least one channel."),
  /** A draft save (`draftChannelsRefusal`): a channel its content type doesn't allow, which would mix families. */
  channelNotAllowed: refusal("channel_unavailable", "That channel isn't available for this content type."),
  /** `submit`, when the draft changed after the summary the submitter saw. The submit dialog offers to refresh it. */
  summaryStale: refusal("summary_stale", "This draft changed after this summary was made."),
  undefinedVariables: refusal(
    "undefined_variables",
    (keys: readonly string[]) => `Define or remove ${listKeys(keys)} before submitting.`,
  ),
  /** `submit`, when a required channel field (channel-fields.ts) is blank: "Add an email subject before submitting." */
  fieldMissing: refusal(
    "field_missing",
    (field: Pick<ChannelFieldSpec, "name">) => `Add ${fieldNoun(field)} before submitting.`,
  ),
  /**
   * `submit`: characters the author typed in an SMS that aren't in GSM-7, each once, in order:
   * "Replace ’ and – in the SMS message before submitting. They aren't in the SMS character set."
   */
  smsCharacters: refusal("sms_characters", (field: Pick<ChannelFieldSpec, "name">, chars: readonly string[]) => {
    const labels = unique(chars.map(characterLabel));
    const they = labels.length === 1 ? "It isn't" : "They aren't";
    return `Replace ${joinWithAnd(labels)} in the ${field.name} before submitting. ${they} in the SMS character set.`;
  }),
  /** `submit`: "With the long sample values, the SMS is 4 parts. Keep it to 3 parts or fewer." */
  smsParts: refusal(
    "sms_too_many_parts",
    (parts: number, max: number) =>
      `With the long sample values, the SMS is ${plural(parts, "part")}. Keep it to ${plural(max, "part")} or fewer.`,
  ),
  /** `submit`: "The SMS message links through bit.ly, a public link shortener carriers filter. Use a link on your own domain." */
  publicShortener: refusal(
    "public_shortener",
    (field: Pick<ChannelFieldSpec, "name">, domains: readonly string[]) => {
      const names = unique(domains);
      const what = names.length === 1 ? "a public link shortener" : "public link shorteners";
      return `The ${field.name} links through ${joinWithAnd(names)}, ${what} carriers filter. Use a link on your own domain.`;
    },
  ),
  /** `submit`: "With the long sample values, the push is 4,321 bytes on iPhone. It can be at most 4,096 bytes." */
  pushTooLarge: refusal(
    "push_too_large",
    (platform: PushPlatform, bytes: number) =>
      `With the long sample values, the push is ${formatCount(bytes)} bytes on ${PLATFORM_LABELS[platform]}. It can be at most ${formatCount(PUSH_MAX_BYTES)} bytes.`,
  ),
  notInReview: refusal("not_in_review", "This version isn't in review."),
  stageMissing: refusal("stage_missing", "This version's approval stage no longer exists."),
  giveReason: refusal("reason_missing", "Give a reason."),
  sunsetAfterToday: refusal("sunset_not_after_today", "Pick a date after today."),
  sunsetNotSuperseded: refusal("sunset_not_superseded", "Only a Superseded version can have a sunset date."),
  sunsetPassed: refusal("sunset_passed", "This version's sunset has passed. It can't render again."),
  notRevocable: refusal("not_revocable", "Only an Active or Superseded version can be revoked."),
  alreadyRevoked: refusal("already_revoked", "This version is already revoked."),
  revokePending: refusal("revoke_pending", "A revoke is already waiting for confirmation."),
  noRevokePending: refusal("no_revoke_pending", "There's no revoke waiting for confirmation."),
  approvedEarlierStage: refusal("approved_earlier_stage", "You approved an earlier stage."),
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
  /** The stages it goes through, recorded at submit (`SubmitChanges.stages`); null only for a draft. */
  stages: readonly VersionStage[] | null;
  /** A position in its own `stages`. */
  currentStage: number;
  contractChanges: readonly ContractChange[] | null;
  sunsetAt: Date | null;
  revoke: RevokeRecord | null;
}

/** A row for the `approvals` table (the id is assigned by the caller). Records what the approver saw. */
export interface ApprovalRecord {
  versionId: string;
  /** The chain stage decided (`approval_stages.id`): decisions are read back by it. */
  stageId: string;
  /** Its position in the version's own stages, and its name as the version recorded it. */
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
  const stage = currentStageOf(version, input.chain);
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
      stageId: stage.id,
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
  /** "active" when this was the last of the version's own stages; otherwise the version stays in review. */
  state: "in_review" | "active";
  /** The next stage's position in its own stages; unchanged at the last stage (it records the stage that decided). */
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
 * Approve the stage the version is waiting on. The version goes through its own stages (recorded at
 * submit), whatever the chain looks like now: at an earlier one it moves to the next; at its last it
 * goes live: Active, and the previous Active becomes Superseded (pinned consumers keep rendering it),
 * with an optional sunset date for it in the same step. Each stage's rule is the one its chain stage
 * has now (`stageOf`).
 *
 * The caller checks who may act on the stage (`canActOnStage`); this refuses anyone who wrote the
 * version (maker-checker: its `writers` and submitter), a version no longer in review, someone who
 * already approved a stage of it (`approvedThisRound`: two stages need two people), a stage missing
 * from the chain, and a sunset date that isn't after today in the business time zone. The next stage's
 * "review requested" goes to nobody who approved a stage of it, this approver included.
 * `sampleSetsSeen` records which sample sets the approver previewed.
 */
export function approve(input: {
  version: ReviewVersion;
  chain: readonly ApprovalStage[];
  actorId: string;
  actorName: string;
  now: Date;
  /**
   * The template's Active version, which this one replaces when it goes live. Null for a first version
   * and after the Active version was revoked: nothing is superseded, and `sunsetPrevious` is ignored.
   */
  active: { id: string; number: number } | null;
  /** YYYY-MM-DD: the day the previous version stops rendering, at 00:00 in `zone`; null for none. */
  sunsetPrevious: string | null;
  /** The business time zone (`business-zone.ts`): what the sunset day and "today" are read in. */
  zone: string;
  sampleSetsSeen: readonly string[];
  templateName: string;
  /**
   * The version's decisions so far (its approvals rows). A version is reviewed in one round, since a
   * change request sends the next one in as a new number.
   */
  decisions?: readonly RecordedDecision[];
}): ApproveResult {
  const { version, chain, actorId, actorName, now, active, sunsetPrevious, zone, templateName } = input;

  if (version.state !== "in_review") return refuse(REFUSALS.notInReview);
  const wrote = makerCheckerRefusal(actorId, version);
  if (wrote) return refuse(wrote);
  const approved = approvedThisRound(input.decisions ?? []);
  if (approved.includes(actorId)) return refuse(REFUSALS.approvedEarlierStage);
  const stages = ownStages(version.stages, chain);
  const index = version.currentStage;
  const stage = stageOf(stages, index, chain);
  if (!stage) return refuse(REFUSALS.stageMissing);
  const isLast = index === stages.length - 1;
  const next = isLast ? null : stageOf(stages, index + 1, chain);
  if (!isLast && !next) return refuse(REFUSALS.stageMissing);
  if (sunsetPrevious !== null && !isAfterToday(sunsetPrevious, now, zone)) return refuse(REFUSALS.sunsetAfterToday);

  const number = numberOf(version);
  const approval: ApprovalRecord = {
    versionId: version.id,
    stageId: stage.id,
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
  if (next) {
    const effects: LifecycleEffect[] = [
      {
        kind: "audit",
        action: "version.stage_approved",
        details: { number, stage: stage.name, stagePosition: stage.position, next: next.name },
      },
    ];
    // Not anyone who has approved a stage of this round, this approver included: they can't take this one.
    const asked = stageRecipients(next, version.writers, [...approved, actorId]);
    if (asked) {
      effects.push(
        notify({
          notification: "review_requested",
          to: asked,
          title: `${templateName} v${number} is waiting on ${next.name}.`,
          link: review,
        }),
      );
    }
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
  const sunset = active && sunsetPrevious !== null ? sunsetOn(sunsetPrevious, zone) : null;
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
  if (active && sunset) {
    effects.push({
      kind: "audit",
      action: "version.sunset_set",
      versionId: active.id,
      details: { number: active.number, ...sunset.details, previousSunsetAt: null },
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
  if (active && sunset) {
    effects.push({
      kind: "consumer_notice",
      notice: "sunset_scheduled",
      versionId: active.id,
      payload: {
        versionNumber: active.number,
        activeVersion: number,
        sunsetAt: sunset.details.sunsetAt,
        sunsetDay: sunset.details.sunsetDay,
        zone: sunset.details.zone,
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
      changes: sunset
        ? { state: "superseded", supersededAt: now, sunsetAt: sunset.at, sunsetSetBy: actorId }
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
 * True once a version's sunset has come: from that instant consumer renders of it fail. The one test of
 * "sunset passed": the render rule (`checkVersion`), the consumer API, the read models, `setSunset` and
 * `sweepSunsets` all call it. An instant comparison on the demo clock; the day is in business-zone.ts.
 */
export function sunsetPassed(version: { sunsetAt: Date | null }, now: Date): boolean {
  return version.sunsetAt !== null && version.sunsetAt.getTime() <= now.getTime();
}

/**
 * Set, or move, the date a Superseded version stops rendering: `sunsetDay`, which ends at 00:00 in the
 * business time zone (`zone`, decision 0017), and must come after today there. Consumers still rendering
 * it are notified with the instant and, when given, the contract changes the Active version brought
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
  /** YYYY-MM-DD. */
  sunsetDay: string;
  /** The business time zone (`business-zone.ts`). */
  zone: string;
  activeNumber: number | null;
  templateName: string;
  contractChanges?: readonly ContractChange[] | null;
}): SetSunsetResult {
  const { version, actorId, now, sunsetDay, zone, activeNumber, templateName } = input;

  if (version.state !== "superseded") return refuse(REFUSALS.sunsetNotSuperseded);
  if (sunsetPassed(version, now)) return refuse(REFUSALS.sunsetPassed);
  if (!isAfterToday(sunsetDay, now, zone)) return refuse(REFUSALS.sunsetAfterToday);

  const number = numberOf(version);
  const sunset = sunsetOn(sunsetDay, zone);
  const changes = [...(input.contractChanges ?? [])];

  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "version.sunset_set",
      details: { number, ...sunset.details, previousSunsetAt: version.sunsetAt?.toISOString() ?? null },
    },
    {
      kind: "consumer_notice",
      notice: "sunset_scheduled",
      versionId: version.id,
      payload: {
        versionNumber: number,
        activeVersion: activeNumber,
        sunsetAt: sunset.details.sunsetAt,
        sunsetDay,
        zone,
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
        title: `${templateName} v${number} will stop rendering on ${formatLongDate(sunsetDay)}.`,
        link: { to: "versions", templateId: version.templateId },
      }),
    );
  }

  return { ok: true, changes: { sunsetAt: sunset.at, sunsetSetBy: actorId }, effects };
}

/**
 * A sunset on `day`: the instant renders stop (00:00 there in `zone`) and what the audit row records
 * beside it, the day as picked and the zone it was read in, so the record keeps saying "March 1" whatever
 * the zone is later.
 */
function sunsetOn(day: string, zone: string) {
  const at = sunsetInstant(day, zone);
  return { at, details: { sunsetAt: at.toISOString(), sunsetDay: day, zone } };
}

/** A version with a sunset, as `sweepSunsets` reads it. */
export interface SunsetFacts {
  id: string;
  templateId: string;
  teamId: string;
  number: number | null;
  state: VersionState;
  sunsetAt: Date | null;
  /** When a revoke was confirmed (`revoke.confirmedAt`); null when it wasn't revoked. */
  revokedAt: Date | null;
  /** Whether a `version.sunset_passed` row already records it. */
  passedRecorded: boolean;
  /** The template's Active version number at the sweep, the one its consumers move to; null when none is Active. */
  activeNumber: number | null;
}

/** One sunset the sweep found passed and unrecorded, with the row and the notice to write for it. */
export interface PassedSunset {
  versionId: string;
  templateId: string;
  teamId: string;
  /**
   * The instant renders stopped: the audit row is dated then, however late the sweep runs, and the notice
   * goes to the consumers that rendered the template from 90 days before it on.
   */
  at: Date;
  effects: LifecycleEffect[];
}

/**
 * The sunsets the clock has passed that nothing records yet, each with its `version.sunset_passed` audit
 * row (actor: the system) and its `sunset_passed` consumer notice. Both name the sunset's instant and its
 * day in `zone`, the business time zone at the sweep, which is the day the Versions screen shows for it.
 * The row is dated at the sunset. The notice names the version to move to, the template's Active one (or
 * none). Oldest first.
 *
 * - **Passed** is `sunsetPassed`, the render rule's own test, so the record says exactly when renders
 *   stopped.
 * - **Still rendering until then.** A version revoked at or before its sunset had already stopped, so its
 *   sunset ends nothing and isn't recorded. One revoked after its sunset (the only change a passed
 *   sunset allows) is.
 * - **Once.** A version with a record is skipped, so a second sweep writes nothing: no second row and no
 *   second notice. A passed sunset never moves (decision 0002), so one record per version is the whole
 *   story.
 *
 * No notification: the author was told the day when the sunset was set
 * ([decision 0026](../../docs/decisions/0026-a-passed-sunset-is-recorded-by-a-sweep.md)). Consumers get the
 * notice so that their notices say a version stopped rendering, as they say when one is revoked
 * ([decision 0032](../../docs/decisions/0032-consumers-are-told-when-a-sunset-passes.md)). It arrives when
 * the sweep runs, which can be after the instant; its `sunsetAt` says when renders stopped.
 */
export function sweepSunsets(input: { versions: readonly SunsetFacts[]; now: Date; zone: string }): PassedSunset[] {
  const { now, zone } = input;
  const endedRenders = (v: SunsetFacts): v is SunsetFacts & { sunsetAt: Date; number: number } => {
    if (v.sunsetAt === null || v.number === null || !sunsetPassed(v, now)) return false;
    if (v.state === "superseded") return true;
    return v.state === "revoked" && v.revokedAt !== null && v.revokedAt.getTime() > v.sunsetAt.getTime();
  };
  return input.versions
    .filter((v) => !v.passedRecorded)
    .filter(endedRenders)
    .sort((a, b) => a.sunsetAt.getTime() - b.sunsetAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((v) => {
      const sunset = { sunsetAt: v.sunsetAt.toISOString(), sunsetDay: sunsetDayIn(v.sunsetAt, zone), zone };
      return {
        versionId: v.id,
        templateId: v.templateId,
        teamId: v.teamId,
        at: v.sunsetAt,
        effects: [
          { kind: "audit", action: "version.sunset_passed", details: { number: v.number, ...sunset } },
          {
            kind: "consumer_notice",
            notice: "sunset_passed",
            versionId: v.id,
            payload: { versionNumber: v.number, activeVersion: v.activeNumber, ...sunset },
          },
        ],
      };
    });
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
 * leaves the template with no Active version; nothing is reinstated automatically. Edit then starts
 * the corrected draft from the revoked version (`planDraftStart`), and approving it goes live with
 * nothing to supersede.
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
 * A sunset date (YYYY-MM-DD) must be a later day than today in the business time zone, on the demo clock.
 * Its sunset is 00:00 on that day there, so this is the same as "after now" for it: at 23:30 Eastern on
 * October 9 (03:30 UTC on the 10th), October 10 is still after today.
 */
export function isAfterToday(day: string, now: Date, zone: string): boolean {
  return day > todayIn(now, zone);
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
 * A new draft copied from a version (Edit on the latest version, or a change request): its name, body
 * with every block id (so comment threads and the redline keep their anchors), variables, channels,
 * channel fields and sample sets. Contract changes are worked out at submit, so none are recorded here.
 */
function copyToDraft(version: VersionSnapshot, createdBy: string, now: Date, writers: readonly string[]): DraftFields {
  return {
    state: "draft",
    number: null,
    basedOnVersionId: version.id,
    name: version.name,
    body: clone(version.body),
    channelFields: clone(version.channelFields),
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
