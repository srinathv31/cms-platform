import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { ACTIVITY_LIMIT, type ActivityEventFacts } from "../activity";
import type { AuditService } from "../audit";
import { refusal } from "../results";
import { peopleOf } from "./people";
import { templateById } from "./version-rows";
import type { FakeDeps } from "./index";

// A template's Activity tab in memory: the twin of services/local/activity.ts. Audit rows are kept in the order
// they were written, which stands in for the database's rowid: same-moment rows read newest-written first. The
// contract suite observes every command's audit rows through it.

export function fakeActivity({
  store,
  clock,
}: FakeDeps): Pick<AuditService, "activity"> {
  return {
    async activity(ctx, { templateId }) {
      const asOf = await clock();
      const { state } = store;
      const template = templateById(state, templateId);
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const events = state.auditEvents
        .map((row, written) => ({ row, written }))
        .filter(({ row }) => row.templateId === template.id)
        .sort(
          (a, b) =>
            b.row.at.getTime() - a.row.at.getTime() || b.written - a.written,
        )
        .slice(0, ACTIVITY_LIMIT)
        .map(({ row }): ActivityEventFacts => {
          const version = row.versionId
            ? state.versions.find((v) => v.id === row.versionId)
            : undefined;
          return {
            id: row.id,
            at: row.at.toISOString(),
            actorId: row.actorId,
            action: row.action,
            versionId: row.versionId,
            version:
              version && version.number !== null && version.round !== null
                ? {
                    number: version.number,
                    round: version.round,
                    state: version.state,
                  }
                : null,
            details: row.details ?? {},
          };
        });
      return {
        ok: true,
        asOf: asOf.toISOString(),
        template: { id: template.id, teamId: template.teamId },
        events,
        people: peopleOf(
          state,
          events.map((e) => e.actorId),
        ),
      };
    },
  };
}
