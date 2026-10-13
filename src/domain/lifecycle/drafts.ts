// How a draft comes to exist, and who has written it.
//
//   newTemplateContentType  the content type a new Document or Alert is made on, for life
//   createDraft    — → Draft (a new template from a starter)
//   createTemplateFrom  — → Draft (a new template from the draft the BFF prepared: a starter, or an import)
//   newTemplateRefusal  why a new template can't be made on a content type with these channels
//   editLatest     the latest version, Active or Revoked → a new Draft copied from it ("Based on v3")
//
// The name is a version field, like the body: a new draft copies it, the author renames the draft, and
// it freezes at submit.

import type { ImportKind } from "../import-report";
import { REQUEST_REFUSALS, refuse, type Refusal } from "../refusals";
import { compareRounds, type RoundRow } from "../rounds";
import {
  contentTypeFamily,
  familyOf,
  type Channel,
  type ChannelFamily,
} from "../types";
import { REFUSALS } from "./refusals";
import {
  LifecycleError,
  type DraftContent,
  type LifecycleResult,
  type StarterContent,
  type VersionSnapshot,
  type DraftFields,
  type Outcome,
} from "./types";

// ── Defaults ───────────────────────────────────────────────

/** Name of a template made from Blank. The author renames it straight away. */
export const UNTITLED_TEMPLATE_NAME = "Untitled template";

/** Key of the starter that has no example content (just the required sections). */
export const BLANK_STARTER_KEY = "blank";

/**
 * The channels a new template starts with, by its content type's family: a document renders PDF and Web
 * (Email is a deliberate opt-in, as in the seed); a message (an Alert) renders Push and SMS.
 */
export const DEFAULT_CHANNELS: {
  readonly [F in ChannelFamily]: readonly Channel[];
} = {
  document: ["pdf", "web"],
  message: ["push", "sms"],
};

/**
 * A new template's channels, given the ones its starter wants (none: the family's defaults) and the ones
 * its content type allows: the wanted ones the type allows; else the family's defaults it allows; else
 * the first channel it allows. A content type is one family, so these never mix.
 */
