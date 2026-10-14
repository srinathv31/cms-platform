import { sunsetDay, todayIn } from "@/domain/business-zone";
import { DAY_MS } from "@/domain/dates";
import { smsFooterOf } from "@/domain/lifecycle/submit";
import { sunsetPassed } from "@/domain/lifecycle/sunset";
import { versionActions } from "@/domain/lifecycle/version-actions";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { isRequestId } from "@/domain/request-ids";
import type { ConsumerUsage, Person } from "@/domain/review-types";
import { compareRounds, headOf } from "@/domain/rounds";
import { contentTypeFamily } from "@/domain/types";
import { messageRulesOf } from "./chain";
import { notInFake } from "./not-in-fake";
import { refusal } from "../results";
import type {
  CompareVersionFacts,
  VersionFacts,
  VersionService,
} from "../versions";
import { businessZone } from "./settings";
import { currentName, templateById } from "./version-rows";
import type { FakeState } from "./state";
import type { FakeDeps } from "./index";

// One template's versions in memory: what services/local/versions.ts reads with SQL, read from the fake's
// arrays, with the same domain decisions. The history, and Compare (a version's name and content: how a contract
// case reads what a command stored); not the base version, which no case needs (decision 0072: a read in the
// fake only where a contract case observes a command through it).

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

    // Compare is how a contract case reads what a command stored in any version (its name and its content).
    async compare(ctx, { templateId, from, to }) {
      if (!isRequestId(templateId) || !isRequestId(from) || !isRequestId(to))
        return refusal(400, REQUEST_REFUSALS.templateUnavailable);
      const { state } = store;
      const template = templateById(state, templateId);
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const contentType = state.contentTypes.find(
        (c) => c.id === template.contentTypeId,
      );
      const rules = messageRulesOf(state, template.contentTypeId);
      const side = (id: string): CompareVersionFacts | undefined => {
        const row = state.versions.find(
          (v) => v.id === id && v.templateId === template.id,
        );
        if (!row) return undefined;
        const draft = row.state === "draft";
        return structuredClone({
          id: row.id,
          number: draft ? null : row.number,
          round: draft ? null : row.round,
          state: row.state,
          name: row.name,
          body: row.body,
          channels: row.channels,
          channelFields: row.channelFields,
          smsFooter: smsFooterOf(row, rules.smsFooter),
          variables: row.variables,
        });
      };
      const older = side(from);
      const newer = side(to);
      if (!older || !newer)
        return refusal(404, REQUEST_REFUSALS.versionUnavailable);
      return {
        ok: true,
        family: contentTypeFamily(contentType?.allowedChannels ?? []),
        from: older,
        to: newer,
      };
    },
    baseVersion: notInFake("versions.baseVersion"),
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
