import { DEFAULT_BUSINESS_ZONE, sunsetInstant, todayIn } from "@/domain/business-zone";
import { ALL_CHANNEL_FIELDS, channelFieldValue } from "@/domain/channel-fields";
import type { SeedCtx, TemplateRef, VersionRef } from "../context";
import {
  REQUIRED_SECTIONS,
  blockId,
  blockText,
  topLevelIds,
  variableKeys,
} from "../content";
import { CONTENT_TYPE_ID, TEAM_STAGE } from "../platform";
import { int } from "../rng";
import { userName } from "../people";
import type { SeedTemplate, SeedVersion } from "./types";

const STAGE_NAME = TEAM_STAGE.name;

/**
 * A seeded sunset `inDays` days from the seed's base, as the picker sets one: that day in the business
 * time zone (the default, Eastern), ending at 00:00 there.
 */
function seededSunset(ctx: SeedCtx, inDays: number) {
  const day = todayIn(ctx.at(-inDays), DEFAULT_BUSINESS_ZONE);
  return { day, at: sunsetInstant(day, DEFAULT_BUSINESS_ZONE) };
}

/** Fails the reset early if a seeded body breaks the contract (cheaper than finding it in the UI). */
function check(spec: SeedTemplate, v: SeedVersion) {
  const where = `${spec.key}/${v.ref}`;

  const ids = topLevelIds(v.body);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error(`Seed: ${where} has a top-level block without a unique id`);
  }

  const declared = new Set(v.variables.map((x) => x.key));
  const used = variableKeys(v.body);
  for (const field of ALL_CHANNEL_FIELDS) variableKeys(channelFieldValue(v.channelFields ?? {}, field), used);
  for (const key of used) {
    if (!declared.has(key)) throw new Error(`Seed: ${where} uses undeclared variable "${key}"`);
  }

  const required = (v.body.content ?? [])
    .filter((b) => b.type === "heading" && b.attrs?.requiredKey)
    .map((b) => b.attrs?.requiredKey);
  if (required.join() !== REQUIRED_SECTIONS.map((s) => s.key).join()) {
    throw new Error(`Seed: ${where} required sections are missing or out of order`);
  }

  if ((v.state === "draft") !== (v.number === null)) {
    throw new Error(`Seed: ${where} number and state disagree`);
  }
  if (v.state === "draft" && v.updatedAt === undefined) {
    throw new Error(`Seed: ${where} is a draft and needs updatedAt`);
  }
  const stray = ALL_CHANNEL_FIELDS.find((field) => !v.channels.includes(field.channel) && channelFieldValue(v.channelFields ?? {}, field));
  if (stray) {
    throw new Error(`Seed: ${where} has a ${stray.name} but no ${stray.channel} channel`);
  }
}

/** The most recent moment (smallest "days ago") anything happened to a version. */
function lastTouched(v: SeedVersion): number {
  if (v.updatedAt !== undefined) return v.updatedAt;
  const times = [
    v.createdAt,
    v.submittedAt,
    v.activatedAt,
    v.supersededAt,
    v.sunset?.setAt,
    v.revoke?.confirmedAt,
    ...(v.approvals ?? []).map((a) => a.at),
  ].filter((t): t is number => t !== undefined);
  return Math.min(...times);
}

