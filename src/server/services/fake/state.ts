// The fake's data: one array per table, held in memory, in the row shapes the app's tables have (the schema's
// types only). `seededState()` fills it from the fixture the seed exports, loaded the way the Java side's loader
// loads it, so a test on the fake starts from the world a test on the local implementation starts from: the same
// people, teams, templates, versions, renders and ids, with the database's column defaults.

import type * as ucomp from "@/server/db/schema/ucomp";
import { buildFixture, loadFixture } from "@/server/seed/fixture";

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

/** Each of the fake's tables by its name in the database (and in the fixture). */
const TABLE_NAMES: Record<keyof FakeState, string> = {
  settings: "settings",
  users: "users",
  teams: "teams",
  memberships: "memberships",
  membershipRoles: "membership_roles",
  contentTypes: "content_types",
  approvalStages: "approval_stages",
  consumers: "consumers",
  templates: "templates",
  versions: "versions",
  approvals: "approvals",
  commentThreads: "comment_threads",
  comments: "comments",
  uploads: "uploads",
  renderLog: "render_log",
  consumerNotices: "consumer_notices",
  auditEvents: "audit_events",
  notifications: "notifications",
  accessRequests: "access_requests",
  recertifications: "recertifications",
  recertItems: "recert_items",
};

/**
 * The seed at `base` (the reset's instant): the seed's fixture (decision 0069), loaded with `loadFixture` as the
 * Java side's loader loads it. The fixture is built at `base` too: its render history is one realization of the
 * reset's calendar (business hours, weekdays), so a fixture built at another moment holds other render times than
 * the database the local implementation seeds at `base`, and the agreement test compares the two exactly. A table
 * the seed leaves empty (`uploads`) is empty here too, and the simulator's tables are left out: Coral reaches
 * Stencil only over /api/v1.
 */
export function seededState(base: Date): SeededState {
  const loaded = loadFixture(buildFixture(base), base);
  const rowsOf = (name: string) =>
    loaded.tables.find((t) => t.name === name)?.rows ?? [];
  const state = Object.fromEntries(
    Object.entries(TABLE_NAMES).map(([key, name]) => [key, rowsOf(name)]),
  ) as unknown as FakeState;
  return { state, templates: loaded.templates };
}

/** A copy no write to the original reaches: each test gets its own. */
export function cloneState(state: FakeState): FakeState {
  return structuredClone(state);
}
