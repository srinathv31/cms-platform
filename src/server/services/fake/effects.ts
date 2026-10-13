import { noticeAudienceSince } from "@/domain/golive/audience";
import {
  notificationRecipients,
  recipientLink,
  type RecipientFacts,
  type RecipientMembership,
} from "@/domain/recipients";
import type { LifecycleEffect } from "@/domain/review-types";
import type { EffectContext, EffectsWritten } from "@/server/effects";
import { newId } from "@/server/ids";
import { notificationHref } from "@/server/notification-href";
import type { FakeState } from "./state";
import type { FakeTx } from "./store";

// The fake's effects writer: what a transition asks for (audit rows, notifications, consumer notices),
// written into the command's `FakeTx`. Who a notification reaches and where its link opens are the domain's
// rules (domain/recipients.ts), the same ones `writeEffects` (src/server/effects.ts) follows; the consumer
// audience is the domain's window (domain/golive/audience.ts).

const NOTICE_SEQ_KEY = "consumer_notice_seq";

/** Writes a transition's effects into the command's transaction, as `writeEffects` does. */
export function writeFakeEffects(
  tx: FakeTx,
  effects: readonly LifecycleEffect[],
  ctx: EffectContext,
): EffectsWritten {
  const { state } = tx;
  const written: EffectsWritten = {
    audit: 0,
    notifications: 0,
    consumerNotices: 0,
  };
  const createdAt = ctx.writtenAt ?? ctx.at;

  for (const effect of effects) {
    switch (effect.kind) {
      case "audit": {
        tx.insert("auditEvents", {
          id: newId("ae"),
          at: ctx.at,
          actorId: ctx.actorId,
          teamId: ctx.teamId,
          templateId: ctx.templateId,
          // The creation event is about the template; the rest belong to a version.
          versionId:
            effect.action === "template.created"
              ? null
              : (effect.versionId ?? ctx.versionId),
          action: effect.action,
          details: effect.details,
          sessionKey: null,
        });
        written.audit += 1;
        break;
      }

      case "notification": {
        const userIds = notificationRecipients(
          effect.to,
          ctx.teamId,
          membershipsOf(state),
          ctx.actorId,
        );
        if (userIds.length === 0) break;
        const slug = teamSlugOf(state, ctx);
        for (const userId of userIds) {
          const opens = recipientLink(
            recipientFacts(state, userId),
            slug,
            effect.link,
          );
          tx.insert("notifications", {
            id: newId("nt"),
            userId,
            teamId: ctx.teamId,
            kind: effect.notification,
            title: effect.title,
            body: effect.body ?? null,
            href: notificationHref(opens.teamSlug, opens.link),
            createdAt,
            readAt: null,
          });
        }
        written.notifications += userIds.length;
        break;
      }

      case "consumer_notice": {
        const consumerIds = audience(state, ctx);
        if (consumerIds.length === 0) break;
        const name =
          state.versions.find((v) => v.id === effect.versionId)?.name ??
          ctx.templateId;
        const first = takeNoticeSeqs(tx, consumerIds.length);
        consumerIds.forEach((consumerId, i) =>
          tx.insert("consumerNotices", {
            id: newId("cn"),
            seq: first + i,
            consumerId,
            templateId: ctx.templateId,
            versionId: effect.versionId,
            kind: effect.notice,
            payload: { templateName: name, ...effect.payload },
            createdAt,
          }),
        );
        written.consumerNotices += consumerIds.length;
        break;
      }
    }
  }
  return written;
}

/** The template's team's slug: notifications link under it. */
function teamSlugOf(state: FakeState, ctx: EffectContext): string {
  const team = state.teams.find((t) => t.id === ctx.teamId);
  if (!team)
    throw new Error(`Effects for team ${ctx.teamId}, which isn't there.`);
  return team.slug;
}

/** Every membership, with its team and roles, as the recipient rules read them (domain/recipients.ts). */
function membershipsOf(state: FakeState): RecipientMembership[] {
  return state.memberships.flatMap((m) => {
    const team = state.teams.find((t) => t.id === m.teamId);
    if (!team) return [];
    return [
      {
        userId: m.userId,
        teamId: team.id,
        teamSlug: team.slug,
        teamName: team.name,
        status: m.status,
        roles: state.membershipRoles
          .filter((r) => r.membershipId === m.id)
          .map((r) => r.role),
      },
    ];
  });
}

/** One recipient's platform role and memberships: where their links open (`recipientLink`). */
function recipientFacts(state: FakeState, userId: string): RecipientFacts {
  return {
    userId,
    platformRole:
      state.users.find((u) => u.id === userId)?.platformRole ?? null,
    memberships: membershipsOf(state).filter((m) => m.userId === userId),
  };
}

/** Registered consumers with a non-preview render of the template in the notice window before `ctx.at`. */
function audience(state: FakeState, ctx: EffectContext): string[] {
  const since = noticeAudienceSince(ctx.at).getTime();
  const registered = new Set(state.consumers.map((c) => c.id));
  const ids = new Set<string>();
  for (const r of state.renderLog)
    if (
      r.templateId === ctx.templateId &&
      !r.isPreview &&
      r.consumerId !== null &&
      registered.has(r.consumerId) &&
      r.at.getTime() >= since
    )
      ids.add(r.consumerId);
  return [...ids].sort();
}

/** Takes `count` consecutive notice numbers and returns the first, never reusing one (`takeNoticeSeqs`). */
function takeNoticeSeqs(tx: FakeTx, count: number): number {
  const { state } = tx;
  const counter = state.settings.find((s) => s.key === NOTICE_SEQ_KEY);
  const last = Math.max(
    typeof counter?.value === "number" ? counter.value : 0,
    ...state.consumerNotices.map((n) => n.seq),
  );
  if (counter) tx.update("settings", counter, { value: last + count });
  else tx.insert("settings", { key: NOTICE_SEQ_KEY, value: last + count });
  return last + 1;
}
