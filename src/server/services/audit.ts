// The audit log as people read it: the Audit page of a space, the rows its CSV export writes (the BFF words
// them into the file), and one template's Activity tab. The log is the system of record (decision 0066); these
// read it and never write.
//
// `activity` runs behind the seam (local and fake; its facts are in ./activity.ts). The Audit page's reads are
// typed for step 2b: they still run in src/server/queries/audit.ts.

import type { TemplateActivity } from "./activity";
import type { ReadResult, RequestContext, Unsettled } from "./types";

/** The Audit page's filters: by team id (never slug), person, action, template and day range. */
export type AuditFilters = Unsettled<"P4b: the audit filters, by team id">;

export interface AuditService {
  page(
    ctx: RequestContext,
    input: { teamId: string | null; filters: AuditFilters },
  ): Promise<ReadResult<Unsettled<"P4b: the audit page's facts">>>;
  exportRows(
    ctx: RequestContext,
    input: { teamId: string | null; filters: AuditFilters },
  ): Promise<ReadResult<Unsettled<"P4b: the audit events an export writes">>>;
  /**
   * A template's Activity tab: its audit events, newest first (at most `ACTIVITY_LIMIT`). Refuses 404
   * `template_unavailable` when the template doesn't exist or the viewer may not see its team.
   */
  activity(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<TemplateActivity>>;
}
