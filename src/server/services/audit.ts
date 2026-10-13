// The audit log as people read it: the Audit page of a space, its CSV export, and one template's Activity tab.
// The log is the system of record (decision 0066); these read it and never write.
//
// Typed for step 2b: they still run in src/server/queries/audit.ts and src/server/queries/activity.ts.

import type { AuditFilters, AuditPageData } from "@/domain/access-types";
import type { ActivityItem } from "@/server/queries/activity";
import type { ReadResult, RequestContext } from "./types";

export interface AuditService {
  page(
    ctx: RequestContext,
    input: { teamId: string | null; filters: AuditFilters },
  ): Promise<ReadResult<{ page: AuditPageData }>>;
  export(
    ctx: RequestContext,
    input: { teamId: string | null; filters: AuditFilters },
  ): Promise<ReadResult<{ filename: string; csv: string; count: number }>>;
  activity(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<{ items: ActivityItem[] }>>;
}
