// The fake's data: one array per table, held in memory, in the row shapes the app's tables have (types only:
// nothing here loads Drizzle). `seededState()` fills it from the same seed the database gets, so a test on the
// fake starts from the world a test on the local implementation starts from: the same people, teams,
// templates, versions, renders and template ids.

import type * as ucomp from "@/server/db/schema/ucomp";
import { seedActivity } from "@/server/seed/activity";
import { createContext, type Sink } from "@/server/seed/context";
import { seedHistory } from "@/server/seed/history";
import { seedPeople } from "@/server/seed/people";
import { seedPlatform } from "@/server/seed/platform";
import { seedSimulator } from "@/server/seed/sim";
import { seedTeams } from "@/server/seed/teams";
import { seedCardStatementsTemplates } from "@/server/seed/templates/card-statements";
import { seedCoralTemplates } from "@/server/seed/templates/coral";
import { seedCoralAlerts } from "@/server/seed/templates/coral-alerts";
import { seedDepositsTemplates } from "@/server/seed/templates/deposits";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export type SettingRow = Row<typeof ucomp.settings>;
export type UserRow = Row<typeof ucomp.users>;
export type TeamRow = Row<typeof ucomp.teams>;
export type MembershipRow = Row<typeof ucomp.memberships>;
export type MembershipRoleRow = Row<typeof ucomp.membershipRoles>;
export type ContentTypeRow = Row<typeof ucomp.contentTypes>;
export type ApprovalStageRow = Row<typeof ucomp.approvalStages>;
export type ConsumerRow = Row<typeof ucomp.consumers>;
export type TemplateRow = Row<typeof ucomp.templates>;
export type VersionRow = Row<typeof ucomp.versions>;
export type ApprovalRow = Row<typeof ucomp.approvals>;
export type ThreadRow = Row<typeof ucomp.commentThreads>;
export type CommentRow = Row<typeof ucomp.comments>;
export type UploadRow = Row<typeof ucomp.uploads>;
export type RenderLogRow = Row<typeof ucomp.renderLog>;
export type ConsumerNoticeRow = Row<typeof ucomp.consumerNotices>;
export type AuditEventRow = Row<typeof ucomp.auditEvents>;
export type NotificationRow = Row<typeof ucomp.notifications>;
export type AccessRequestRow = Row<typeof ucomp.accessRequests>;
export type RecertificationRow = Row<typeof ucomp.recertifications>;
export type RecertItemRow = Row<typeof ucomp.recertItems>;

/** Every table the fake keeps. A row is as the database would read it back: defaults filled, absent is null. */
export interface FakeState {
  settings: SettingRow[];
  users: UserRow[];
  teams: TeamRow[];
  memberships: MembershipRow[];
  membershipRoles: MembershipRoleRow[];
  contentTypes: ContentTypeRow[];
  approvalStages: ApprovalStageRow[];
  consumers: ConsumerRow[];
  templates: TemplateRow[];
  versions: VersionRow[];
  approvals: ApprovalRow[];
  commentThreads: ThreadRow[];
  comments: CommentRow[];
  uploads: UploadRow[];
  renderLog: RenderLogRow[];
  consumerNotices: ConsumerNoticeRow[];
  auditEvents: AuditEventRow[];
  notifications: NotificationRow[];
  accessRequests: AccessRequestRow[];
  recertifications: RecertificationRow[];
  recertItems: RecertItemRow[];
}

/** The seeded world, and the template ids by seed key (`templates["balance-transfer"]`). */
export interface SeededState {
  state: FakeState;
  templates: Record<string, string>;
}

/** An inserted row with its column defaults, and every column it left out as null, as a read gives it back. */
function filled<R>(defaults: Partial<R>, row: Partial<R>): R {
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(row))
    if (value !== undefined) out[key] = value;
  return out as R;
}

const VERSION_DEFAULTS: Partial<VersionRow> = {
  number: null,
  round: null,
  basedOnVersionId: null,
  channelFields: {},
  smsFooter: null,
  contractChanges: null,
  stages: null,
  currentStage: 0,
  rev: 0,
  writers: [],
  submittedBy: null,
  submittedAt: null,
  submitNote: null,
  activatedAt: null,
  supersededAt: null,
  sunsetAt: null,
  sunsetSetBy: null,
  revoke: null,
  importUploadId: null,
};

