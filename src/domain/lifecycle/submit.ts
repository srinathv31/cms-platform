// Submit for review.
//
//   submit         Draft → In review, numbered: round 1 of the next version after a release, or the next
//                  round of the number sent back (`nextRound` in rounds.ts); with its contract changes
//                  against `contractBaseline`

import { diffVariables, isBreaking } from "@/editor/model/contract";
import { withoutInvisible } from "@/editor/model/links";
import { usageFromJSON } from "@/editor/model/usage";
import { recordStages, stageOf, stageRecipients } from "../approval-chain";
import {
  channelFieldValue,
  channelFieldsOf,
  fieldsOfChannels,
  typedText,
  type ChannelField,
  type ChannelFields,
} from "../channel-fields";
import { nonGsmCharacters, smsLength } from "../messages/gsm7";
import { findPublicShorteners } from "../messages/links";
import {
  PUSH_MAX_BYTES,
  PUSH_PLATFORMS,
  pushPayloadBytes,
} from "../messages/push";
import type { MessageTypeRules } from "../platform-config/limits";
import {
  REQUEST_REFUSALS,
  refuse,
  type Refusal,
  type Refused,
} from "../refusals";
import { longSampleValues, resolveMessage } from "../render/message";
import {
  nextRound,
  reviewLink,
  type NumberedRound,
  type RoundRow,
} from "../rounds";
import { utcDay } from "../dates";
import {
  DOCUMENT_THREAD,
  type ApprovalStage,
  type LifecycleEffect,
  type VersionStage,
} from "../review-types";
import type { SubmitFacts } from "../submit-types";
import type {
  Channel,
  ContractChange,
  JSONContent,
  SampleSet,
  Variable,
  VersionState,
} from "../types";
import { contractBaseline } from "./baselines";
import { withWriter } from "./drafts";
import { unique, trimmed, teamApproversExcept, notify } from "./helpers";
import { REFUSALS } from "./refusals";
import type { LifecycleResult, Outcome } from "./types";

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
  /**
   * Assigned here with `round`, then frozen (`nextRound`): one above the highest released number, or the
   * number of the rounds sent back since.
   */
  number: number;
  /** 1 for a number's first submission; the next round when it was sent back. */
  round: number;
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
export type SubmitResult =
  ({ ok: true } & LifecycleResult<SubmitChanges>) | Refused;

/**
 * The SMS footer a version prints (decision 0035): a draft's is its content type's as it stands, since it
 * isn't submitted yet; every submitted version's is the one frozen into it at submit (`SubmitChanges.smsFooter`),
 * so a later change to the content type's footer never reaches a version that was already reviewed.
 */
export function smsFooterOf(
  version: { state: VersionState; smsFooter: string | null },
  contentTypeFooter: string | null,
): string | null {
  return version.state === "draft" ? contentTypeFooter : version.smsFooter;
}

