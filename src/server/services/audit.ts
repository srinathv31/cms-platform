// The audit log as people read it: the Audit page of a space, the rows its CSV export writes (the BFF words
// them into the file), and one template's Activity tab. The log is the system of record (decision 0066); these
// read it and never write.
//
// Typed for step 2b: they still run in src/server/queries/audit.ts and src/server/queries/activity.ts.

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
  activity(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<Unsettled<"P4a: the activity's facts">>>;
}
