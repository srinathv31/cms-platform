// Domain vocabulary. Pure TypeScript — no React, Next or DB imports — so the rules
// can be ported to the Spring Boot API later.

export type {
  Variable,
  VariableType,
  VariableValue,
  VariableValues,
  SampleSet,
  RequiredSection,
  JSONContent,
} from "@/editor/model/types";
export { VARIABLE_TYPES } from "@/editor/model/types";

import type { VariableType } from "@/editor/model/types";

// ── Channels ──────────────────────────────────────────────────
export const CHANNELS = ["pdf", "web", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

// ── Lifecycle ─────────────────────────────────────────────────
export const VERSION_STATES = [
  "draft",
  "in_review",
  "changes_requested",
  "active",
  "superseded",
  "revoked",
] as const;
export type VersionState = (typeof VERSION_STATES)[number];

export interface RevokeRecord {
  reason: string;
  startedBy: string;
  startedAt: string; // ISO
  confirmedBy?: string;
  confirmedAt?: string; // ISO
}

export type ContractChangeKind =
  | "added"
  | "removed"
  | "key_renamed"
  | "type_changed"
  | "made_required"
  | "made_optional"
  | "label_changed";

export interface ContractChange {
  kind: ContractChangeKind;
  key: string;
  breaking: boolean;
  from?: string;
  to?: string;
  type?: VariableType;
  required?: boolean;
}

// ── People, teams, access ─────────────────────────────────────
export const TEAM_ROLES = ["viewer", "author", "approver", "team_admin"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export type PlatformRole = "platform_admin" | "auditor";
export type MembershipStatus = "active" | "suspended" | "lapsed";

export interface ViewerMembership {
  teamId: string;
  teamSlug: string;
  teamName: string;
  roles: TeamRole[];
  status: MembershipStatus;
}

/** Who is looking. Built from the persona cookie on every request. */
export interface Viewer {
  userId: string;
  name: string;
  initials: string;
  title: string;
  platformRole: PlatformRole | null;
  memberships: ViewerMembership[];
}

export type ApproverRule =
  | { kind: "team_role"; role: TeamRole }
  | { kind: "user"; userId: string };

// ── Permissions (implemented in permissions.ts) ───────────────
export type Action =
  | "template.view"
  | "template.create" // create, import
  | "draft.edit" // edit content, manage variables
  | "version.submit"
  | "review.comment"
  | "version.decide" // approve or request changes
  | "version.setSunset"
  | "version.revoke.start"
  | "version.revoke.confirm"
  | "integration.view"
  | "team.manageMembers" // members, recertification, inactivity
  | "team.decideAccessRequest"
  | "platform.manage" // teams, content types, channel rules, approval chains
  | "audit.view"
  | "access.request";

/**
 * What the action is being taken on. Only the fields relevant to the action are needed.
 * teamId null/undefined = cross-team context (e.g. the "All teams" space).
 */
export interface PermissionResource {
  teamId?: string | null;
  /** Who submitted / authored the version (maker-checker). */
  submittedBy?: string | null;
  /** Who started a revoke (two-person rule). */
  revokeStartedBy?: string | null;
  /** Whose access request is being decided. */
  requesterId?: string | null;
}

export type PermissionResult = { ok: true } | { ok: false; reason: string };

// ── Rendering ─────────────────────────────────────────────────
export type RenderOutcome = "ok" | "error";