export function buildTemplate(ctx: SeedCtx, spec: SeedTemplate): TemplateRef {
  const { sink } = ctx;
  const templateId = ctx.templateId();

  const ref: TemplateRef = {
    id: templateId,
    key: spec.key,
    name: spec.name,
    teamId: spec.teamId,
    versions: {},
  };
  for (const v of spec.versions) {
    ref.versions[v.ref] = {
      id: ctx.id("v"),
      number: v.number,
      state: v.state,
      channels: v.channels,
      variables: v.variables,
      submittedDaysAgo: v.submittedAt,
    } satisfies VersionRef;
  }
  ctx.templates.set(spec.key, ref);

  const versionOf = (r: string) => {
    const found = ref.versions[r];
    if (!found) throw new Error(`Seed: ${spec.key} has no version "${r}"`);
    return found;
  };
  const specOf = (r: string) => spec.versions.find((v) => v.ref === r)!;

  // Who wrote each version (maker-checker), as the app records it: the creator (who also makes every
  // seeded edit), the submitter, and for the draft a change request opened, the returned version's writers.
  const writersOf = (v: SeedVersion): string[] => {
    const base = v.basedOn ? specOf(v.basedOn) : undefined;
    const inherited = base?.state === "changes_requested" ? writersOf(base) : [];
    return [...new Set([...inherited, v.createdBy, ...(v.submittedBy ? [v.submittedBy] : [])])];
  };

  const audit = (e: {
    at: number;
    actor: string | null;
    action: string;
    version?: VersionRef;
    details?: Record<string, unknown>;
    sessionKey?: string;
  }) => {
    sink.auditEvents.push({
      id: ctx.id("ae"),
      at: ctx.at(e.at),
      actorId: e.actor,
      teamId: spec.teamId,
      templateId,
      versionId: e.version?.id ?? null,
      action: e.action,
      details: e.details ?? null,
      sessionKey: e.sessionKey ?? null,
    });
  };

  sink.templates.push({
    id: templateId,
    teamId: spec.teamId,
    contentTypeId: CONTENT_TYPE_ID,
    createdBy: spec.createdBy,
    createdAt: ctx.at(spec.createdAt),
    starterKey: spec.starterKey ?? null,
  });
  audit({
    at: spec.createdAt,
    actor: spec.createdBy,
    action: "template.created",
    details: { name: spec.name, source: spec.starterKey ? `starter:${spec.starterKey}` : "blank" },
  });

  for (const v of spec.versions) {
    check(spec, v);
    const info = versionOf(v.ref);
    const isDraft = v.state === "draft";

    sink.versions.push({
      id: info.id,
      templateId,
      number: v.number,
      state: v.state,
      // The name is a version field; no seeded template has been renamed, so every version has its name.
      name: spec.name,
      basedOnVersionId: v.basedOn ? versionOf(v.basedOn).id : null,
      body: v.body,
      channelFields: v.channelFields ?? {},
      channels: v.channels,
      variables: v.variables,
      sampleSets: ctx.vars.sampleSets(v.variables),
      contractChanges: v.contractChanges ?? null,
      // Every submitted version went through the one-stage chain the seed configures.
      stages: isDraft ? null : [{ id: TEAM_STAGE.id, name: TEAM_STAGE.name }],
      currentStage: 0,
      rev: v.rev ?? (isDraft ? int(ctx.rng, 12, 40) : int(ctx.rng, 40, 190)),
      createdBy: v.createdBy,
      writers: writersOf(v),
      createdAt: ctx.at(v.createdAt),
      updatedAt: ctx.at(lastTouched(v)),
      submittedBy: v.submittedBy ?? null,
      submittedAt: v.submittedAt !== undefined ? ctx.at(v.submittedAt) : null,
      submitNote: v.submitNote ?? null,
      activatedAt: v.activatedAt !== undefined ? ctx.at(v.activatedAt) : null,
      supersededAt: v.supersededAt !== undefined ? ctx.at(v.supersededAt) : null,
      sunsetAt: v.sunset ? seededSunset(ctx, v.sunset.inDays).at : null,
      sunsetSetBy: v.sunset?.setBy ?? null,
      revoke: v.revoke
        ? {
            reason: v.revoke.reason,
            startedBy: v.revoke.startedBy,
            startedAt: ctx.at(v.revoke.startedAt).toISOString(),
            confirmedBy: v.revoke.confirmedBy,
            confirmedAt: ctx.at(v.revoke.confirmedAt).toISOString(),
          }
        : null,
      importUploadId: null,
    });

    // Draft saves: one audit row per editing session, never a version number.
    const sessions = v.editSessions ?? (isDraft ? 3 : 2);
    const editsEnd = v.submittedAt ?? v.updatedAt ?? 0.3;
    for (let i = 0; i < sessions; i++) {
      const at = v.createdAt - ((v.createdAt - editsEnd) * (i + 1)) / (sessions + 1);
      audit({
        at,
        actor: v.createdBy,
        action: "draft.edited",
        version: info,
        details: {
          saves: int(ctx.rng, 3, 28),
          ...(v.basedOn ? { basedOn: versionOf(v.basedOn).number } : {}),
        },
        sessionKey: ctx.id("sess"),
      });
    }

    if (v.submittedAt !== undefined && v.submittedBy) {
      const changes = v.contractChanges ?? [];
      audit({
        at: v.submittedAt,
        actor: v.submittedBy,
        action: "version.submitted",
        version: info,
        details: {
          number: v.number,
          note: v.submitNote ?? null,
          contractChanges: changes.length,
          breaking: changes.some((c) => c.breaking),
        },
      });
    }

    for (const a of v.approvals ?? []) {
      sink.approvals.push({
        id: ctx.id("ap"),
        versionId: info.id,
        stageId: TEAM_STAGE.id,
        stagePosition: 0,
        stageName: STAGE_NAME,
        actorId: a.actor,
        decision: a.decision,
        reason: a.reason ?? null,
        sampleSetsSeen: a.seen ?? ["typical", "long"],
        decidedAt: ctx.at(a.at),
      });
      audit({
        at: a.at,
        actor: a.actor,
        action: a.decision === "approved" ? "version.approved" : "version.changes_requested",
        version: info,
        details: {
          number: v.number,
          stage: STAGE_NAME,
          ...(a.reason ? { reason: a.reason } : {}),
        },
      });
    }

    if (v.activatedAt !== undefined) {
      const replaced = v.supersedes ? versionOf(v.supersedes).number : null;
      audit({
        at: v.activatedAt,
        actor: null,
        action: "version.activated",
        version: info,
        details: { number: v.number, supersedes: replaced },
      });
      if (replaced !== null) {
        for (const consumerId of spec.consumers ?? []) {
          sink.consumerNotices.push({
            id: ctx.id("cn"),
            consumerId,
            templateId,
            versionId: info.id,
            kind: "new_version",
            payload: {
              templateName: spec.name,
              versionNumber: v.number,
              previousVersionNumber: replaced,
              contractChanges: v.contractChanges ?? [],
            },
            createdAt: ctx.at(v.activatedAt),
          });
        }
      }
    }

    if (v.sunset) {
      const successor = spec.versions.find((s) => s.supersedes === v.ref);
      const sunset = seededSunset(ctx, v.sunset.inDays);
      const sunsetAt = sunset.at.toISOString();
      audit({
        at: v.sunset.setAt,
        actor: v.sunset.setBy,
        action: "version.sunset_set",
        version: info,
        details: { number: v.number, sunsetAt, sunsetDay: sunset.day, zone: DEFAULT_BUSINESS_ZONE },
      });
      for (const consumerId of spec.consumers ?? []) {
        sink.consumerNotices.push({
          id: ctx.id("cn"),
          consumerId,
          templateId,
          versionId: info.id,
          kind: "sunset_scheduled",
          payload: {
            templateName: spec.name,
            versionNumber: v.number,
            sunsetAt,
            sunsetDay: sunset.day,
            zone: DEFAULT_BUSINESS_ZONE,
            replacedByVersionNumber: successor?.number ?? null,
            contractChanges: successor?.contractChanges ?? [],
          },
          createdAt: ctx.at(v.sunset.setAt),
        });
      }
    }

    if (v.revoke) {
      audit({
        at: v.revoke.startedAt,
        actor: v.revoke.startedBy,
        action: "version.revoke_started",
        version: info,
        details: { number: v.number, reason: v.revoke.reason },
      });
      audit({
        at: v.revoke.confirmedAt,
        actor: v.revoke.confirmedBy,
        action: "version.revoke_confirmed",
        version: info,
        details: { number: v.number, reason: v.revoke.reason, startedBy: v.revoke.startedBy },
      });
      for (const consumerId of spec.consumers ?? []) {
        sink.consumerNotices.push({
          id: ctx.id("cn"),
          consumerId,
          templateId,
          versionId: info.id,
          kind: "revoked",
          payload: {
            templateName: spec.name,
            versionNumber: v.number,
            reason: v.revoke.reason,
          },
          createdAt: ctx.at(v.revoke.confirmedAt),
        });
      }
    }
  }

  for (const thread of spec.threads ?? []) {
    const origin = versionOf(thread.origin);
    const originSpec = specOf(thread.origin);
    const id = blockId(spec.key, thread.block);

    // The anchor must exist in the origin version and in every draft that carries it forward.
    const carriers = [originSpec, ...spec.versions.filter((s) => s.basedOn === thread.origin)];
    for (const c of carriers) {
      const block = (c.body.content ?? []).find((b) => b.attrs?.id === id);
      if (!block) {
        throw new Error(`Seed: ${spec.key}/${c.ref} has no block "${thread.block}" for a comment thread`);
      }
    }
    const anchored = (originSpec.body.content ?? []).find((b) => b.attrs?.id === id);

    const threadId = ctx.id("th");
    const first = thread.comments[0];
    sink.commentThreads.push({
      id: threadId,
      templateId,
      originVersionId: origin.id,
      blockId: id,
      quote: thread.quote ?? blockText(anchored),
      status: thread.resolved ? "resolved" : "open",
      resolvedBy: thread.resolved?.by ?? null,
      resolvedAt: thread.resolved ? ctx.at(thread.resolved.at) : null,
      createdAt: ctx.at(first.at),
    });
    for (const c of thread.comments) {
      sink.comments.push({
        id: ctx.id("cm"),
        threadId,
        authorId: c.author,
        body: c.body,
        kind: c.kind ?? "comment",
        createdAt: ctx.at(c.at),
      });
      if ((c.kind ?? "comment") === "comment") {
        audit({
          at: c.at,
          actor: c.author,
          action: "comment.added",
          version: origin,
          details: { threadId, blockId: id, author: userName(c.author) },
        });
      }
    }
    if (thread.resolved) {
      audit({
        at: thread.resolved.at,
        actor: thread.resolved.by,
        action: "comment.resolved",
        version: origin,
        details: { threadId, blockId: id },
      });
    }
  }

  return ref;
}
