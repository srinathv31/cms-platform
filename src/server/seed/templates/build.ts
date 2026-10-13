// Turns a declarative `SeedTemplate` into rows. One template at a time, `buildTemplate` puts the template
// row in the sink and then, for each version in the spec, calls the emit functions below in the order the
// events happened: `emitVersion` (the row, its draft saves, its submit), `emitApprovals` (each decision),
// `emitLifecycleNotices` (going Active, a sunset, a revoke: the audit event and the consumers' notices).
// After the versions, `emitThreads` writes the comment threads. Everything comes from the one spec, so
// the rows cannot disagree.

import {
  DEFAULT_BUSINESS_ZONE,
  sunsetInstant,
  todayIn,
} from "@/domain/business-zone";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { SeedCtx, TemplateRef, VersionRef } from "../context";
import { blockId, blockText } from "../content";
import { SEED_CONTENT_TYPES } from "../platform";
import { int } from "../rng";
import { userName } from "../people";
import {
  checkRounds,
  checkSendBacks,
  checkVersion,
  roundOf,
  type SeedType,
} from "./checks";
import type { SeedTemplate, SeedVersion } from "./types";

/** An audit event as the spec describes it: `at` is days before the reset. */
interface AuditSpec {
  at: number;
  actor: string | null;
  action: string;
  version?: VersionRef;
  details?: Record<string, unknown>;
  sessionKey?: string;
}

/** What the emit functions share while one template's rows are built. */
interface TemplateBuild {
  ctx: SeedCtx;
  spec: SeedTemplate;
  type: SeedType;
  /** The template as other seed modules see it: its id, and each version's id and number. */
  ref: TemplateRef;
  /** The built version a spec ref names ("v2"). */
  versionRef(ref: string): VersionRef;
  /** The spec's version a ref names. */
  versionSpec(ref: string): SeedVersion;
  /** Writes an audit event for this template. `newId` makes its id (the shared sequence unless a thread says otherwise). */
  audit(event: AuditSpec, newId?: (prefix: string) => string): void;
}

/**
 * A seeded sunset `inDays` days from the seed's base, as the picker sets one: that day in the business
 * time zone (the default, Eastern), ending at 00:00 there.
 */
function seededSunset(ctx: SeedCtx, inDays: number) {
  const day = todayIn(ctx.at(-inDays), DEFAULT_BUSINESS_ZONE);
  return { day, at: sunsetInstant(day, DEFAULT_BUSINESS_ZONE) };
}

/** The most recent moment (smallest "days ago") anything happened to a version. */
function lastTouched(version: SeedVersion): number {
  if (version.updatedAt !== undefined) return version.updatedAt;
  const times = [
    version.createdAt,
    version.submittedAt,
    version.activatedAt,
    version.supersededAt,
    version.sunset?.setAt,
    version.revoke?.confirmedAt,
    ...(version.approvals ?? []).map((approval) => approval.at),
  ].filter((time): time is number => time !== undefined);
  return Math.min(...times);
}

/**
 * Who wrote each version (maker-checker), as the app records it: the creator (who also makes every seeded
 * edit), the submitter, and for a draft opened from a change request, the returned version's writers too.
 */
function writersOf(spec: SeedTemplate, version: SeedVersion): string[] {
  const basedOn = version.basedOn
    ? spec.versions.find((v) => v.ref === version.basedOn)
    : undefined;
  const inherited =
    basedOn?.state === "changes_requested" ? writersOf(spec, basedOn) : [];
  return [
    ...new Set([
      ...inherited,
      version.createdBy,
      ...(version.submittedBy ? [version.submittedBy] : []),
    ]),
  ];
}

