import { sunsetDay, todayIn } from "@/domain/business-zone";
import { DAY_MS } from "@/domain/dates";
import { sunsetPassed } from "@/domain/lifecycle/sunset";
import { versionActions } from "@/domain/lifecycle/version-actions";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ConsumerUsage, Person } from "@/domain/review-types";
import { compareRounds, headOf } from "@/domain/rounds";
import { notMoved } from "../not-moved";
import { refusal } from "../results";
import type { VersionFacts, VersionService } from "../versions";
import { businessZone } from "./settings";
import { currentName, templateById } from "./version-rows";
import type { FakeState } from "./state";
import type { FakeDeps } from "./index";

// One template's versions in memory: what services/local/versions.ts reads with SQL, read from the fake's
// arrays, with the same domain decisions. Compare and the base version aren't here: the fake serves a read only
// where a contract case observes a command through it (decision 0072).

export function fakeVersions({ store, clock }: FakeDeps): VersionService {
  return {
    async history(ctx, { templateId }) {
      const now = await clock();
      const { state } = store;
      const template = templateById(state, templateId);
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const team = state.teams.find((t) => t.id === template.teamId)!;

      const since = now.getTime() - 30 * DAY_MS;
      const zone = businessZone(state);
      const rows = state.versions.filter((v) => v.templateId === template.id);
      const counted = state.renderLog.filter(
        (r) =>
          r.templateId === template.id && !r.isPreview && r.consumerId !== null,
      );

      const facts = [...rows]
        .sort((a, b) => compareRounds(b, a))
        .map((v): VersionFacts => {
          const renders = counted.filter((r) => r.versionId === v.id);
          const last = Math.max(...renders.map((r) => r.at.getTime()));
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
            decisions: state.approvals
              .filter((d) => d.versionId === v.id)
              .sort(
                (a, b) =>
                  a.decidedAt.getTime() - b.decidedAt.getTime() ||
                  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
              )
              .map((d) => ({
                kind: d.decision,
                stageName: d.stageName,
                by: d.actorId,
                at: d.decidedAt.toISOString(),
                reason: d.reason,
              })),
            lastRenderAt: renders.length ? new Date(last).toISOString() : null,
            renders30d: renders.filter((r) => r.at.getTime() >= since).length,
            can: versionActions(ctx.viewer, template.teamId, v, now),
          };
        });

      return {
        ok: true,
        asOf: now.toISOString(),
        template: {
          id: template.id,
          teamId: template.teamId,
          teamSlug: team.slug,
          name: currentName(state, template.id),
        },
        versions: facts,
        consumerUsage: consumerUsage(state, template.id, now),
        sunsetCalendar: { zone, today: todayIn(now, zone) },
        people: peopleNamed(state, facts),
      };
    },

    compare: notMoved("versions.compare"),
    baseVersion: notMoved("versions.baseVersion"),
  };
}

/**
 * Per consumer and version number (`loadConsumerUsage`): the last render and the renders in the last 30
 * days. Registered consumers only, previews excluded, failed renders included. Newest number first, then by
 * consumer name.
 */
function consumerUsage(
  state: FakeState,
  templateId: string,
  now: Date,
): ConsumerUsage[] {
  const since = now.getTime() - 30 * DAY_MS;
  const usage = new Map<string, ConsumerUsage & { last: number }>();
  for (const r of state.renderLog) {
    if (
      r.templateId !== templateId ||
      r.isPreview ||
      r.versionNumber === null ||
      r.consumerId === null
    )
      continue;
    const consumer = state.consumers.find((c) => c.id === r.consumerId);
    if (!consumer) continue;
    const key = `${consumer.id}\u0000${r.versionNumber}`;
    const row = usage.get(key) ?? {
      consumerId: consumer.id,
      consumerName: consumer.name,
      versionNumber: r.versionNumber,
      lastRenderAt: "",
      renders30d: 0,
      last: -Infinity,
    };
    row.last = Math.max(row.last, r.at.getTime());
    if (r.at.getTime() >= since) row.renders30d += 1;
    usage.set(key, row);
  }
  return [...usage.values()]
    .map(({ last, ...row }) => ({
      ...row,
      lastRenderAt: new Date(last).toISOString(),
    }))
    .sort(
      (a, b) =>
        b.versionNumber - a.versionNumber ||
        a.consumerName.localeCompare(b.consumerName),
    );
}

/** Everyone the facts name by id, as `Person`s, by id. */
function peopleNamed(state: FakeState, facts: VersionFacts[]): Person[] {
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
  return state.users
    .filter((u) => named.has(u.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((u) => ({
      id: u.id,
      name: u.name,
      initials: u.initials,
      hue: u.avatarHue,
    }));
}
