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
  ContractChange,
  ContractChangeKind,
} from "@/editor/model/types";
export { VARIABLE_TYPES } from "@/editor/model/types";

import type { JSONContent, SampleSet, Variable } from "@/editor/model/types";
import type { Refused } from "./refusals";

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

// ── People, teams, access ─────────────────────────────────────
export const TEAM_ROLES = ["viewer", "author", "approver", "team_admin"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export type PlatformRole = "platform_admin" | "auditor";
export type MembershipStatus = "active" | "suspended" | "lapsed";
/**
 * Why a membership is not active (Phase 6). `recert_unconfirmed`: lapsed at a recertification
 * deadline. `inactivity`: a Team Admin suspended a flagged member. `inactivity_auto`: suspended
 * automatically 120 days after the last sign-in. null while active.
 */
export type MembershipStatusReason = "recert_unconfirmed" | "inactivity" | "inactivity_auto";

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
  /** Who submitted the version (maker-checker). */
  submittedBy?: string | null;
  /**
   * Who wrote the version: started its draft or saved an edit to it, in this round or a change-requested
   * round before it, plus its submitter (maker-checker, `versions.writers`). Pass it with `submittedBy`
   * wherever `version.decide` is asked.
   */
  writers?: readonly string[] | null;
  /** Who started a revoke (two-person rule). */
  revokeStartedBy?: string | null;
  /** Whose access request is being decided. */
  requesterId?: string | null;
  /**
   * Whose membership is being changed (roles, remove, suspend, keep, reinstate, recertify).
   * Nobody changes their own access (Phase 6).
   */
  subjectUserId?: string | null;
  /**
   * Users a version's current approval stage names (`{kind:"user"}` rules, e.g. Dana Park's
   * "Legal reviewer"). Such a user may open, decide and comment on that version on ANY team, with
   * no membership or Approver role there, as long as they have active access somewhere and aren't
   * an Auditor (Phase 6). Pass it only for the version in review whose current stage names them.
   */
  stageApproverIds?: readonly string[] | null;
}

/** Allowed, or refused with a stable `code` to branch on and the sentence to show (domain/refusals.ts). */
export type PermissionResult = { ok: true } | Refused;

// ── Rendering ─────────────────────────────────────────────────
export type RenderOutcome = "ok" | "error";

// ── Drafts (autosave: PUT /api/drafts/[versionId]) ────────────
/**
 * Body of an autosave. Only the fields that changed since the last save are sent.
 * The server checks `draft.edit`, accepts only versions in the `draft` state, and merges every
 * save of one editing session (`sessionKey`) into a single `draft.edited` audit row.
 */
export interface DraftPatch {
  /** The rev the client last saw. A stale rev gets a `conflict` response carrying the current rev. */
  rev: number;
  /** One per editing session (one page visit). */
  sessionKey: string;
  body?: JSONContent;
  variables?: Variable[];
  /** The template's name (lives on the template; editable only while a draft is open). */
  name?: string;
  channels?: Channel[];
  emailSubject?: JSONContent | null;
  emailPreheader?: JSONContent | null;
  sampleSets?: SampleSet[];
}

export type DraftSaveError = "conflict" | "forbidden" | "not_draft" | "not_found" | "invalid";

export type DraftSaveResponse =
  | { ok: true; rev: number; savedAt: string /* ISO, demo clock */ }
  | { ok: false; error: DraftSaveError; rev?: number; message: string };