export function buildTemplate(ctx: SeedCtx, spec: SeedTemplate): TemplateRef {
  const type: SeedType = SEED_CONTENT_TYPES[spec.contentType ?? "disclosure"];
  const templateId = ctx.templateId();

  const ref: TemplateRef = {
    id: templateId,
    key: spec.key,
    name: spec.name,
    teamId: spec.teamId,
    versions: {},
  };
  checkRounds(spec);
  checkSendBacks(spec);
  for (const version of spec.versions) {
    ref.versions[version.ref] = {
      id: ctx.id("v"),
      number: version.number,
      round: roundOf(version),
      state: version.state,
      channels: version.channels,
      variables: version.variables,
      submittedDaysAgo: version.submittedAt,
    } satisfies VersionRef;
  }
  ctx.templates.set(spec.key, ref);

  const build: TemplateBuild = {
    ctx,
    spec,
    type,
    ref,
    versionRef(versionKey) {
      const found = ref.versions[versionKey];
      if (!found)
        throw new Error(`Seed: ${spec.key} has no version "${versionKey}"`);
      return found;
    },
    versionSpec: (versionKey) =>
      spec.versions.find((v) => v.ref === versionKey)!,
    audit(event, newId = ctx.id) {
      ctx.sink.auditEvents.push({
        id: newId("ae"),
        at: ctx.at(event.at),
        actorId: event.actor,
        teamId: spec.teamId,
        templateId,
        versionId: event.version?.id ?? null,
        action: event.action,
        details: event.details ?? null,
        sessionKey: event.sessionKey ?? null,
      });
    },
  };

  ctx.sink.templates.push({
    id: templateId,
    teamId: spec.teamId,
    contentTypeId: type.id,
    createdBy: spec.createdBy,
    createdAt: ctx.at(spec.createdAt),
    starterKey: spec.starterKey ?? null,
  });
  build.audit({
    at: spec.createdAt,
    actor: spec.createdBy,
    action: "template.created",
    details: {
      name: spec.name,
      source: spec.starterKey ? `starter:${spec.starterKey}` : "blank",
    },
  });

  for (const version of spec.versions) {
    checkVersion(spec, version, type);
    emitVersion(build, version);
    emitApprovals(build, version);
    emitLifecycleNotices(build, version);
  }
  emitThreads(build);

  return ref;
}

/** The version row, one `draft.edited` event per editing session, and `version.submitted`. */
function emitVersion(build: TemplateBuild, version: SeedVersion) {
  const { ctx, spec, type } = build;
  const built = build.versionRef(version.ref);
  const isDraft = version.state === "draft";
  const stage = type.stage;

  ctx.sink.versions.push({
    id: built.id,
    templateId: build.ref.id,
    number: version.number,
    round: built.round,
    state: version.state,
    // The name is a version field; no seeded template has been renamed, so every version has its name.
    name: spec.name,
    basedOnVersionId: version.basedOn
      ? build.versionRef(version.basedOn).id
      : null,
    body: version.body,
    channelFields: version.channelFields ?? {},
    channels: version.channels,
    // Submit freezes the content type's SMS footer into the version; a draft shows the content type's as it stands.
    smsFooter: isDraft ? null : type.smsFooter,
    variables: version.variables,
    sampleSets: ctx.vars.sampleSets(version.variables),
    contractChanges: version.contractChanges ?? null,
    // Every submitted version went through the one-stage chain the seed configures for its content type.
    stages: isDraft ? null : [{ id: stage.id, name: stage.name }],
    currentStage: 0,
    rev:
      version.rev ?? (isDraft ? int(ctx.rng, 12, 40) : int(ctx.rng, 40, 190)),
    createdBy: version.createdBy,
    writers: writersOf(spec, version),
    createdAt: ctx.at(version.createdAt),
    updatedAt: ctx.at(lastTouched(version)),
    submittedBy: version.submittedBy ?? null,
    submittedAt:
      version.submittedAt !== undefined ? ctx.at(version.submittedAt) : null,
    submitNote: version.submitNote ?? null,
    activatedAt:
      version.activatedAt !== undefined ? ctx.at(version.activatedAt) : null,
    supersededAt:
      version.supersededAt !== undefined ? ctx.at(version.supersededAt) : null,
    sunsetAt: version.sunset
      ? seededSunset(ctx, version.sunset.inDays).at
      : null,
    sunsetSetBy: version.sunset?.setBy ?? null,
    revoke: version.revoke
      ? {
          reason: version.revoke.reason,
          startedBy: version.revoke.startedBy,
          startedAt: ctx.at(version.revoke.startedAt).toISOString(),
          confirmedBy: version.revoke.confirmedBy,
          confirmedAt: ctx.at(version.revoke.confirmedAt).toISOString(),
        }
      : null,
    importUploadId: null,
  });

  // Draft saves: one audit row per editing session, never a version number.
  const sessions = version.editSessions ?? (isDraft ? 3 : 2);
  const editsEnd = version.submittedAt ?? version.updatedAt ?? 0.3;
  for (let session = 0; session < sessions; session++) {
    const at =
      version.createdAt -
      ((version.createdAt - editsEnd) * (session + 1)) / (sessions + 1);
    build.audit({
      at,
      actor: version.createdBy,
      action: "draft.edited",
      version: built,
      details: {
        saves: int(ctx.rng, 3, 28),
        ...(version.basedOn
          ? { basedOn: build.versionRef(version.basedOn).number }
          : {}),
      },
      sessionKey: ctx.id("sess"),
    });
  }

  if (version.submittedAt !== undefined && version.submittedBy) {
    const changes = version.contractChanges ?? [];
    build.audit({
      at: version.submittedAt,
      actor: version.submittedBy,
      action: "version.submitted",
      version: built,
      details: {
        number: version.number,
        round: built.round,
        note: version.submitNote ?? null,
        contractChanges: changes.length,
        breaking: changes.some((change) => change.breaking),
      },
    });
  }
}

