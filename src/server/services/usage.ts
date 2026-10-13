// Who renders what: the Usage dashboard of a space and one template's Usage tab, from the render log (raw
// for a window, rolled up by day after the port, decision 0066).
//
// Typed for step 2b: they still run in src/server/queries/usage.ts.

import type { TemplateUsageData, UsageDashboard } from "@/domain/golive-types";
import type { ReadResult, RequestContext } from "./types";

export interface UsageService {
  dashboard(
    ctx: RequestContext,
    input: { teamId: string | null },
  ): Promise<ReadResult<{ dashboard: UsageDashboard }>>;
  template(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<{ usage: TemplateUsageData }>>;
}
