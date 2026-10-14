import "server-only";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { sunsetDay, todayIn } from "@/domain/business-zone";
import { channelFieldValues } from "@/domain/channel-fields";
import { DAY_MS } from "@/domain/dates";
import { smsFooterOf } from "@/domain/lifecycle/submit";
import { versionActions } from "@/domain/lifecycle/version-actions";
import { sunsetPassed } from "@/domain/lifecycle/sunset";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { isRequestId } from "@/domain/request-ids";
import { compareRounds, headOf } from "@/domain/rounds";
import { readBusinessZone } from "@/server/services/local/business-zone";
import { db } from "@/server/db/client";
import {
  approvals,
  renderLog,
  teams,
  templates,
  users,
  versions,
} from "@/server/db/schema/ucomp";
import { loadConsumerUsage } from "@/server/services/local/consumer-usage";
import { currentName } from "@/server/services/local/template-name";
import { refusal } from "../results";
import type {
  CompareVersionFacts,
  VersionFacts,
  VersionService,
} from "../versions";
import { loadFamily, loadMessageRules } from "./chain";
import type { LocalDeps } from "./command";
import { findTemplate } from "./visible-template";

// One template's versions on this app's own database (src/server/services/versions.ts says what each read
// promises): the rows, their decisions and renders, and what the viewer may do on each, decided by the domain
// on the backend's clock, which the answer names (`asOf`); and the content of the versions Compare and "Revert to
// vN" read on demand.