/** One approval row and one audit event for each decision on the version. */
function emitApprovals(build: TemplateBuild, version: SeedVersion) {
  const { ctx } = build;
  const built = build.versionRef(version.ref);
  const stage = build.type.stage;

  for (const approval of version.approvals ?? []) {
    ctx.sink.approvals.push({
      id: ctx.id("ap"),
      versionId: built.id,
      stageId: stage.id,
      stagePosition: 0,
      stageName: stage.name,
      actorId: approval.actor,
      decision: approval.decision,
      reason: approval.reason ?? null,
      sampleSetsSeen: approval.seen ?? ["typical", "long"],
      decidedAt: ctx.at(approval.at),
    });
    build.audit({
      at: approval.at,
      actor: approval.actor,
      action:
        approval.decision === "approved"
          ? "version.approved"
          : "version.changes_requested",
      version: built,
      details: {
        number: version.number,
        round: built.round,
        stage: stage.name,
        ...(approval.reason ? { reason: approval.reason } : {}),
      },
    });
  }
}

/**
 * What going Active, a sunset and a revoke each leave behind: an audit event, and a notice to every
 * consumer of the template.
 */
function emitLifecycleNotices(build: TemplateBuild, version: SeedVersion) {
  const { ctx, spec } = build;
  const built = build.versionRef(version.ref);
  const consumers = spec.consumers ?? [];

  if (version.activatedAt !== undefined) {
    const replaced = version.supersedes
      ? build.versionRef(version.supersedes).number
      : null;
    build.audit({
      at: version.activatedAt,
      actor: null,
      action: "version.activated",
      version: built,
      details: {
        number: version.number,
        round: built.round,
        supersedes: replaced,
      },
    });
    // The first version has nothing to replace, so nobody has anything to move off.
    if (replaced !== null) {
      for (const consumerId of consumers) {
        ctx.sink.consumerNotices.push({
          id: ctx.id("cn"),
          consumerId,
          templateId: build.ref.id,
          versionId: built.id,
          kind: "new_version",
          payload: {
            templateName: spec.name,
            versionNumber: version.number,
            previousVersionNumber: replaced,
            contractChanges: version.contractChanges ?? [],
          },
          createdAt: ctx.at(version.activatedAt),
        });
      }
    }
  }

  if (version.sunset) {
    const successor = spec.versions.find((v) => v.supersedes === version.ref);
    const sunset = seededSunset(ctx, version.sunset.inDays);
    const sunsetAt = sunset.at.toISOString();
    build.audit({
      at: version.sunset.setAt,
      actor: version.sunset.setBy,
      action: "version.sunset_set",
      version: built,
      details: {
        number: version.number,
        sunsetAt,
        sunsetDay: sunset.day,
        zone: DEFAULT_BUSINESS_ZONE,
      },
    });
    for (const consumerId of consumers) {
      ctx.sink.consumerNotices.push({
        id: ctx.id("cn"),
        consumerId,
        templateId: build.ref.id,
        versionId: built.id,
        kind: "sunset_scheduled",
        payload: {
          templateName: spec.name,
          versionNumber: version.number,
          sunsetAt,
          sunsetDay: sunset.day,
          zone: DEFAULT_BUSINESS_ZONE,
          replacedByVersionNumber: successor?.number ?? null,
          contractChanges: successor?.contractChanges ?? [],
        },
        createdAt: ctx.at(version.sunset.setAt),
      });
    }
  }

  if (version.revoke) {
    build.audit({
      at: version.revoke.startedAt,
      actor: version.revoke.startedBy,
      action: "version.revoke_started",
      version: built,
      details: { number: version.number, reason: version.revoke.reason },
    });
    build.audit({
      at: version.revoke.confirmedAt,
      actor: version.revoke.confirmedBy,
      action: "version.revoke_confirmed",
      version: built,
      details: {
        number: version.number,
        reason: version.revoke.reason,
        startedBy: version.revoke.startedBy,
      },
    });
    for (const consumerId of consumers) {
      ctx.sink.consumerNotices.push({
        id: ctx.id("cn"),
        consumerId,
        templateId: build.ref.id,
        versionId: built.id,
        kind: "revoked",
        payload: {
          templateName: spec.name,
          versionNumber: version.number,
          reason: version.revoke.reason,
        },
        createdAt: ctx.at(version.revoke.confirmedAt),
      });
    }
  }
}

