// Autosave's rules: whether a save may land on a draft, what it writes there, and the audit row an editing session
// keeps. Both implementations of `DraftService.save` (src/server/services/local/drafts.ts and the fake's twin) ask
// these, so they answer a save alike; the contract suite holds them to it (src/server/services/contract/drafts.ts).
//
// A save arrives prepared: the BFF parsed it and made each document ready for storage (normalized, checked, with
// block ids: src/server/documents/prepare.ts, decision 0065). What is left is what needs the draft as it stands.

import {
  ALL_CHANNEL_FIELDS,
  CHANNEL_FIELD_IDS,
  withChannelFieldValues,
  type ChannelFields,
  type ChannelFieldsPatch,
} from "../channel-fields";
import { REQUEST_REFUSALS, refuse } from "../refusals";
import type {
  Channel,
  DraftPatch,
  DraftSaveResponse,
  JSONContent,
  SampleSet,
  Variable,
  VersionState,
} from "../types";
import { draftChannelsRefusal, withWriter } from "./drafts";

/** A save's refusal: the code and its sentence, and for `draft_changed` the draft's current rev. */
export type DraftSaveRefused = Extract<DraftSaveResponse, { ok: false }>;

// ── Whether it lands ───────────────────────────────────────

/**
 * True when the draft's current rev was produced by this very session, so a save that is behind
 * (`patchRev` < `currentRev`) can only be missing its own earlier saves, never someone else's. That happens when
 * a save lands but its response is lost.
 *
 * `lastSaveRev` is the rev the session's last save produced (null when it has saved nothing, or its record never
 * said). Every write to a version, by anyone, bumps its rev, so if that save produced the current rev then nobody
 * has written since.
 */
export function sessionOwnsRev(
  lastSaveRev: number | null,
  currentRev: number,
  patchRev: number,
): boolean {
  return (
    lastSaveRev !== null && patchRev < currentRev && lastSaveRev === currentRev
  );
}

/**
 * Whether a save may land on the draft as it stands, in the order autosave answers (after `version_gone` and the
 * permission, which come first): `version_not_draft` once the version has left draft; `draft_changed`, carrying the
 * current rev, for a rev that isn't the current one (behind or ahead), unless the session's own last save produced
 * the current rev (`sessionOwnsRev`: the save carries on from there); then the channels (`draftChannelsRefusal`).
 * Null: it lands, on `draft.rev`.
 */
export function draftSaveRefusal(
  draft: {
    state: VersionState;
    rev: number;
    /** The channels the template's content type allows. */
    allowedChannels: readonly Channel[];
  },
  patch: Pick<DraftPatch, "rev" | "channels">,
  lastSaveRev: number | null,
): DraftSaveRefused | null {
  if (draft.state !== "draft") return refuse(REQUEST_REFUSALS.versionNotDraft);
  if (
    patch.rev !== draft.rev &&
    !sessionOwnsRev(lastSaveRev, draft.rev, patch.rev)
  )
    return draftChanged(draft.rev);
  const channels = patch.channels
    ? draftChannelsRefusal(patch.channels, draft.allowedChannels)
    : null;
  return channels ? refuse(channels) : null;
}

/** `draft_changed` with the draft's current rev: the save was based on another one. */
export function draftChanged(currentRev: number): DraftSaveRefused {
  return { ...refuse(REQUEST_REFUSALS.draftChanged), rev: currentRev };
}

// ── What it writes ─────────────────────────────────────────

/** What a save writes on the draft, besides its rev and its time. */
export interface DraftSaveChanges {
  /** Whoever saves an edit wrote the version, so they can't decide it (maker-checker). */
  writers: string[];
  name?: string;
  body?: JSONContent;
  variables?: Variable[];
  channels?: Channel[];
  /** The stored fields with the patch's laid over them: those it doesn't name are kept, a null clears one. */
  channelFields?: ChannelFields;
  sampleSets?: SampleSet[];
}

