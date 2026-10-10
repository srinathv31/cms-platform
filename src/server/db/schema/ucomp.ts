// UCOMP's own tables. UCOMP stores templates only — never customer data or rendered documents.
// The consumer simulator's tables live in ./sim.ts and are never imported by UCOMP code.

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  ApproverRule,
  Channel,
  ContractChange,
  JSONContent,
  MembershipStatus,
  MembershipStatusReason,
  PlatformRole,
  RequiredSection,
  RevokeRecord,
  SampleSet,
  TeamRole,
  Variable,
  VariableValues,
  VersionState,
} from "@/domain/types";
import type { ChannelFields } from "@/domain/channel-fields";
import type { ConsumerNoticeKind, VersionStage } from "@/domain/review-types";

const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

// ── Settings (demo clock offset, seed version) ────────────────
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: json<unknown>("value").notNull(),
});

// ── People and teams ──────────────────────────────────────────
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // e.g. "maya"
  name: text("name").notNull(),
  email: text("email").notNull(),
  initials: text("initials").notNull(),
  avatarHue: integer("avatar_hue").notNull(), // 0–360, rendered through tokens
  title: text("title").notNull(),
  isPersona: integer("is_persona", { mode: "boolean" }).notNull().default(false),
  platformRole: text("platform_role").$type<PlatformRole>(),
  lastActiveAt: ts("last_active_at"),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(), // lucide icon key
  createdAt: ts("created_at").notNull(),
});

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    teamId: text("team_id").notNull().references(() => teams.id),
    status: text("status").$type<MembershipStatus>().notNull().default("active"),
    addedAt: ts("added_at").notNull(),
    addedBy: text("added_by").references(() => users.id),
    statusChangedAt: ts("status_changed_at"),
    /** Why the membership is suspended or lapsed; null while active (Phase 6). */
    statusReason: text("status_reason").$type<MembershipStatusReason>(),
    /** When the 90-day inactivity flag was raised (and its notification sent); null when not flagged. */
    inactivityFlaggedAt: ts("inactivity_flagged_at"),
    /** A Team Admin's last Keep (or reinstatement): the inactivity clock restarts from it. */
    inactivityKeptAt: ts("inactivity_kept_at"),
  },
  (t) => [uniqueIndex("memberships_user_team").on(t.userId, t.teamId)],
);

export const membershipRoles = sqliteTable(
  "membership_roles",
  {
    membershipId: text("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    role: text("role").$type<TeamRole>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.role] })],
);

// ── Platform configuration ────────────────────────────────────
export const contentTypes = sqliteTable("content_types", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(), // "disclosure"
  name: text("name").notNull(),
  requiredSections: json<RequiredSection[]>("required_sections").notNull(),
  allowedChannels: json<Channel[]>("allowed_channels").notNull(),
});

export const approvalStages = sqliteTable("approval_stages", {
  id: text("id").primaryKey(),
  contentTypeId: text("content_type_id")
    .notNull()
    .references(() => contentTypes.id),
  position: integer("position").notNull(),
  name: text("name").notNull(),
  approverRule: json<ApproverRule>("approver_rule").notNull(),
});

// ── Templates and versions ────────────────────────────────────
export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(), // "UC-4F7K2Q" — stable, consumer-facing
    teamId: text("team_id").notNull().references(() => teams.id),
    contentTypeId: text("content_type_id")
      .notNull()
      .references(() => contentTypes.id),
    // No name here: each version carries its own (`versions.name`), so a rename goes through review.
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: ts("created_at").notNull(),
    starterKey: text("starter_key"),
  },
  (t) => [index("templates_team").on(t.teamId)],
);

