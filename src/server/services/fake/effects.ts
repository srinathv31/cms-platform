import { noticeAudienceSince } from "@/domain/golive/audience";
import type {
  LifecycleEffect,
  NotificationLink,
  Recipients,
} from "@/domain/review-types";
import type { EffectContext, EffectsWritten } from "@/server/effects";
import { newId } from "@/server/ids";
import { notificationHref } from "@/server/notification-href";
import type { FakeState } from "./state";
import type { FakeTx } from "./store";

// The fake's effects writer: what a transition asks for (audit rows, notifications, consumer notices),
// written into the command's `FakeTx` by the rules `writeEffects` (src/server/effects.ts) follows against
// the database. Who receives what is decided the same way, so the contract suite can hold the two to it.

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
        const userIds = recipients(state, effect.to, ctx.teamId).filter(
          (id) => id !== ctx.actorId,
        );
        if (userIds.length === 0) break;
        const slug = teamSlugOf(state, ctx);
        // A stage reviewer outside the template's team opens the version from their own space.
        const link = effect.link;
        const outsideReview: NotificationLink | null =
          link.to === "template" && link.reviewVersion !== undefined
            ? {
                to: "review",
                templateId: link.templateId,
                versionNumber: link.reviewVersion.number,
                round: link.reviewVersion.round,
              }
            : null;
        const spaces =
          link.to === "review" || outsideReview
            ? recipientSpaces(state, userIds, slug)
            : null;
        for (const userId of userIds) {
          const own = spaces?.get(userId);
          tx.insert("notifications", {
            id: newId("nt"),
            userId,
            teamId: ctx.teamId,
            kind: effect.notification,
            title: effect.title,
            body: effect.body ?? null,
            href: own
              ? notificationHref(own, outsideReview ?? link)
              : notificationHref(slug, link),
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
  const template = state.templates.find((t) => t.id === ctx.templateId);
  return state.teams.find((t) => t.id === template?.teamId)?.slug ?? ctx.teamId;
}

/** The users a notification goes to, before the actor is taken out. Sorted, without repeats. */
function recipients(
  state: FakeState,
  to: Recipients,
  teamId: string,
): string[] {
  if (to.kind === "user") return [to.userId];
  const except = new Set(to.exceptUserIds ?? []);
  const holders = state.memberships.filter(
    (m) =>
      m.teamId === teamId &&
      m.status === "active" &&
      state.membershipRoles.some(
        (r) => r.membershipId === m.id && r.role === to.role,
      ),
  );
  return [...new Set(holders.map((m) => m.userId))]
    .filter((id) => !except.has(id))
    .sort();
}

/**
 * The space each recipient opens a review link in: none (the template's team) when they can see that team
 * (an active membership with a role there, or a platform role); otherwise their own first space by name.
 */
function recipientSpaces(
  state: FakeState,
  userIds: readonly string[],
  teamSlug: string,
): Map<string, string> {
  const spaces = new Map<string, string>();
  for (const userId of userIds) {
    if (state.users.find((u) => u.id === userId)?.platformRole) continue;
    const mine = state.memberships
      .filter(
        (m) =>
          m.userId === userId &&
          m.status === "active" &&
          state.membershipRoles.some((r) => r.membershipId === m.id),
      )
      .flatMap((m) => state.teams.filter((t) => t.id === m.teamId));
    if (mine.length === 0 || mine.some((t) => t.slug === teamSlug)) continue;
    spaces.set(
      userId,
      [...mine].sort((a, b) => a.name.localeCompare(b.name))[0]!.slug,
    );
  }
  return spaces;
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