/** The fields a save writes: the ones the patch names, the channel fields laid over the stored ones, and the saver among the writers. */
export function draftSaveChanges(
  stored: { channelFields: ChannelFields; writers: readonly string[] },
  patch: DraftPatch,
  userId: string,
): DraftSaveChanges {
  const changes: DraftSaveChanges = {
    writers: withWriter(stored.writers, userId),
  };
  if (patch.name !== undefined) changes.name = patch.name;
  if (patch.body !== undefined) changes.body = patch.body;
  if (patch.variables !== undefined) changes.variables = patch.variables;
  if (patch.channels !== undefined) changes.channels = patch.channels;
  if (patch.sampleSets !== undefined) changes.sampleSets = patch.sampleSets;

  const fields: ChannelFieldsPatch = {};
  for (const field of ALL_CHANNEL_FIELDS)
    if (patch[field.id] !== undefined) fields[field.id] = patch[field.id];
  if (Object.keys(fields).length > 0)
    changes.channelFields = withChannelFieldValues(
      stored.channelFields,
      fields,
    );
  return changes;
}

// ── The editing session's audit row ────────────────────────
//
// One `draft.edited` row per editing session, not one per save: a save merges into its session's row (the same
// person, draft and session key). The Java API keeps the audit log append-only and the session on the version row
// instead (decision 0066), so the contract suite never pins the merge; the local implementation and the fake keep it.

/**
 * Every field an autosave can change, in the order they are listed in the audit details. Each channel field is
 * listed by its id ("email.subject"), from the registry.
 */
export const DRAFT_FIELDS = [
  "body",
  "variables",
  "name",
  "channels",
  ...CHANNEL_FIELD_IDS,
  "sampleSets",
] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

export const DRAFT_EDITED = "draft.edited";

export interface DraftEditedDetails {
  /** How many saves this editing session has made. */
  saves: number;
  /** The union of every field those saves changed. */
  fields: DraftField[];
  /** ISO time of the session's first save (the backend's clock). */
  since: string;
  /**
   * The version `rev` this session's latest save produced. It is written in the same transaction as the save, so
   * it says who wrote the current rev (`recordedRev`, `sessionOwnsRev`).
   */
  rev: number;
  /** Anything else already on the row is kept. */
  [key: string]: unknown;
}

/** The fields a patch actually carries. `null` counts (it clears a channel field). */
export function changedFields(
  patch: Partial<Record<DraftField, unknown>>,
): DraftField[] {
  return DRAFT_FIELDS.filter((field) => patch[field] !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDraftField(value: unknown): value is DraftField {
  return (DRAFT_FIELDS as readonly unknown[]).includes(value);
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * The rev a session's `draft.edited` row says its latest save produced, or null when it says none (a row written
 * before the rev was recorded, or details that aren't a record): such a session never owns the current rev.
 */
export function recordedRev(details: unknown): number | null {
  return isRecord(details) && typeof details.rev === "number"
    ? details.rev
    : null;
}

/**
 * Folds one save into the session's audit row. `rev` is the version rev the save produced.
 *
 * - No row yet: a new one with `saves: 1`, the changed fields and `since: now`.
 * - A row exists: `saves + 1`, the union of the fields, and `since` kept. The row's `at` moves to now.
 *
 * Rows written before this existed have no `fields`, `since` or `rev`: their fields start empty and `since` falls
 * back to the row's old `at`.
 */
export function mergeDraftEdit(
  previous: { at: Date; details: unknown } | null,
  changed: readonly DraftField[],
  now: Date,
  rev: number,
): { at: Date; details: DraftEditedDetails } {
  const old = previous && isRecord(previous.details) ? previous.details : {};
  const oldSaves =
    typeof old.saves === "number" &&
    Number.isInteger(old.saves) &&
    old.saves > 0
      ? old.saves
      : 1;
  const oldFields = Array.isArray(old.fields)
    ? old.fields.filter(isDraftField)
    : [];

  const wanted = new Set<DraftField>([...oldFields, ...changed]);
  const details: DraftEditedDetails = {
    ...old,
    saves: previous ? oldSaves + 1 : 1,
    fields: DRAFT_FIELDS.filter((field) => wanted.has(field)),
    since: previous
      ? validIso(old.since)
        ? old.since
        : previous.at.toISOString()
      : now.toISOString(),
    rev,
  };
  return { at: now, details };
}