/** Each comment thread, its comments, and their audit events (a comment added, the thread resolved). */
function emitThreads(build: TemplateBuild) {
  const { ctx, spec } = build;

  for (const thread of spec.threads ?? []) {
    const origin = build.versionRef(thread.origin);
    const originSpec = build.versionSpec(thread.origin);
    // A thread about the whole version has no block to anchor to.
    const whole = thread.block === DOCUMENT_THREAD;
    const blockKey = whole ? DOCUMENT_THREAD : blockId(spec.key, thread.block);

    // The anchor must exist in the origin version and in every draft that carries it forward.
    const carriers = whole
      ? []
      : [
          originSpec,
          ...spec.versions.filter((v) => v.basedOn === thread.origin),
        ];
    for (const carrier of carriers) {
      const block = (carrier.body.content ?? []).find(
        (b) => b.attrs?.id === blockKey,
      );
      if (!block) {
        throw new Error(
          `Seed: ${spec.key}/${carrier.ref} has no block "${thread.block}" for a comment thread`,
        );
      }
    }
    const anchored = (originSpec.body.content ?? []).find(
      (b) => b.attrs?.id === blockKey,
    );
    const newId = thread.keyedIds
      ? (prefix: string) =>
          ctx.keyedId(`${spec.key}:${thread.origin}:${blockKey}`, prefix)
      : ctx.id;

    const threadId = newId("th");
    const first = thread.comments[0];
    ctx.sink.commentThreads.push({
      id: threadId,
      templateId: build.ref.id,
      originVersionId: origin.id,
      blockId: blockKey,
      quote: thread.quote ?? (whole ? null : blockText(anchored)),
      status: thread.resolved ? "resolved" : "open",
      resolvedBy: thread.resolved?.by ?? null,
      resolvedAt: thread.resolved ? ctx.at(thread.resolved.at) : null,
      createdAt: ctx.at(first.at),
    });
    for (const comment of thread.comments) {
      ctx.sink.comments.push({
        id: newId("cm"),
        threadId,
        authorId: comment.author,
        body: comment.body,
        kind: comment.kind ?? "comment",
        createdAt: ctx.at(comment.at),
      });
      if ((comment.kind ?? "comment") === "comment") {
        build.audit(
          {
            at: comment.at,
            actor: comment.author,
            action: "comment.added",
            version: origin,
            details: {
              threadId,
              blockId: blockKey,
              author: userName(comment.author),
            },
          },
          newId,
        );
      }
    }
    if (thread.resolved && whole) {
      // Answered by submitting the next round, as `submitVersion` resolves it: the round that answered it.
      const answer = spec.versions.find(
        (v) => v.basedOn === thread.origin && v.number !== null,
      );
      if (!answer)
        throw new Error(
          `Seed: ${spec.key}/${thread.origin} has a resolved change request but no next round`,
        );
      if (
        thread.resolved.by !== answer.submittedBy ||
        thread.resolved.at !== answer.submittedAt
      ) {
        throw new Error(
          `Seed: ${spec.key}/${thread.origin}'s change request is resolved by ${answer.ref}'s submit, so by its submitter then`,
        );
      }
      const next = build.versionRef(answer.ref);
      build.audit(
        {
          at: thread.resolved.at,
          actor: thread.resolved.by,
          action: "thread.resolved",
          version: origin,
          details: {
            threadId,
            blockId: blockKey,
            auto: true,
            resolvedWith: next.number,
            resolvedWithRound: next.round,
          },
        },
        newId,
      );
    } else if (thread.resolved) {
      build.audit(
        {
          at: thread.resolved.at,
          actor: thread.resolved.by,
          action: "comment.resolved",
          version: origin,
          details: { threadId, blockId: blockKey },
        },
        newId,
      );
    }
  }
}
