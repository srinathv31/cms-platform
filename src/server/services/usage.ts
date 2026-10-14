// Who renders what: the Usage dashboard of a space and one template's Usage tab, from the render log (raw for a
// window, rolled up by day after the port, decision 0066). The service answers counts: by template, consumer,
// version and channel in the two rolling windows, by UTC day, and each version's sunset decided in the business
// time zone. What counts as usage, the windows and the days are the backend's (src/domain/golive/usage.ts:
// `countsAsUsage`, `usageWindows`, decision 0028); adding the counts up, ordering them and wording them
// ("sunset in 6 days", "3 failed renders") is the BFF's, with `usageDashboard` and `templateUsage` over the facts.

import type {
  DashboardUsageFacts,
  TemplateUsageFacts,
} from "@/domain/golive/usage";
import type { ReadResult, RequestContext } from "./types";

export type {
  DashboardUsageFacts,
  TemplateUsageFacts,
  UsageCell,
  UsageConsumerFacts,
  UsageDayCount,
  UsageError,
  UsageSpark,
  UsageSunset,
  UsageTemplateFacts,
  UsageVersionDayCount,
  UsageVersionFacts,
} from "@/domain/golive/usage";

export interface UsageService {
  /**
   * The counts for a space: a team by id, or every team (null) for the platform roles. Only the templates the
   * viewer may see count. Refuses 404 `space_unavailable` when the viewer may not enter the space.
   */
  dashboard(
    ctx: RequestContext,
    input: { teamId: string | null },
  ): Promise<ReadResult<DashboardUsageFacts>>;

  /**
   * One template's counts, every released version included. Refuses 404 `template_unavailable` when the template
   * doesn't exist or the viewer may not see its team (the two read the same, decision 0052).
   */
  template(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<TemplateUsageFacts>>;
}
