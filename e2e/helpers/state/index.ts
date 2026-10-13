// The one door to what e2e checks and arranges in Stencil's data. Specs import from "./helpers/state" and nothing
// else touches the database; see README.md for what each concern holds and what another backend must provide.
// `db.ts` is deliberately not exported: it is the SQLite behind the rest.

export { Changes } from "./changes";
export {
  clockDay,
  clockOffsetDays,
  demoNow,
  setClockOffsetDays,
} from "./clock";
export {
  consumerIds,
  consumerNotices,
  noticeSeqs,
  renderLog,
  renderLogFields,
  renderLogFor,
  renderLogRowsContaining,
  type NoticeFilter,
  type RenderLogFilter,
} from "./consumers";
export {
  SPRING_NAME,
  TEAM,
  createSpringTravel,
  removeSpringTravel,
  type SpringFixture,
} from "./fixtures";
export { approversOf, membershipOf } from "./people";
export {
  addApprovalStage,
  approvalChain,
  contentType,
  deleteSetting,
  moveApprovalStage,
  setSetting,
  setting,
  withAllowedChannels,
} from "./platform";
export type * from "./records";
export { resetDemoData } from "./reset";
export {
  addCommentThread,
  approvalsOf,
  commentThread,
  commentThreads,
  commentsIn,
  decisionsOnTemplate,
  type ThreadFilter,
} from "./review";
export {
  linkOffer,
  simDeliveries,
  simLink,
  type DeliveryFilter,
  type SimulatorScope,
} from "./simulator";
export { removeTemplate, uploadsOf } from "./templates";
export {
  auditEvents,
  notificationsAbout,
  storedTextAbout,
  type AuditFilter,
} from "./trail";
export {
  addVersionLike,
  allVersions,
  bumpDraftRev,
  findVersion,
  findVersions,
  openDraftOf,
  templateById,
  versionById,
  versionNumbered,
  versionsOf,
  withVersion,
  type VersionFilter,
} from "./versions";