export interface SubmitInput {
  draft: SubmitDraft;
  /**
   * The draft's `rev` when the submitter's summary was read (`SubmitSummary.rev`): what they were
   * shown is what gets frozen, so a draft that has moved on since is refused.
   */
  seenRev: number;
  /** The template's versions (number, round and state; the draft included): `nextRound` numbers the submission. */
  versions: readonly RoundRow[];
  /** The variable list of the newest version that still renders (`contractBaseline`), or null when none does. */
  baseline: readonly Variable[] | null;
  now: Date;
  submittedBy: string;
  /** The submitter's name, as the notification keeps it ("Maya Chen submitted … for review."). */
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
 * Draft → In review, as the template's next round (`nextRound`): round 1 of the next version number after
 * a release, or the next round of the number sent back. With it, the contract changes, the note,
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
 *   - a message breaks a rule its channels have (`messageRefusal`, decisions 0034 and 0035): the SMS has
 *     characters the author typed outside GSM-7, or takes more parts than the content type allows with
 *     the "long" sample values; a push body or SMS links through a public shortener; or a push is over
 *     4,096 bytes on either platform with the long values.
 *
 * A renamed key is one `key_renamed` change: the renamed variable keeps its identity as its id
 * (`Variable.id`), so `diffVariables` pairs it with the baseline's variable whatever it is keyed now.
 */
export function submit(input: SubmitInput): SubmitResult {
  const { draft, baseline, now, submittedBy } = input;

  if (draft.state === "in_review") return refuse(REFUSALS.alreadyInReview);
  if (draft.state !== "draft") return refuse(REFUSALS.notDraft);
  if (draft.rev !== input.seenRev) return refuse(REFUSALS.summaryStale);
  if (draft.channels.length === 0) return refuse(REFUSALS.noChannels);

  const fields = fieldsOfChannels(draft.channels);

  const defined = new Set(draft.variables.map((v) => v.key));
  const docs = [
    draft.body,
    ...fields.map((field) => channelFieldValue(draft.channelFields, field)),
  ];
  const undefinedKeys = unique(docs.flatMap((doc) => chipKeys(doc))).filter(
    (key) => !defined.has(key),
  );
  if (undefinedKeys.length > 0)
    return refuse(REFUSALS.undefinedVariables(undefinedKeys));

  const missing = fields.find(
    (field) =>
      field.required &&
      isBlankField(channelFieldValue(draft.channelFields, field)),
  );
  if (missing) return refuse(REFUSALS.fieldMissing(missing));

  const message = messageRefusal(draft, input.messageRules, now);
  if (message) return refuse(message);

  const { number, round } = nextRound(input.versions);
  const submitted: NumberedRound = { number, round, state: "in_review" };
  const contractChanges = baseline
    ? diffVariables(baseline, draft.variables)
    : null;
  const submitNote = trimmed(input.note);
  const stages = recordStages(input.chain);
  const firstStage = stageOf(stages, 0, input.chain);
  const writers = withWriter(draft.writers, submittedBy);

  return {
    ok: true,
    changes: {
      state: "in_review",
      number,
      round,
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
          round,
          note: submitNote,
          contractChanges: contractChanges?.length ?? 0,
          breaking: contractChanges ? isBreaking(contractChanges) : false,
        },
      },
      notify({
        notification: "review_requested",
        // Nobody has approved anything yet, so the first stage always has someone to ask.
        to:
          (firstStage && stageRecipients(firstStage, writers)) ||
          teamApproversExcept(...writers),
        facts: {
          actorName: input.submitterName,
          templateName: input.templateName,
          number,
          round,
        },
        body: submitNote,
        link: reviewLink(input.templateId, submitted),
      }),
    ],
  };
}

/**
 * The template's open draft, the one submit freezes: refused `already_in_review` when there is none because a
 * round is in review (a second tab, a double click), else `no_draft_to_submit`. Submit and its summary ask it.
 */
export function draftToSubmit<V extends { state: VersionState }>(
  versions: readonly V[],
): Outcome<{ draft: V }> {
  const draft = versions.find((v) => v.state === "draft");
  if (draft) return { ok: true, draft };
  return refuse(
    versions.some((v) => v.state === "in_review")
      ? REFUSALS.alreadyInReview
      : REQUEST_REFUSALS.noDraftToSubmit,
  );
}

/** What the submit summary reads of each of the template's versions. */
export interface SummaryRow extends RoundRow {
  rev: number;
  sunsetAt: Date | null;
  name: string;
  channels: readonly Channel[];
  variables: readonly Variable[];
  sampleSets: readonly SampleSet[];
}

/**
 * What submitting the template's draft would freeze, at `now` (`SubmitFacts`, less the template and the instant):
 * the draft's rev, name, channels, variables and sample sets, the number and round it would get (`nextRound`),
 * and the version it would be compared with (`contractBaseline`). Refused as `draftToSubmit` refuses.
 */
