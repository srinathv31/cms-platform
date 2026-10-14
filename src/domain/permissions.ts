// Who may do what: the one central permission check.
// Server actions check it through the kit (`check()`), pages through `requireCan`; the UI reads the
// decided `can` in a read model to show or disable an action.
// Pure TypeScript with no framework imports, so it ports directly to the Spring Boot API.
//
// A decision has two steps:
//   1. Grants: a declarative table of what each role allows. A team role counts only on the
//      resource's team, and only while that membership is active. A platform role counts on
//      every team and in the cross-team "All teams" space. Grants add up across roles.
//   2. Guards: separation-of-duties rules that block an action even when a role grants it.

import { refusal, refuse, type Refusal } from "./refusals";
import type {
  Action,
  PermissionResource,
  PermissionResult,
  PlatformRole,
  TeamRole,
  Viewer,
} from "./types";

/** Slug of the cross-team "All teams" space. */
export const ALL_SPACE = "all";

/**
 * Why `can` refuses: the only wording the UI shows for a blocked action ("explain only when blocked").
 * `generic` is the one that means "no role gives you this": the review screen hides what it refuses
 * instead of showing it dimmed. Branch on the code, never on the sentence (domain/refusals.ts).
 */
export const REASONS = {
  generic: refusal("generic", "You don't have access to do this."),
  ownVersion: refusal("submitted_version", "You submitted this version."),
  /** Maker-checker for everyone else who wrote it: started the draft or saved an edit to it. */
  wroteVersion: refusal("wrote_version", "You wrote part of this version."),
  ownRevoke: refusal(
    "own_revoke",
    "You started this revoke. Another approver must confirm it.",
  ),
  ownRequest: refusal(
    "own_request",
    "You can't decide your own access request.",
  ),
  ownAccess: refusal("own_access", "You can't change your own access."),
  /** The Auditor is read-only everywhere: no team role, request or approval gives them more. */
  auditorReadOnly: refusal(
    "auditor_read_only",
    "Auditors have read-only access and can't hold team roles.",
  ),
} as const;

// ── Grants ────────────────────────────────────────────────────

const SEE: readonly Action[] = ["template.view", "integration.view"];

const TEAM_GRANTS: Record<TeamRole, readonly Action[]> = {
  viewer: [...SEE],
  author: [
    ...SEE,
    "template.create",
    "draft.edit",
    "version.submit",
    "review.comment",
  ],
  approver: [
    ...SEE,
    "review.comment",
    "version.decide",
    "version.setSunset",
    "version.revoke.start",
    "version.revoke.confirm",
  ],
  team_admin: [
    ...SEE,
    "team.manageMembers",
    "team.decideAccessRequest",
    "audit.view",
  ],
};

/** Platform roles apply to every team and to "All teams". Neither one can edit content. */
const PLATFORM_GRANTS: Record<PlatformRole, readonly Action[]> = {
  platform_admin: [...SEE, "audit.view", "platform.manage"],
  auditor: [...SEE, "audit.view"],
};

const EVERYONE: readonly Action[] = ["access.request"];

/**
 * Everything an Auditor may do, whatever else they hold: see and read the audit log. "Sees
 * everything, changes nothing" is enforced here, centrally: a team membership an
 * Auditor somehow holds adds nothing, being named on a stage adds nothing, and they can't ask for a
 * team role (access.request is not theirs).
 */
const AUDITOR_ONLY: readonly Action[] = PLATFORM_GRANTS.auditor;

/**
 * What a user named by a version's current approval stage may do on that version (the seed's
 * Dana Park, named by a "Legal reviewer" stage): open it, decide it and comment on it, on ANY team, with no
 * membership there (a Legal stage covers every team's disclosures; otherwise a Deposits submission
 * would wait forever on someone who can't see it). The person needs some active access (a team or a
 * platform role): a suspended or lapsed person with nowhere to sign in to acts on nothing. An Auditor
 * stays read-only even when named.
 */
const NAMED_APPROVER: readonly Action[] = [
  "template.view",
  "version.decide",
  "review.comment",
];

// ── Guards ────────────────────────────────────────────────────

type Guard = (viewer: Viewer, resource: PermissionResource) => Refusal | null;

const GUARDS: Partial<Record<Action, Guard>> = {
  // Maker-checker: nobody approves their own work.
  "version.decide": (v, r) => makerCheckerRefusal(v.userId, r),
  // Two-person revoke: the confirmer must be a different approver.
  "version.revoke.confirm": (v, r) =>
    r.revokeStartedBy === v.userId ? REASONS.ownRevoke : null,
  "team.decideAccessRequest": (v, r) =>
    r.requesterId === v.userId ? REASONS.ownRequest : null,
  // Nobody changes their own roles, removes, suspends, keeps, reinstates or recertifies themselves.
  "team.manageMembers": (v, r) =>
    r.subjectUserId === v.userId ? REASONS.ownAccess : null,
};

/**
 * Maker-checker for approving or requesting changes: nobody decides a version they wrote
 * (docs/decisions/0007-maker-checker-covers-every-writer.md). The submitter reads `ownVersion`; anyone
 * else in `writers` (started the draft, or saved an edit to it, in this round or a change-requested round
 * before it) reads `wroteVersion`. Null when the actor wrote none of it. `can("version.decide")` and the
 * `approve` and `requestChanges` transitions all ask this.
 */
