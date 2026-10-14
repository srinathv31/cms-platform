// The audit log as people read it: the Audit page of a space, the events its CSV export writes (the BFF words
// them into the file), and one template's Activity tab. The log is the system of record (decision 0066); these
// read it and never write.
//
// `page` and `exportRows` answer facts: the events (what happened, to what, by whom, as it was recorded), the
// filters narrowed to what the space knows, and the counts and options the menus list, all under the filters by
// team id (decision 0053). The BFF resolves the URL's team slugs to ids, and words everything: a sentence for
// each event, its labels, "3 days ago", the menus' names and the CSV's cells. `activity` answers a template's
// events as facts too (./activity.ts). All three run behind the seam: `activity` local and fake, the Audit page's
// two in the local implementation.

import type { AuditCategory } from "@/domain/access-types";
import type { AuditSearch } from "@/domain/audit";
import type { Person } from "@/domain/review-types";
import type { VersionState } from "@/domain/types";
import type { TemplateActivity } from "./activity";
import type { ReadResult, RequestContext } from "./types";

export type { AuditSearch } from "@/domain/audit";

/** A team an event names, for its slug (links, the Team menu) and its name. */
export interface AuditTeamFacts {
  id: string;
  slug: string;
  name: string;
}

/** One event of the audit log, as it was recorded. */
export interface AuditEventFacts {
  id: string;
  /** ISO. */
  at: string;
  /** User id; null when the system acted (a clock-driven sweep). */
  actorId: string | null;
  /** null for a platform-wide event. */
  teamId: string | null;
  templateId: string | null;
  /**
   * The template's name as the event's version had it, else (an event about the template alone, its creation) as
   * the Library names it now. null when the event has no template.
   */
  templateName: string | null;
  /** The template's name now (`currentName`): the Template menu lists each template once by it. */
  templateCurrentName: string | null;
  /** The action as recorded (`version.stage_approved`, `access.granted`, …). */
  action: string;
  /** What the event recorded: ids, names as they were, never a variable's value. */
  details: Record<string, unknown> | null;
  /** The event's version row as it is now (its number, round and state); null when it has none. */
  version: { number: number; round: number; state: VersionState } | null;
}

/** The Audit page of a space. */
export interface AuditPageFacts {
  /** ISO: the backend's instant it read the log at. */
  asOf: string;
  /** Every team in an All teams space; the one team in a team's. */
  teams: AuditTeamFacts[];
  /**
   * The search in force: what was asked, narrowed to what the space knows. A team space is pinned to its team,
   * and a person, template or team the space doesn't hold is dropped, so a chip never matches nothing.
   */
  applied: AuditSearch;
  /** The events matching `applied`, before the page limit. */
  total: number;
  /** The newest of them first, at most `AUDIT_PAGE_LIMIT` (src/domain/audit.ts). */
  events: AuditEventFacts[];
  /**
   * What the five menus list, with how many events each value would match under every OTHER filter. A value
   * with no event still counts 0 when the menu lists it.
   */
  options: {
    /** Every team of the All teams space; none in a team's. */
    teams: { id: string; count: number }[];
    /** Everyone the space's events name (who acted or whom they are about), and `system` for nobody. */
    people: { id: string; count: number }[];
    /** The three categories. */
    categories: { category: AuditCategory; count: number }[];
    /** The canonical actions the space holds, and any the search selected. */
    actions: { action: string; count: number }[];
    /** Each template the space names once, by its current name. */
    templates: {
      id: string;
      name: string;
      teamId: string | null;
      count: number;
    }[];
  };
  /** Everyone the events and the menus name by id. */
  people: Person[];
}

/** Every event a search matches: what the CSV export writes. */
export interface AuditExportFacts {
  /** ISO: the backend's instant it read the log at. The export's file name takes its day. */
  asOf: string;
  teams: AuditTeamFacts[];
  /** Every matching event, newest first, with no page limit. */
  events: AuditEventFacts[];
  /** Everyone the events name by id. */
  people: Person[];
}

export interface AuditService {
  /**
   * The Audit page of a space: a team's (`teamId`) for whoever holds `audit.view` there, or every team's and the
   * platform-wide events (`null`: All teams) for the platform roles. Refuses 404 `space_unavailable` for a team
   * that doesn't exist, and 403 `generic` where the viewer may not read the log.
   */
  page(
    ctx: RequestContext,
    input: { teamId: string | null; search: AuditSearch },
  ): Promise<ReadResult<AuditPageFacts>>;
  /** Every event the search matches, for the CSV export. Refuses as `page` does. */
  exportRows(
    ctx: RequestContext,
    input: { teamId: string | null; search: AuditSearch },
  ): Promise<ReadResult<AuditExportFacts>>;
  /**
   * A template's Activity tab: its audit events, newest first (at most `ACTIVITY_LIMIT`). Refuses 404
   * `template_unavailable` when the template doesn't exist or the viewer may not see its team.
   */
  activity(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<TemplateActivity>>;
}
