// What a viewer may do on one released version right now: set its sunset, and start, confirm or cancel a
// revoke. The Versions tab shows each as a control, enabled or disabled with its reason, and the service
// decides it (decision 0070): the local implementation and the fake both call this, so the read and the
// actions (`setSunset`, the revoke transitions) refuse with the same codes.

import { can } from "../permissions";
import { REQUEST_REFUSALS, refuse, type Refusal } from "../refusals";
import { latestVersion, type RoundRow } from "../rounds";
import type {
  PermissionResult,
  RevokeRecord,
  VersionState,
  Viewer,
} from "../types";
import { planDraftStart } from "./drafts";
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

/** What the viewer may do in a template's workspace, whatever tab is open. */
export interface WorkspaceActions {
  /** Edit the team's drafts (the name field, autosave). Refused, the header says "View only". */
  edit: PermissionResult;
  /**
   * Edit: start the template's next draft from its latest version (`planDraftStart`), or open the one there is.
   * Refused without the edit permission, and while a newer version is in review or the latest isn't Active or
   * Revoked.
   */
  startDraft: PermissionResult;
  /** Submit for review: the template's open draft, by someone who may submit the team's drafts. */
  submit: PermissionResult;
}

/** What the viewer may do in the workspace of a template on `teamId`, given its versions (every round). */
export function workspaceActions(
  viewer: Viewer,
  teamId: string,
  versions: readonly (RoundRow & { id: string })[],
): WorkspaceActions {
  const edit = can(viewer, "draft.edit", { teamId });
  const plan = planDraftStart(versions);
  return {
    edit,
    startDraft: edit.ok && plan.kind === "blocked" ? refuse(plan) : edit,
    submit:
      latestVersion(versions)?.state === "draft"
        ? can(viewer, "version.submit", { teamId })
        : refuse(REQUEST_REFUSALS.noDraftToSubmit),
  };
}