export function submitFacts(
  versions: readonly SummaryRow[],
  now: Date,
): Outcome<Omit<SubmitFacts, "asOf" | "templateId">> {
  const open = draftToSubmit(versions);
  if (!open.ok) return open;
  const { draft } = open;
  const baseline = contractBaseline(versions, now);
  return {
    ok: true,
    rev: draft.rev,
    ...nextRound(versions),
    name: draft.name,
    channels: [...draft.channels],
    variables: [...draft.variables],
    sampleSets: [...draft.sampleSets],
    baseline:
      baseline && baseline.number !== null
        ? {
            number: baseline.number,
            name: baseline.name,
            variables: [...baseline.variables],
          }
        : null,
  };
}

/** An open thread about the whole version: a change request (`DOCUMENT_THREAD`). */
export interface OpenChangeRequest {
  id: string;
  /** The round that was sent back. */
  originVersionId: string;
}

/**
 * Submitting the next round answers the change requests that sent the last one back (Sri, Oct 5): each open
 * thread about the whole version resolves as the submitter's, at the submit, and gets a `thread.resolved` audit
 * row about the round that asked, saying which round answered it. Block comments stay as they are; the author
 * resolves those one by one, so the caller passes only the open `DOCUMENT_THREAD` threads.
 */
export function answerChangeRequests(
  threads: readonly OpenChangeRequest[],
  submitted: { number: number; round: number; by: string; at: Date },
): {
  resolve: { status: "resolved"; resolvedBy: string; resolvedAt: Date };
  effects: LifecycleEffect[];
} {
  return {
    resolve: {
      status: "resolved",
      resolvedBy: submitted.by,
      resolvedAt: submitted.at,
    },
    effects: threads.map((t) => ({
      kind: "audit",
      action: "thread.resolved",
      versionId: t.originVersionId,
      details: {
        threadId: t.id,
        blockId: DOCUMENT_THREAD,
        auto: true,
        resolvedWith: submitted.number,
        resolvedWithRound: submitted.round,
      },
    })),
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
function messageRefusal(
  draft: SubmitDraft,
  rules: MessageTypeRules,
  now: Date,
): Refusal | null {
  const on = (channel: Channel) => draft.channels.includes(channel);
  if (!on("push") && !on("sms")) return null;
  const valueOf = (field: ChannelField) =>
    channelFieldValue(draft.channelFields, field);

  if (on("sms")) {
    for (const field of channelFieldsOf("sms")) {
      const outside = nonGsmCharacters(typedText(valueOf(field)));
      if (outside.length > 0)
        return REFUSALS.smsCharacters(
          field,
          outside.map((c) => c.char),
        );
    }
  }

  const input = {
    fields: draft.channelFields,
    variables: draft.variables,
    values: longSampleValues(draft, utcDay(now)),
    rules,
  };
  if (on("sms")) {
    const { parts } = smsLength(resolveMessage({ channel: "sms" }, input));
    if (parts > rules.smsMaxParts)
      return REFUSALS.smsParts(parts, rules.smsMaxParts);
  }

  for (const field of fieldsOfChannels(draft.channels)) {
    if (!field.refusesShorteners) continue;
    const links = findPublicShorteners(typedText(valueOf(field)));
    if (links.length > 0)
      return REFUSALS.publicShortener(
        field,
        links.map((link) => link.domain),
      );
  }

  if (on("push")) {
    for (const platform of PUSH_PLATFORMS) {
      const bytes = pushPayloadBytes(
        platform,
        resolveMessage({ channel: "push", platform }, input),
      );
      if (bytes > PUSH_MAX_BYTES) return REFUSALS.pushTooLarge(platform, bytes);
    }
  }
  return null;
}

/** The keys of the chips in a document, in order of first use. */
function chipKeys(doc: JSONContent | null): string[] {
  return doc ? [...usageFromJSON(doc, { sections: false }).keys()] : [];
}

/**
 * True when a field has no text and no chip. Spaces don't count, and neither do invisible characters, which a
 * message's field keeps (src/editor/model/characters.ts): a push title of a zero-width space shows nothing.
 */
function isBlankField(doc: JSONContent | null): boolean {
  if (!doc) return true;
  if (doc.type === "variable") return false;
  if (typeof doc.text === "string" && withoutInvisible(doc.text).trim() !== "")
    return false;
  return (doc.content ?? []).every(isBlankField);
}
