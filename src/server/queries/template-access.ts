import "server-only";
import { cache } from "react";
import { requireSpace, type SpaceContext } from "./spaces";
import { getWorkspaceHeaderFacts } from "./workspace";

// A bridge for the one read model that hasn't moved behind the seam yet and still gates its page this way: the
// template's Usage tab (`getTemplateUsage` in usage.ts, plan P4c). The gate itself is the template service's now:
// the workspace header's read answers Not found for a template the viewer may not see, and this compares its team
// with the URL's space, as every moved read model does. Delete this file once usage.ts no longer imports it.

export interface TemplateAccess {
  space: SpaceContext;
  /** `name` is the CMS's name for the template: its open draft's, otherwise its newest version's. */
  template: {
    id: string;
    name: string;
    teamId: string;
    teamSlug: string;
    teamName: string;
    contentTypeId: string;
  };
}

/**
 * The template, as seen from a space: Not found when it doesn't exist, belongs to another team's space, or
 * sits on a team the viewer can't see. The workspace header's facts, which the tab's layout reads anyway.
 */
export const requireTemplate = cache(
  async (spaceSlug: string, templateId: string): Promise<TemplateAccess> => {
    const header = await getWorkspaceHeaderFacts(spaceSlug, templateId);
    return {
      space: await requireSpace(spaceSlug),
      template: {
        ...header.template,
        name: header.shown?.name ?? header.template.id,
      },
    };
  },
);