/**
 * The seed, built in memory as `seedDatabase` builds it (src/server/seed/index.ts), in the same order so every
 * id comes out the same, without a database. `base` is the reset's instant, as there.
 */
export function seededState(base: Date): SeededState {
  const ctx = createContext(base.getTime());
  seedPeople(ctx);
  seedTeams(ctx);
  seedPlatform(ctx);
  seedCoralTemplates(ctx);
  seedDepositsTemplates(ctx);
  seedCardStatementsTemplates(ctx);
  seedCoralAlerts(ctx);
  seedHistory(ctx);
  seedActivity(ctx);
  seedSimulator(ctx);
  const s = ctx.sink;
  const notices = numberNotices(s.consumerNotices);
  const state: FakeState = {
    settings: [
      { key: "clock_offset_days", value: 0 },
      { key: "seeded_at", value: base.toISOString() },
      { key: "consumer_notice_seq", value: notices.length },
    ],
    users: s.users.map((r) =>
      filled<UserRow>(
        { isPersona: false, platformRole: null, lastActiveAt: null },
        r,
      ),
    ),
    teams: s.teams.map((r) =>
      filled<TeamRow>({ appName: null, smsSender: null }, r),
    ),
    memberships: s.memberships.map((r) =>
      filled<MembershipRow>(
        {
          status: "active",
          addedBy: null,
          statusChangedAt: null,
          statusReason: null,
          inactivityFlaggedAt: null,
          inactivityKeptAt: null,
        },
        r,
      ),
    ),
    membershipRoles: s.membershipRoles.map((r) =>
      filled<MembershipRoleRow>({}, r),
    ),
    contentTypes: s.contentTypes.map((r) =>
      filled<ContentTypeRow>({ smsFooter: null, smsMaxParts: 3 }, r),
    ),
    approvalStages: s.approvalStages.map((r) =>
      filled<ApprovalStageRow>({}, r),
    ),
    consumers: s.consumers.map((r) => filled<ConsumerRow>({}, r)),
    templates: s.templates.map((r) =>
      filled<TemplateRow>({ starterKey: null }, r),
    ),
    versions: s.versions.map((r) => filled<VersionRow>(VERSION_DEFAULTS, r)),
    approvals: s.approvals.map((r) =>
      filled<ApprovalRow>(
        { stageId: null, reason: null, sampleSetsSeen: null },
        r,
      ),
    ),
    commentThreads: s.commentThreads.map((r) =>
      filled<ThreadRow>(
        { quote: null, status: "open", resolvedBy: null, resolvedAt: null },
        r,
      ),
    ),
    comments: s.comments.map((r) => filled<CommentRow>({ kind: "comment" }, r)),
    uploads: [],
    renderLog: s.renderLog.map((r) =>
      filled<RenderLogRow>(
        {
          versionNumber: null,
          consumerId: null,
          platform: null,
          isPreview: false,
          errorCode: null,
          durationMs: null,
        },
        r,
      ),
    ),
    consumerNotices: notices,
    auditEvents: s.auditEvents.map((r) =>
      filled<AuditEventRow>(
        {
          actorId: null,
          teamId: null,
          templateId: null,
          versionId: null,
          details: null,
          sessionKey: null,
        },
        r,
      ),
    ),
    notifications: s.notifications.map((r) =>
      filled<NotificationRow>(
        { teamId: null, body: null, href: null, readAt: null },
        r,
      ),
    ),
    accessRequests: s.accessRequests.map((r) =>
      filled<AccessRequestRow>(
        {
          status: "pending",
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
        },
        r,
      ),
    ),
    recertifications: s.recertifications.map((r) =>
      filled<RecertificationRow>({ completedAt: null }, r),
    ),
    recertItems: s.recertItems.map((r) =>
      filled<RecertItemRow>(
        { decision: null, decidedBy: null, decidedAt: null },
        r,
      ),
    ),
  };
  return {
    state,
    templates: Object.fromEntries(
      [...ctx.templates].map(([key, t]) => [key, t.id]),
    ),
  };
}

/** `seq` 1, 2, 3, … oldest first (then by id), as `seedDatabase` numbers them. */
function numberNotices(rows: Sink["consumerNotices"]): ConsumerNoticeRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((row, i) => ({ ...row, seq: i + 1 }));
}

/** A copy no write to the original reaches: each test gets its own. */
export function cloneState(state: FakeState): FakeState {
  return structuredClone(state);
}
