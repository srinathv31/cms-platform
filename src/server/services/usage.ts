// Who renders what: the Usage dashboard of a space and one template's Usage tab, from the render log (raw
// for a window, rolled up by day after the port, decision 0066). The service answers counts by day, channel and
// consumer; the aggregates and the words are the domain's and the BFF's (src/domain/golive/usage.ts).
//
// Typed for step 2b: they still run in src/server/queries/usage.ts.

import type { ReadResult, RequestContext, Unsettled } from "./types";

export interface UsageService {
  dashboard(
    ctx: RequestContext,
    input: { teamId: string | null },
  ): Promise<ReadResult<Unsettled<"P4c: the dashboard's render counts">>>;
  template(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<Unsettled<"P4c: one template's render counts">>>;
}