export const versions = sqliteTable(
  "versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id),
    number: integer("number"), // null while draft; assigned at submit, then frozen
    state: text("state").$type<VersionState>().notNull(),
    // The template's name as this version has it: an author renames the open draft, and customers see
    // the name of the version they render (the Active one's, where the API speaks of the template).
    name: text("name").notNull(),
    basedOnVersionId: text("based_on_version_id"),
    body: json<JSONContent>("body").notNull(), // TipTap JSON; variable nodes hold only their key
    // Each channel's own short fields (src/domain/channel-fields.ts), by channel and then field key:
    // { "email": { "subject": <doc>, "preheader": <doc> } }. A field with no value is absent.
    channelFields: json<ChannelFields>("channel_fields").notNull().default(sql`'{}'`),
    channels: json<Channel[]>("channels").notNull(),
    variables: json<Variable[]>("variables").notNull(),
    sampleSets: json<SampleSet[]>("sample_sets").notNull(),
    contractChanges: json<ContractChange[]>("contract_changes"),
    // The approval stages this version goes through, recorded at submit from its content type's chain:
    // [{ id, name }] in order. Chain edits never change it; each stage's rule is read from
    // approval_stages by id. Null while a draft.
    stages: json<VersionStage[]>("stages"),
    // A position in `stages`: the stage the version waits on, or the one that decided it last.
    currentStage: integer("current_stage").notNull().default(0),
    rev: integer("rev").notNull().default(0), // autosave ordering
    createdBy: text("created_by").notNull().references(() => users.id),
    // User ids of everyone who wrote this version (maker-checker: none of them may decide it). Whoever
    // started the draft, everyone whose autosave landed, the submitter, and, for a draft a change
    // request opened, the writers of the version sent back. A draft from the Active version starts afresh.
    writers: json<string[]>("writers").notNull().default(sql`'[]'`),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    submittedBy: text("submitted_by").references(() => users.id),
    submittedAt: ts("submitted_at"),
    submitNote: text("submit_note"),
    activatedAt: ts("activated_at"),
    supersededAt: ts("superseded_at"),
    sunsetAt: ts("sunset_at"),
    sunsetSetBy: text("sunset_set_by").references(() => users.id),
    revoke: json<RevokeRecord>("revoke"),
    importUploadId: text("import_upload_id"),
  },
  (t) => [
    index("versions_template").on(t.templateId),
    uniqueIndex("versions_template_number").on(t.templateId, t.number),
    // At most one open draft and one Active version per template.
    uniqueIndex("versions_one_draft")
      .on(t.templateId)
      .where(sql`state = 'draft'`),
    uniqueIndex("versions_one_active")
      .on(t.templateId)
      .where(sql`state = 'active'`),
  ],
);

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  versionId: text("version_id")
    .notNull()
    .references(() => versions.id),
  // The approval_stages id decided (no foreign key: a stage behind every version may be removed). Null
  // only for a decision from before the column whose position matched no stage of the chain then.
  stageId: text("stage_id"),
  // The stage's position in the version's own `stages`, and its name there.
  stagePosition: integer("stage_position").notNull(),
  stageName: text("stage_name").notNull(),
  actorId: text("actor_id").notNull().references(() => users.id),
  decision: text("decision").$type<"approved" | "changes_requested">().notNull(),
  reason: text("reason"),
  sampleSetsSeen: json<string[]>("sample_sets_seen"),
  decidedAt: ts("decided_at").notNull(),
});

// ── Review comments (anchored to stable block ids) ────────────
export const commentThreads = sqliteTable(
  "comment_threads",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id),
    originVersionId: text("origin_version_id")
      .notNull()
      .references(() => versions.id),
    blockId: text("block_id").notNull(),
    quote: text("quote"),
    status: text("status").$type<"open" | "resolved">().notNull().default("open"),
    resolvedBy: text("resolved_by").references(() => users.id),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("threads_template").on(t.templateId)],
);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => commentThreads.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  kind: text("kind").$type<"comment" | "change_request">().notNull().default("comment"),
  createdAt: ts("created_at").notNull(),
});

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  templateId: text("template_id").references(() => templates.id),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(), // under ./data/uploads (stands in for Azure Blob)
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull(),
});

