// Revoke: two people withdraw a released version.
//
//   startRevoke    Active or Superseded → revoke pending (one approver)
//   confirmRevoke  revoke pending → Revoked (a different approver)
//   cancelRevoke   revoke pending → no revoke

import { REASONS } from "../permissions";
import { refuse, type Refused } from "../refusals";
import type { LifecycleEffect } from "../review-types";
import type { RevokeRecord } from "../types";
import { numberOf, trimmed, teamApproversExcept, notify } from "./helpers";
import { REFUSALS } from "./refusals";
import type { Outcome, ReviewVersion } from "./types";

export type StartRevokeResult = Outcome<{
  changes: { revoke: RevokeRecord };
  effects: LifecycleEffect[];
}>;
export type ConfirmRevokeResult = Outcome<{
  changes: { state: "revoked"; revoke: RevokeRecord };
  effects: LifecycleEffect[];
}>;
export type CancelRevokeResult = Outcome<{
  changes: { revoke: null };
  effects: LifecycleEffect[];
}>;

/** True while a revoke has been started and not yet confirmed or cancelled. */
export function revokePending(version: {
  revoke: RevokeRecord | null;
}): boolean {
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
  if (version.state !== "active" && version.state !== "superseded")
    return refuse(REFUSALS.notRevocable);
  if (revokePending(version)) return refuse(REFUSALS.revokePending);
  const reason = trimmed(input.reason);
  if (!reason) return refuse(REFUSALS.giveReason);

  const number = numberOf(version);
  return {
    ok: true,
    changes: {
      revoke: { reason, startedBy: actorId, startedAt: now.toISOString() },
    },
    effects: [
      {
        kind: "audit",
        action: "version.revoke_started",
        details: { number, reason },
      },
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
  const revoke: RevokeRecord = {
    ...started,
    confirmedBy: actorId,
    confirmedAt: now.toISOString(),
  };
  const versions = { to: "versions", templateId: version.templateId } as const;
  const title = `${actorName} confirmed the revoke of ${templateName} v${number}.`;

  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "version.revoked",
      details: {
        number,
        reason: started.reason,
        startedBy: started.startedBy,
        wasActive,
      },
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
    notify({
      notification: "version_revoked",
      to: teamApproversExcept(actorId),
      title,
      body: started.reason,
      link: versions,
    }),
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
export function cancelRevoke(input: {
  version: ReviewVersion;
  actorId: string;
  now: Date;
}): CancelRevokeResult {
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

function pendingRevoke(
  version: ReviewVersion,
): { ok: true; revoke: RevokeRecord } | Refused {
  if (version.state === "revoked") return refuse(REFUSALS.alreadyRevoked);
  if (
    (version.state !== "active" && version.state !== "superseded") ||
    !version.revoke ||
    version.revoke.confirmedAt
  ) {
    return refuse(REFUSALS.noRevokePending);
  }
  return { ok: true, revoke: version.revoke };
}