export function makerCheckerRefusal(
  actorId: string,
  version: { submittedBy?: string | null; writers?: readonly string[] | null },
): Refusal | null {
  if (version.submittedBy === actorId) return REASONS.ownVersion;
  if (version.writers?.includes(actorId)) return REASONS.wroteVersion;
  return null;
}

// ── The check ─────────────────────────────────────────────────

export function can(
  viewer: Viewer,
  action: Action,
  resource: PermissionResource = {},
): PermissionResult {
  const teamId = teamIdOf(resource);
  const blocked = GUARDS[action]?.(viewer, resource);
  // A self-block explains itself to anyone who can see the item, role or not:
  // the submitting author sees Approve disabled with "You submitted this version." (maker-checker),
  // and a co-author sees why they can't decide what they wrote.
  if (blocked && granted(viewer, "template.view", teamId))
    return refuse(blocked);
  if (
    !granted(viewer, action, teamId) &&
    !namedApprover(viewer, action, resource, teamId)
  ) {
    return refuse(REASONS.generic);
  }
  return blocked ? refuse(blocked) : { ok: true };
}

function granted(
  viewer: Viewer,
  action: Action,
  teamId: string | null,
): boolean {
  if (viewer.platformRole === "auditor") return AUDITOR_ONLY.includes(action);
  if (EVERYONE.includes(action)) return true;
  if (
    viewer.platformRole &&
    PLATFORM_GRANTS[viewer.platformRole].includes(action)
  )
    return true;
  if (teamId === null) return false; // cross-team context: platform roles only
  return rolesOn(viewer, teamId).some((role) =>
    TEAM_GRANTS[role].includes(action),
  );
}

/** A user the version's current stage names, opening, deciding or commenting on it (any team). */
function namedApprover(
  viewer: Viewer,
  action: Action,
  resource: PermissionResource,
  teamId: string | null,
): boolean {
  if (!NAMED_APPROVER.includes(action) || teamId === null) return false;
  if (!resource.stageApproverIds?.includes(viewer.userId)) return false;
  // The Auditor role is read-only everywhere: being named on a stage gives an Auditor nothing.
  if (viewer.platformRole === "auditor") return false;
  return hasActiveTeamAccess(viewer);
}

/**
 * An active membership with a role on some team. A platform role alone doesn't count for a named
 * stage: Platform Admin has no approve power, so naming one gives them nothing until
 * they hold a team role somewhere.
 */
export function hasActiveTeamAccess(
  viewer: Pick<Viewer, "memberships">,
): boolean {
  return viewer.memberships.some(
    (m) => m.status === "active" && m.roles.length > 0,
  );
}

/** A team id, or null (and undefined) for the cross-team context. */
function teamIdOf(resource: PermissionResource): string | null {
  return resource.teamId || null;
}

// ── Helpers for the UI ────────────────────────────────────────

/** The viewer's roles on a team. Suspended and lapsed memberships grant nothing. */
export function rolesOn(viewer: Viewer, teamId: string): TeamRole[] {
  const roles = viewer.memberships
    .filter((m) => m.status === "active" && m.teamId === teamId)
    .flatMap((m) => m.roles);
  return [...new Set(roles)];
}

/** Platform Admin and Auditor work across every team. */
export function isCrossTeam(viewer: Viewer): boolean {
  return viewer.platformRole !== null;
}

/**
 * A space the viewer can switch to: one team, or "All teams". The URL names it by `slug`; everything
 * else (permission checks, queries, services) by `teamId`, null for "All teams" (decision 0053).
 */
export interface Space {
  teamId: string | null;
  slug: string;
  name: string;
  kind: "team" | "all";
}

/** The "All teams" space, for the platform roles. */
export const ALL_TEAMS_SPACE: Space = Object.freeze({
  teamId: null,
  slug: ALL_SPACE,
  name: "All teams",
  kind: "all",
});

/**
 * The team switcher list: "All teams" first for cross-team viewers, then the viewer's active
 * teams sorted by name. Pass `allTeams` to also list every team for cross-team viewers.
 */
export function spacesFor(
  viewer: Viewer,
  allTeams: readonly { id: string; slug: string; name: string }[] = [],
): Space[] {
  const teams = new Map<string, Space>();
  const add = (teamId: string, slug: string, name: string) =>
    teams.set(teamId, { teamId, slug, name, kind: "team" });
  for (const m of viewer.memberships) {
    if (m.status === "active" && m.roles.length > 0)
      add(m.teamId, m.teamSlug, m.teamName);
  }
  if (isCrossTeam(viewer)) for (const t of allTeams) add(t.id, t.slug, t.name);

  const teamSpaces = [...teams.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return isCrossTeam(viewer) ? [ALL_TEAMS_SPACE, ...teamSpaces] : teamSpaces;
}

/** Where the viewer lands, as the slug the URL names. null means no team yet: they must request access. */
export function defaultSpace(viewer: Viewer): string | null {
  return spacesFor(viewer)[0]?.slug ?? null;
}

/**
 * Whether the viewer may enter a space: a team by its id, or "All teams" (null). Entering a space is
 * seeing its templates, so this is `template.view` there: every role on the team, and the platform roles
 * everywhere.
 */
export function canSeeSpace(viewer: Viewer, teamId: string | null): boolean {
  return can(viewer, "template.view", { teamId }).ok;
}
