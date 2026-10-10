// The audit rule for autosave: one `draft.edited` row per editing session, not one per save.
// Pure TypeScript: the merge takes the existing row (or null) and returns what the row should hold.

import { CHANNEL_FIELD_IDS } from "@/domain/channel-fields";

/**
 * Every field an autosave can change, in the order they are listed in the audit details. Each channel
 * field is listed by its id ("email.subject"), from the registry.
 */
export const DRAFT_FIELDS = ["body", "variables", "name", "channels", ...CHANNEL_FIELD_IDS, "sampleSets"] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

export const DRAFT_EDITED = "draft.edited";

export interface DraftEditedDetails {
  /** How many saves this editing session has made. */
  saves: number;
  /** The union of every field those saves changed. */
  fields: DraftField[];
  /** ISO time of the session's first save (demo clock). */
  since: string;
  /**
   * The version `rev` this session's latest save produced. It is written in the same transaction
   * as the save, so it says who wrote the current rev; see `sessionOwnsRev`.
   */
  rev: number;
  /** Anything else already on the row (the seed adds `basedOn`) is kept. */
  [key: string]: unknown;
}

/** The fields a patch actually carries. `null` counts (it clears a channel field). */
export function changedFields(patch: Partial<Record<DraftField, unknown>>): DraftField[] {
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
 * True when the draft's current rev was produced by this very session, so a request that is
 * behind (`patchRev` < `currentRev`) can only be missing its own earlier saves, never someone
 * else's. That happens when a save lands but its response is lost.
 *
 * Every save, by anyone, bumps the rev, so if the session's last save produced the current rev
 * then no one has written since. Rows without a recorded rev (the seed's, or a row that never
 * saw one) never match, so those requests get a normal conflict.
 */
export function sessionOwnsRev(
  previous: { details: unknown } | null,
  currentRev: number,
  patchRev: number,
): boolean {
  if (!previous || !isRecord(previous.details)) return false;
  return patchRev < currentRev && previous.details.rev === currentRev;
}

/**
 * Folds one save into the session's audit row. `rev` is the version rev the save produced.
 *
 * - No row yet: a new one with `saves: 1`, the changed fields and `since: now`.
 * - A row exists: `saves + 1`, the union of the fields, and `since` kept. The row's `at` moves to now.
 *
 * Rows written before this existed (the seed has `{ saves: 15 }`) have no `fields`, `since` or `rev`:
 * their fields start empty and `since` falls back to the row's old `at`.
 */
export function mergeDraftEdit(
  previous: { at: Date; details: unknown } | null,
  changed: readonly DraftField[],
  now: Date,
  rev: number,
): { at: Date; details: DraftEditedDetails } {
  const old = previous && isRecord(previous.details) ? previous.details : {};
  const oldSaves = typeof old.saves === "number" && Number.isInteger(old.saves) && old.saves > 0 ? old.saves : 1;
  const oldFields = Array.isArray(old.fields) ? old.fields.filter(isDraftField) : [];

  const wanted = new Set<DraftField>([...oldFields, ...changed]);
  const details: DraftEditedDetails = {
    ...old,
    saves: previous ? oldSaves + 1 : 1,
    fields: DRAFT_FIELDS.filter((field) => wanted.has(field)),
    since: previous ? (validIso(old.since) ? old.since : previous.at.toISOString()) : now.toISOString(),
    rev,
  };
  return { at: now, details };
}
