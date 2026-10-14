import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { templateUsage, usageDashboard } from "@/domain/golive/usage";
import type { TemplateUsageData, UsageDashboard } from "@/domain/golive-types";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import { requireSpace } from "./spaces";

// The Usage read models: the dashboard of a space and one template's Usage tab. The backend counts
// the render log (`services().usage`: the windows, what counts as usage, UTC days, each sunset decided in the
// business time zone) and answers facts; the domain's pure `usageDashboard` and `templateUsage`
// (src/domain/golive/usage.ts) add them up, order them and word them. Nothing here decides or reads a clock:
// every date counts from the facts' `asOf`.
//
// One denominator everywhere: a render is an ATTEMPT, succeeded or failed. "Renders" (the headline, the bars, the
// heatmap, a consumer's row) count every attempt; "failed" is the subset that errored, and "succeeded" is the
// rest as a share of attempts. So a template whose only render failed reads "1 render, 0% succeeded, 1 failed"
// and every card reconciles with every other.

/** /[team]/usage. A team space = that team's templates; "all" = every team the viewer can see. */
export const getUsageDashboard = cache(
  async (spaceSlug: string): Promise<UsageDashboard> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const facts = await services().usage.dashboard(ctx, {
      teamId: space.teamId,
    });
    if (!facts.ok) notFound();
    return usageDashboard(facts, {
      slug: space.slug,
      name: space.name,
      isAll: space.isAll,
    });
  },
);

/**
 * The per-template Usage tab: the same sources, one template, every released version. Not found when the
 * template isn't in the URL's space or isn't the viewer's to see.
 */
export const getTemplateUsage = cache(
  async (spaceSlug: string, templateId: string): Promise<TemplateUsageData> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const facts = await services().usage.template(ctx, { templateId });
    // All teams holds every team's templates; a team's space only its own (compared by id, decision 0053).
    if (
      !facts.ok ||
      (space.teamId !== null && facts.template.teamId !== space.teamId)
    )
      notFound();
    return templateUsage(facts);
  },
);
