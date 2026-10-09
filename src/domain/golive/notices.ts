// A consumer_notices row as the consumer API serves it. Pure TypeScript.
//
// Seeded rows and the rows server/effects.ts writes at runtime carry slightly different payloads
// (see `NoticeRow` in golive-types.ts); `noticeView` reads either and words the one-line `message`.
// Payloads never hold variable values, and neither does anything here.

import { recordedSunsetDay } from "../business-zone";
import { formatLongDate, joinWithAnd } from "../render/errors";
import type { ApiNotice, ContractChange, NoticeRow } from "../golive-types";
import { apiChanges } from "./contract-diff";

// ── Reading a payload defensively (it's JSON from the database) ─────────────

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const int = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);
const has = (payload: Record<string, unknown>, key: string) => Object.hasOwn(payload, key);

function changesOf(value: unknown): ContractChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is ContractChange =>
      typeof c === "object" && c !== null && typeof (c as ContractChange).kind === "string" && typeof (c as ContractChange).key === "string",
  );
}

function isoOf(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ── Messages ─────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * What a new version asks of a consumer, as one clause list:
 * "It adds the required variable annual_fee and makes promo_code optional." / "No contract changes."
 */
export function changeSummary(changes: readonly ContractChange[]): string {
  if (changes.length === 0) return "No contract changes.";
  const keys = (kind: ContractChange["kind"], filter: (c: ContractChange) => boolean = () => true) =>
    changes.filter((c) => c.kind === kind && filter(c)).map((c) => c.key);
  const clauses: string[] = [];
  const add = (list: string[], words: (keys: string) => string) => {
    if (list.length > 0) clauses.push(words(joinWithAnd(list)));
  };
  const variables = (list: string[]) => plural(list.length, "variable", "variables");

  // As describeChange reads it: an added variable is required when it says so, else when it breaks.
  const required = (c: ContractChange) => c.required ?? c.breaking;
  const addedRequired = keys("added", required);
  const addedOptional = keys("added", (c) => !required(c));
  add(addedRequired, (l) => `adds the required ${variables(addedRequired)} ${l}`);
  add(addedOptional, (l) => `adds the optional ${variables(addedOptional)} ${l}`);
  for (const c of changes.filter((x) => x.kind === "key_renamed")) clauses.push(`renames ${c.from ?? c.key} to ${c.to ?? c.key}`);
  add(keys("type_changed"), (l) => `changes the type of ${l}`);
  add(keys("made_required"), (l) => `makes ${l} required`);
  add(keys("made_optional"), (l) => `makes ${l} optional`);
  add(keys("label_changed"), (l) => `changes the label of ${l}`);
  const removed = keys("removed");
  add(removed, (l) => `removes the ${variables(removed)} ${l}`);
  return `It ${joinWithAnd(clauses)}.`;
}

/** "Wrong intro APR." stays; "Wrong bonus amount" gets its period. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// ── The view ─────────────────────────────────────────────────────────────────

export function noticeView(row: NoticeRow): ApiNotice {
  const p = row.payload ?? {};
  // The name the notice's own version had when it was written (server/effects.ts), not today's.
  const name = str(p.templateName) ?? row.templateId;
  const versionNumber = int(p.versionNumber) ?? 0;
  const title = `${name} v${versionNumber}`;
  const base = {
    id: row.id,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    template: { id: row.templateId, name },
    versionNumber,
  };

  switch (row.kind) {
    case "new_version": {
      // Live rows say which version is Active; a seeded row's new version is the Active one.
      const activeVersion = has(p, "activeVersion") ? int(p.activeVersion) : versionNumber;
      const raw = changesOf(p.contractChanges);
      const changes = apiChanges(raw, versionNumber);
      const summary = changeSummary(raw);
      return {
        ...base,
        activeVersion,
        sunsetAt: null,
        reason: null,
        changes,
        message: `${title} is available. ${summary}`,
      };
    }

    case "sunset_scheduled": {
      // Live rows: activeVersion. Seeded rows: replacedByVersionNumber.
      const activeVersion = has(p, "activeVersion") ? int(p.activeVersion) : int(p.replacedByVersionNumber);
      const sunsetAt = isoOf(p.sunsetAt);
      const changes = activeVersion === null ? [] : apiChanges(changesOf(p.contractChanges), activeVersion);
      // The day as picked (00:00 on it in the business time zone is `sunsetAt`).
      const day = sunsetAt ? recordedSunsetDay(p) : null;
      const when = day ? `stops rendering on ${formatLongDate(day)}` : "will stop rendering";
      const move = activeVersion === null ? "" : ` Move to v${activeVersion}.`;
      return { ...base, activeVersion, sunsetAt, reason: null, changes, message: `${title} ${when}.${move}` };
    }

    case "revoked": {
      const reason = str(p.reason);
      const activeVersion = int(p.activeVersion);
      return {
        ...base,
        activeVersion,
        sunsetAt: null,
        reason,
        changes: [],
        message: reason ? `${title} was revoked: ${sentence(reason)}` : `${title} was revoked.`,
      };
    }
  }
}
