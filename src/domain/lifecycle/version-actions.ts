// What a viewer may do on one released version right now: set its sunset, and start, confirm or cancel a
// revoke. The Versions tab shows each as a control, enabled or disabled with its reason, and the service
// decides it (decision 0070): the local implementation and the fake both call this, so the read and the
// actions (`setSunset`, the revoke transitions) refuse with the same codes.

import { can } from "../permissions";
import { refuse, type Refusal } from "../refusals";
import type {
  PermissionResult,
  RevokeRecord,
  VersionState,
  Viewer,
} from "../types";
import { REFUSALS } from "./refusals";
import { revokePending } from "./revoke";
import { sunsetPassed } from "./sunset";

/** The four version actions of the Versions tab, each decided for one viewer. */
export interface VersionActions {
  setSunset: PermissionResult;
  startRevoke: PermissionResult;
  confirmRevoke: PermissionResult;
  cancelRevoke: PermissionResult;
}

/**
 * What the viewer may do on one version right now: the permission (with its code and reason) first,
 * then the version's state, as the transitions word it (`REFUSALS`). A pending revoke is checked before
 * the confirm permission, so the starter reads "You started this revoke. Another approver must confirm
 * it." only while there is one to confirm. A Superseded version's passed sunset comes before the
 * permission: it is a fact about the version, final for everyone, and the Versions tab shows it at the
 * disabled control to anyone who can see the version.
 */
export function versionActions(
  viewer: Viewer,
  teamId: string,
  version: {
    state: VersionState;
    sunsetAt: Date | null;
    revoke: RevokeRecord | null;
  },
  now: Date,
): VersionActions {
  const pending = revokePending(version);
  const then = (
    permission: PermissionResult,
    blocked: Refusal | null,
  ): PermissionResult =>
    !permission.ok ? permission : blocked ? refuse(blocked) : permission;
  const noPending = refuse(
    version.state === "revoked"
      ? REFUSALS.alreadyRevoked
      : REFUSALS.noRevokePending,
  );

  return {
    setSunset:
      version.state === "superseded" && sunsetPassed(version, now)
        ? refuse(REFUSALS.sunsetPassed)
        : then(
            can(viewer, "version.setSunset", { teamId }),
            version.state === "superseded"
              ? null
              : REFUSALS.sunsetNotSuperseded,
          ),
    startRevoke: then(
      can(viewer, "version.revoke.start", { teamId }),
      version.state === "revoked"
        ? REFUSALS.alreadyRevoked
        : version.state !== "active" && version.state !== "superseded"
          ? REFUSALS.notRevocable
          : pending
            ? REFUSALS.revokePending
            : null,
    ),
    confirmRevoke: pending
      ? can(viewer, "version.revoke.confirm", {
          teamId,
          revokeStartedBy: version.revoke!.startedBy,
        })
      : noPending,
    // The starter may withdraw, and another approver may decline: anyone who could start one.
    cancelRevoke: pending
      ? can(viewer, "version.revoke.start", { teamId })
      : noPending,
  };
}