export function localVersions(deps: LocalDeps): VersionService {
  return {
    async history(ctx, { templateId }) {
      const [template] = await db
        .select({
          id: templates.id,
          teamId: templates.teamId,
          teamSlug: teams.slug,
          name: currentName(templates.id),
        })
        .from(templates)
        .innerJoin(teams, eq(teams.id, templates.teamId))
        .where(eq(templates.id, templateId))
        .limit(1);
      // Not there, and not the viewer's to see, read the same (decision 0052).
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);

      const now = await deps.clock();
      const since = now.getTime() - 30 * DAY_MS;
      const rows = await db
        .select({
          id: versions.id,
          number: versions.number,
          round: versions.round,
          state: versions.state,
          createdBy: versions.createdBy,
          createdAt: versions.createdAt,
          submittedBy: versions.submittedBy,
          submittedAt: versions.submittedAt,
          submitNote: versions.submitNote,
          activatedAt: versions.activatedAt,
          supersededAt: versions.supersededAt,
          sunsetAt: versions.sunsetAt,
          revoke: versions.revoke,
          contractChanges: versions.contractChanges,
        })
        .from(versions)
        .where(eq(versions.templateId, template.id));

      const ids = rows.map((r) => r.id);
      const [zone, decisionRows, renderRows, consumerUsage] = await Promise.all(
        [
          readBusinessZone(db),
          ids.length
            ? db
                .select()
                .from(approvals)
                .where(inArray(approvals.versionId, ids))
                .orderBy(asc(approvals.decidedAt), asc(approvals.id))
            : [],
          db
            .select({
              versionId: renderLog.versionId,
              lastRenderAt: sql<number>`max(${renderLog.at})`,
              renders30d: sql<number>`sum(case when ${renderLog.at} >= ${since} then 1 else 0 end)`,
            })
            .from(renderLog)
            .where(
              and(
                eq(renderLog.templateId, template.id),
                eq(renderLog.isPreview, false),
                isNotNull(renderLog.consumerId),
              ),
            )
            .groupBy(renderLog.versionId),
          loadConsumerUsage(db, template.id, now),
        ],
      );
      const renders = new Map(renderRows.map((r) => [r.versionId, r]));

      const facts = [...rows]
        .sort((a, b) => compareRounds(b, a))
        .map((v): VersionFacts => {
          const usage = renders.get(v.id);
          return {
            id: v.id,
            number: v.number,
            round: v.round,
            state: v.state,
            head: v.number === null || headOf(rows, v.number) === v,
            createdBy: v.createdBy,
            createdAt: v.createdAt.toISOString(),
            submittedBy: v.submittedBy,
            submittedAt: v.submittedAt?.toISOString() ?? null,
            submitNote: v.submitNote,
            activatedAt: v.activatedAt?.toISOString() ?? null,
            supersededAt: v.supersededAt?.toISOString() ?? null,
            sunsetAt: v.sunsetAt?.toISOString() ?? null,
            sunsetDay: v.sunsetAt ? sunsetDay(v.sunsetAt, zone) : null,
            sunsetPassed: sunsetPassed(v, now),
            revoke: v.revoke,
            contractChanges: v.contractChanges,
            decisions: decisionRows
              .filter((d) => d.versionId === v.id)
              .map((d) => ({
                kind: d.decision,
                stageName: d.stageName,
                by: d.actorId,
                at: d.decidedAt.toISOString(),
                reason: d.reason,
              })),
            lastRenderAt: usage
              ? new Date(Number(usage.lastRenderAt)).toISOString()
              : null,
            renders30d: usage ? Number(usage.renders30d ?? 0) : 0,
            can: versionActions(ctx.viewer, template.teamId, v, now),
          };
        });

      const named = new Set<string>();
      for (const v of facts) {
        named.add(v.createdBy);
        if (v.submittedBy) named.add(v.submittedBy);
        for (const d of v.decisions) named.add(d.by);
        if (v.revoke) {
          named.add(v.revoke.startedBy);
          if (v.revoke.confirmedBy) named.add(v.revoke.confirmedBy);
        }
      }
      const people = named.size
        ? await db
            .select({
              id: users.id,
              name: users.name,
              initials: users.initials,
              hue: users.avatarHue,
            })
            .from(users)
            .where(inArray(users.id, [...named]))
            .orderBy(users.id)
        : [];

      return {
        ok: true,
        asOf: now.toISOString(),
        template,
        versions: facts,
        consumerUsage,
        sunsetCalendar: { zone, today: todayIn(now, zone) },
        people,
      };
    },

    async compare(ctx, { templateId, from, to }) {
      if (!isRequestId(templateId) || !isRequestId(from) || !isRequestId(to))
        return refusal(400, REQUEST_REFUSALS.templateUnavailable);
      const template = await findTemplate(templateId);
      // Not there, and not the viewer's to see, read the same (decision 0052).
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);

      const [rows, family, rules] = await Promise.all([
        db
          .select({
            id: versions.id,
            number: versions.number,
            round: versions.round,
            state: versions.state,
            name: versions.name,
            body: versions.body,
            channels: versions.channels,
            channelFields: versions.channelFields,
            smsFooter: versions.smsFooter,
            variables: versions.variables,
          })
          .from(versions)
          .where(
            and(
              eq(versions.templateId, template.id),
              inArray(versions.id, [from, to]),
            ),
          ),
        loadFamily(db, template.contentTypeId),
        loadMessageRules(db, template.contentTypeId),
      ]);
      const side = (id: string): CompareVersionFacts | undefined => {
        const row = rows.find((r) => r.id === id);
        if (!row) return undefined;
        const draft = row.state === "draft";
        return {
          ...row,
          number: draft ? null : row.number,
          round: draft ? null : row.round,
          smsFooter: smsFooterOf(row, rules.smsFooter),
        };
      };
      const older = side(from);
      const newer = side(to);
      if (!older || !newer)
        return refusal(404, REQUEST_REFUSALS.versionUnavailable);
      return { ok: true, family, from: older, to: newer };
    },

    async baseVersion(ctx, { templateId, versionId }) {
      if (!isRequestId(templateId) || !isRequestId(versionId))
        return refusal(400, REQUEST_REFUSALS.templateUnavailable);
      const template = await findTemplate(templateId);
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const allowed = can(ctx.viewer, "draft.edit", {
        teamId: template.teamId,
      });
      if (!allowed.ok) return refusal(403, allowed);

      const rows = await db
        .select({
          id: versions.id,
          number: versions.number,
          round: versions.round,
          state: versions.state,
          basedOnVersionId: versions.basedOnVersionId,
          name: versions.name,
          body: versions.body,
          variables: versions.variables,
          channels: versions.channels,
          channelFields: versions.channelFields,
          sampleSets: versions.sampleSets,
        })
        .from(versions)
        .where(eq(versions.templateId, template.id));
      // The draft on the client's screen, never another the template has by now (that one was submitted, and
      // someone started a new one).
      const draft = rows.find((v) => v.id === versionId);
      if (!draft) return refusal(404, REQUEST_REFUSALS.noDraftToRevert);
      if (draft.state !== "draft")
        return refusal(409, REQUEST_REFUSALS.noDraftToRevert);
      const base = draft.basedOnVersionId
        ? rows.find((v) => v.id === draft.basedOnVersionId)
        : undefined;
      if (!base || base.number === null || base.round === null)
        return refusal(409, REQUEST_REFUSALS.noBaseVersion);
      return {
        ok: true,
        base: {
          number: base.number,
          round: base.round,
          state: base.state,
          name: base.name,
          body: base.body,
          variables: base.variables,
          channels: base.channels,
          sampleSets: base.sampleSets,
          ...channelFieldValues(base.channelFields),
        },
      };
    },
  };
}