export function newTemplateChannels(
  wanted: readonly Channel[] | undefined,
  allowed: readonly Channel[],
): Channel[] {
  const family = contentTypeFamily(allowed);
  const fits = (channels: readonly Channel[]) =>
    channels.filter((c) => allowed.includes(c));
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
export function draftChannelsRefusal(
  channels: readonly Channel[],
  allowed: readonly Channel[],
): Refusal | null {
  if (channels.length === 0) return REFUSALS.noChannels;
  if (!channels.every((channel) => allowed.includes(channel)))
    return REFUSALS.channelNotAllowed;
  return null;
}

// ── New template ───────────────────────────────────────────

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
 * it for life, and so keeps its family: a content type never changes family (decision 0034). Refused,
 * with the sentence the author reads, when no content type is of that family.
 */
export function newTemplateContentType<T extends NewTemplateType>(
  family: ChannelFamily,
  contentTypes: readonly T[],
): Outcome<{ contentType: T }> {
  const [contentType] = contentTypes
    .filter((type) => familyOf(type.allowedChannels) === family)
    .sort((a, b) => a.name.localeCompare(b.name));
  return contentType
    ? { ok: true, contentType }
    : refuse(REFUSALS.noContentType(family));
}

/** The template's first name: Blank is untitled (renamed at once), an example keeps its own name. */
export function initialTemplateName(
  starter: Pick<StarterContent, "key" | "name">,
): string {
  return starter.key === BLANK_STARTER_KEY
    ? UNTITLED_TEMPLATE_NAME
    : starter.name;
}

/** A new template and its first draft, from a starter. Block ids in the body are kept as given. */
export function createDraft(input: {
  starter: StarterContent;
  createdBy: string;
  now: Date;
}): LifecycleResult<NewTemplateChanges> {
  const { starter, createdBy, now } = input;
  return createTemplateFrom({
    draft: {
      name: initialTemplateName(starter),
      body: starter.body,
      channelFields: starter.channelFields ?? {},
      channels: [...(starter.channels ?? DEFAULT_CHANNELS.document)],
      variables: [...starter.variables],
      sampleSets: [...starter.sampleSets],
      starterKey: starter.key === BLANK_STARTER_KEY ? null : starter.key,
    },
    createdBy,
    now,
  });
}

/**
 * A new template and its first draft, from the draft the BFF built and prepared (`DraftContent`): New template
 * (a starter, or Blank with no key) or Import (`imported` names the file's kind and name, for the audit row).
 * What both backends call, so a template made on either is the same.
 */
export function createTemplateFrom(input: {
  draft: DraftContent;
  createdBy: string;
  now: Date;
  imported?: { kind: ImportKind; filename: string };
}): LifecycleResult<NewTemplateChanges> {
  const { draft, createdBy, now, imported } = input;
  const source = imported
    ? { source: `import:${imported.kind}`, filename: imported.filename }
    : { source: draft.starterKey ? `starter:${draft.starterKey}` : "blank" };

  return {
    changes: {
      template: { starterKey: draft.starterKey, createdBy, createdAt: now },
      draft: {
        state: "draft",
        number: null,
        round: null,
        basedOnVersionId: null,
        name: draft.name,
        body: clone(draft.body),
        channelFields: clone(draft.channelFields),
        channels: [...draft.channels],
        variables: clone([...draft.variables]),
        sampleSets: clone([...draft.sampleSets]),
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
        details: { name: draft.name, ...source },
      },
    ],
  };
}

/**
 * Why a new template can't be made on this content type with these channels, or null: the content type has to
 * exist (`content_type_gone`), and the draft's channels have to be ones it allows (`draftChannelsRefusal`: the BFF
 * fitted them when it built the draft, but Platform settings may have changed since). Both backends ask it.
 */
export function newTemplateRefusal(
  contentType: { allowedChannels: readonly Channel[] } | undefined,
  channels: readonly Channel[],
): Refusal | null {
  if (!contentType) return REQUEST_REFUSALS.contentTypeGone;
  return draftChannelsRefusal(channels, contentType.allowedChannels);
}

// ── Editing a template ─────────────────────────────────────

/**
 * What "Edit" on a template does, given its versions: go to the open draft if there is one
 * (one open draft per template), copy the template's latest version if it is Active or Revoked, or
 * say it can't. Latest is by number, then round (`compareRounds`), over every row but the rounds sent
 * back: those are records, so after a send-back whose draft is gone, Edit starts from the Active version
 * (and its submit is still the next round of the number sent back, `nextRound`). A Revoked latest
 * version was the Active one until it was withdrawn: the corrected draft starts from its content
 * (decision 0009). A pending revoke leaves the version Active, so it is edited as Active. A newer
 * version in review (or any other newer version) blocks it: editing then would fork the template and
 * drop the newer version's changes. Blocked, it carries the refusal (`REFUSALS.newerInReview`,
 * `REFUSALS.notEditable`) that `startDraft` answers with.
 */
export type DraftStartPlan =
  | { kind: "open"; versionId: string }
  | { kind: "create"; from: string }
  | ({ kind: "blocked" } & Refusal);

export function planDraftStart(
  versions: readonly (RoundRow & { id: string })[],
): DraftStartPlan {
  const open = versions.find((v) => v.state === "draft");
  if (open) return { kind: "open", versionId: open.id };

  const latest = versions
    .filter((v) => v.state !== "changes_requested")
    .reduce<(typeof versions)[number] | undefined>(
      (best, v) =>
        best === undefined || compareRounds(v, best) > 0 ? v : best,
      undefined,
    );
  if (latest?.state === "active" || latest?.state === "revoked")
    return { kind: "create", from: latest.id };
  return {
    kind: "blocked",
    ...(latest?.state === "in_review"
      ? REFUSALS.newerInReview
      : REFUSALS.notEditable),
  };
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
    throw new LifecycleError(
      `Only an Active or Revoked version can be edited, not ${from.state}.`,
    );
  }

  return {
    changes: { draft: copyToDraft(from, createdBy, now, [createdBy]) },
    effects: [
      {
        kind: "audit",
        action: "draft.started",
        details: { basedOn: from.number },
      },
    ],
  };
}

// ── Writers (maker-checker) ────────────────────────────────

/**
 * The version's writers with `userId` among them: unchanged when they already are, otherwise added at
 * the end. Autosave calls it for each person whose save lands; submit for the submitter.
 */
export function withWriter(
  writers: readonly string[],
  userId: string,
): string[] {
  return writers.includes(userId) ? [...writers] : [...writers, userId];
}

// ── Copying a version into a draft ─────────────────────────

/**
 * A new draft copied from a version (Edit on the latest version, or a change request): its name, body
 * with every block id (so comment threads and the redline keep their anchors), variables, channels,
 * channel fields and sample sets. Contract changes are worked out at submit, so none are recorded here.
 */
export function copyToDraft(
  version: VersionSnapshot,
  createdBy: string,
  now: Date,
  writers: readonly string[],
): DraftFields {
  return {
    state: "draft",
    number: null,
    round: null,
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

/** A deep copy, so a draft never shares objects with the version (or starter) it came from. */
function clone<T>(value: T): T {
  return value === null || value === undefined
    ? value
    : (JSON.parse(JSON.stringify(value)) as T);
}
