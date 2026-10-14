import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { db } from "@/server/db/client";
import { auditEvents, versions } from "@/server/db/schema/ucomp";
import { ACTIVITY_LIMIT, type ActivityEventFacts } from "../activity";
import type { AuditService } from "../audit";
import { refusal } from "../results";
import type { LocalDeps } from "./command";
import { loadPeople } from "./people";
import { visibleTemplate } from "./visible-template";

// A template's Activity tab on this app's own database (src/server/services/audit.ts says what `activity`
// promises): its audit events, newest first, each with the version it is about as that row is now.

export function localActivity(deps: LocalDeps): Pick<AuditService, "activity"> {
  return {
    async activity(ctx, { templateId }) {
      const template = await visibleTemplate(ctx.viewer, templateId);
      if (!template) return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const asOf = await deps.clock();
      const rows = await db
        .select({
          id: auditEvents.id,
          at: auditEvents.at,
          actorId: auditEvents.actorId,
          action: auditEvents.action,
          details: auditEvents.details,
          versionId: auditEvents.versionId,
          number: versions.number,
          round: versions.round,
          state: versions.state,
        })
        .from(auditEvents)
        .leftJoin(versions, eq(versions.id, auditEvents.versionId))
        .where(eq(auditEvents.templateId, template.id))
        // Same-moment rows (a submit and the change request it answers) read newest-written first.
        .orderBy(desc(auditEvents.at), desc(sql`${auditEvents}.rowid`))
        .limit(ACTIVITY_LIMIT);
      const events = rows.map((r): ActivityEventFacts => ({
        id: r.id,
        at: r.at.toISOString(),
        actorId: r.actorId,
        action: r.action,
        versionId: r.versionId,
        version:
          r.number !== null && r.round !== null && r.state !== null
            ? { number: r.number, round: r.round, state: r.state }
            : null,
        details: r.details ?? {},
      }));
      return {
        ok: true,
        asOf: asOf.toISOString(),
        template: { id: template.id, teamId: template.teamId },
        events,
        people: await loadPeople(events.map((e) => e.actorId)),
      };
    },
  };
}
