// The shapes the lifecycle transitions share: what a draft and a version carry, the result of a
// transition (`{ ok: true, ... }` or a refusal), and the version as the review transitions read it.

import type { ChannelFields } from "../channel-fields";
import type { Refused } from "../refusals";
import {
  DOCUMENT_THREAD,
  type LifecycleEffect,
  type VersionStage,
} from "../review-types";
import type {
  Channel,
  ContractChange,
  JSONContent,
  RevokeRecord,
  SampleSet,
  Variable,
  VersionState,
} from "../types";

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
  /** Which submission of `number` this is (rounds.ts); null while a draft, like the number. */
  round: number | null;
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
  /** Null until the draft is submitted, with the number. */
  round: null;
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

export type Ok<T> = { ok: true } & T;

export type Outcome<T> = Ok<T> | Refused;

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