// ── Consumers, rendering, outbound notices ────────────────────
export const consumers = sqliteTable("consumers", {
  id: text("id").primaryKey(), // "coral"
  name: text("name").notNull(),
  description: text("description").notNull(),
  clientName: text("client_name").notNull(),
});

/** Every render. NEVER holds variable values. */
export const renderLog = sqliteTable(
  "render_log",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    templateId: text("template_id").notNull(),
    versionId: text("version_id").notNull(),
    versionNumber: integer("version_number"),
    consumerId: text("consumer_id"),
    channel: text("channel").$type<Channel>().notNull(),
    isPreview: integer("is_preview", { mode: "boolean" }).notNull().default(false),
    correlationId: text("correlation_id").notNull(),
    outcome: text("outcome").$type<"ok" | "error">().notNull(),
    errorCode: text("error_code"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("render_log_template_at").on(t.templateId, t.at),
    index("render_log_consumer_at").on(t.consumerId, t.at),
  ],
);

/**
 * UCOMP's outbox to consumers: new version available, sunset scheduled, sunset passed, revoked.
 *
 * `seq` is the order notices were committed in, and the notices API pages on it: 1, 2, 3, … across all
 * consumers, assigned inside the writing transaction (`takeNoticeSeqs` in server/effects.ts). Writers
 * take turns, so a notice that becomes visible later always has a higher `seq`. The last number taken
 * is kept in `settings.consumer_notice_seq`, so a deleted notice's number is never reused. `created_at`
 * is the action's clock, read before its transaction, so it can't order the outbox; ids are random.
 */
export const consumerNotices = sqliteTable(
  "consumer_notices",
  {
    id: text("id").primaryKey(),
    seq: integer("seq").notNull(),
    consumerId: text("consumer_id")
      .notNull()
      .references(() => consumers.id),
    templateId: text("template_id").notNull(),
    versionId: text("version_id").notNull(),
    kind: text("kind").$type<ConsumerNoticeKind>().notNull(),
    payload: json<Record<string, unknown>>("payload").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("consumer_notices_seq").on(t.seq), index("consumer_notices_consumer_seq").on(t.consumerId, t.seq)],
);

// ── Audit, notifications, access ──────────────────────────────
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    actorId: text("actor_id").references(() => users.id),
    teamId: text("team_id"),
    templateId: text("template_id"),
    versionId: text("version_id"),
    action: text("action").notNull(),
    details: json<Record<string, unknown>>("details"),
    sessionKey: text("session_key"), // groups draft saves per editing session
  },
  (t) => [
    index("audit_at").on(t.at),
    index("audit_team").on(t.teamId),
    // Autosave merges every save of an editing session into one row: looked up on each save.
    index("audit_version_session").on(t.versionId, t.sessionKey),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    teamId: text("team_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    createdAt: ts("created_at").notNull(),
    readAt: ts("read_at"),
  },
  (t) => [index("notifications_user").on(t.userId)],
);

export const accessRequests = sqliteTable(
  "access_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    role: text("role").$type<TeamRole>().notNull(),
    reason: text("reason").notNull(),
    status: text("status").$type<"pending" | "approved" | "denied">().notNull().default("pending"),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("access_requests_team_status").on(t.teamId, t.status), index("access_requests_user").on(t.userId)],
);

export const recertifications = sqliteTable("recertifications", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  label: text("label").notNull(), // "Q1 2027"
  startsAt: ts("starts_at").notNull(),
  dueAt: ts("due_at").notNull(),
  completedAt: ts("completed_at"),
});

export const recertItems = sqliteTable(
  "recert_items",
  {
    recertId: text("recert_id")
      .notNull()
      .references(() => recertifications.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    decision: text("decision").$type<"keep" | "remove">(),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
  },
  (t) => [primaryKey({ columns: [t.recertId, t.userId] })],
);

export type SampleValues = VariableValues;
