// A template's Activity tab as facts (`AuditService.activity`): its audit events, newest first, with who did it
// by id and the version each is about as that row is now. The BFF words each one as a sentence
// (`describeActivity`) and labels its version (`eventVersionLabel`).

import type { Person } from "@/domain/review-types";
import type { NumberedRound } from "@/domain/rounds";

/** A template's history is short; this only guards against a runaway list. */
export const ACTIVITY_LIMIT = 500;

/** One audit event about the template. */
export interface ActivityEventFacts {
  id: string;
  /** ISO. */
  at: string;
  /** User id; null for the system (the sunset sweep). */
  actorId: string | null;
  /** The audit action (`AuditAction`, or a spelling written before it). */
  action: string;
  /** The version row it is about; null when none. */
  versionId: string | null;
  /** That row as it is now; null when there is none or it is the open draft (its details then name it). */
  version: NumberedRound | null;
  details: Record<string, unknown>;
}

export interface TemplateActivity {
  /** ISO: the backend's instant when it was read; the tab says how long ago each event was from it. */
  asOf: string;
  template: { id: string; teamId: string };
  /** Newest first; same-moment rows (a submit and the change request it answers) newest-written first. */
  events: ActivityEventFacts[];
  /** Everyone the events name as their actor. */
  people: Person[];
}
