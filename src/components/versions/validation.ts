// What the Versions tab's dialogs check before they send anything: a request we know will be refused
// is never sent (it would log as a console error, and say nothing the dialog can't say first).
// Pure, so they are tested without the dialogs.

import { addDays } from "@/domain/dates";
import { formatCount } from "@/domain/numbers";
import { formatLong, fromYmd } from "./format";

/** Why a sunset date can't be used, or null. `today` is the demo clock's date. */
export function validateSunsetDate(ymd: string | null, today: string): string | null {
  if (!ymd || fromYmd(ymd) === null) return "Pick a date.";
  return ymd > today ? null : `Pick a date after ${formatLong(today)}.`;
}

/** The sunset date a new sunset starts on: the one already set, else 30 days out. */
export function defaultSunsetDate(current: string | null, today: string): string {
  return current && current > today ? current : addDays(today, 30);
}

/** The longest reason the server accepts (actions/review.ts). */
export const REVOKE_REASON_MAX = 2000;

/** Why a revoke reason can't be used, or null. */
export function validateRevokeReason(reason: string): string | null {
  const length = reason.trim().length;
  if (length === 0) return "Say why this version is being revoked.";
  return length > REVOKE_REASON_MAX ? `Keep the reason under ${formatCount(REVOKE_REASON_MAX)} characters.` : null;
}
