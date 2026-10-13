// What the viewer may do on the rows of the Team settings sections, decided: the permission check first
// (`can`), then the domain's own rule run against the real facts without writing, so a control that is blocked
// carries the exact reason the command would refuse with ([decision 0018](../../../docs/decisions/0018-settings-screens-render-decisions.md)).
// The backend answers these with its facts (the access service's reads); the screens render them.

import {
  type AccessRequestFacts,
  type MembershipFacts,
  type Named,
  type RecertFacts,
} from "../access-types";
import { can } from "../permissions";
import { refuse, type Refusal, type Refused } from "../refusals";
import type { PermissionResult, Viewer } from "../types";
import {
  changeRoles,
  keepInactive,
  reinstate,
  removeMember,
  suspendInactive,
} from "./members";
import { requestDecisionRefusal } from "./requests";
import { decideRecertItem, startRecert } from "./recertification";

const okOr = (r: { ok: true } | Refused): PermissionResult =>
  r.ok ? { ok: true } : refuse(r);
const okUnless = (refusal: Refusal | null): PermissionResult =>
  refusal ? refuse(refusal) : { ok: true };

/** `team.manageMembers` on a member (nobody manages themselves), then the domain's own answer. */
function manage(
  viewer: Viewer,
  teamId: string,
  subjectUserId: string,
  rule: () => PermissionResult,
): PermissionResult {
  const allowed = can(viewer, "team.manageMembers", { teamId, subjectUserId });
  return allowed.ok ? rule() : allowed;
}

/** What a member-row rule is run with: the member, their team, who is asking, and when. */
export interface MemberRowFacts {
  viewer: Viewer;
  membership: MembershipFacts;
  member: Named;
  team: Named;
  now: Date;
  /** Every membership on the team (any status): "a team keeps a Team Admin". */
  teamMemberships: readonly MembershipFacts[];
}

const actorOf = (viewer: Viewer): Named => ({
  id: viewer.userId,
  name: viewer.name,
});

/** The Members table's row: whether roles can change at all (which roles is the editor's choice), remove, restore. */
export function memberActions(row: MemberRowFacts): {
  editRoles: PermissionResult;
  remove: PermissionResult;
  reinstate: PermissionResult;
} {
  const { viewer, membership, team } = row;
  const input = { ...row, actor: actorOf(viewer) };
  const manageRow = (rule: () => PermissionResult) =>
    manage(viewer, team.id, membership.userId, rule);
  return {
    editRoles: manageRow(() =>
      okOr(changeRoles({ ...input, roles: membership.roles })),
    ),
    remove: manageRow(() => okOr(removeMember(input))),
    reinstate: manageRow(() => okOr(reinstate(input))),
  };
}

/** The Inactivity table's row: suspend, keep, restore. */
export function inactivityActions(row: MemberRowFacts): {
  suspend: PermissionResult;
  keep: PermissionResult;
  reinstate: PermissionResult;
} {
  const { viewer, membership, team } = row;
  const input = { ...row, actor: actorOf(viewer) };
  const manageRow = (rule: () => PermissionResult) =>
    manage(viewer, team.id, membership.userId, rule);
  return {
    suspend: manageRow(() => okOr(suspendInactive(input))),
    keep: manageRow(() => okOr(keepInactive(input))),
    reinstate: manageRow(() => okOr(reinstate(input))),
  };
}

/** The Access requests row: whether the viewer may decide it (never their own; once). */
export function requestActions(
  viewer: Viewer,
  teamId: string,
  request: Pick<AccessRequestFacts, "userId" | "status">,
): { decide: PermissionResult } {
  const allowed = can(viewer, "team.decideAccessRequest", {
    teamId,
    requesterId: request.userId,
  });
  return {
    decide: allowed.ok
      ? okUnless(requestDecisionRefusal(request, actorOf(viewer)))
      : allowed,
  };
}

/** A member's row in a review: whether Keep and Remove are open (`decideRecertItem` run as a keep). */
export function recertItemActions(row: {
  viewer: Viewer;
  recert: RecertFacts;
  /** The member the item is about; they may have no membership any more. */
  member: Named;
  team: Named;
  now: Date;
  teamMemberships: readonly MembershipFacts[];
}): { decide: PermissionResult } {
  const { viewer, team, member } = row;
  return {
    decide: manage(viewer, team.id, member.id, () =>
      okOr(
        decideRecertItem({
          recert: row.recert,
          userId: member.id,
          member,
          team,
          actor: actorOf(viewer),
          decision: "keep",
          now: row.now,
          teamMemberships: row.teamMemberships,
        }),
      ),
    ),
  };
}

/** "Start review": a Team Admin, when nothing is open or upcoming and somebody is left to review. */
export function startRecertAction(input: {
  viewer: Viewer;
  team: Named;
  now: Date;
  teamMemberships: readonly MembershipFacts[];
  /** The team's recertifications that aren't completed. */
  unfinished: readonly RecertFacts[];
}): PermissionResult {
  const { viewer, team } = input;
  const allowed = can(viewer, "team.manageMembers", { teamId: team.id });
  if (!allowed.ok) return allowed;
  return okOr(
    startRecert({
      team,
      actor: actorOf(viewer),
      now: input.now,
      memberships: input.teamMemberships,
      unfinished: input.unfinished,
    }),
  );
}
