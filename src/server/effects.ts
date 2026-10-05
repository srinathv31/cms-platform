import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { LifecycleEffect, NotificationLink, Recipients } from "@/domain/review-types";
import type { Db } from "@/server/db/client";
import {
  auditEvents,
  consumerNotices,
  consumers,
  membershipRoles,
  memberships,
  notifications,
  renderLog,
  teams,
  templates,
  users,
} from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";

// The write side every lifecycle action shares: the transaction (with the SQLITE_BUSY retry) and the
// effects writer. A domain transition says WHAT happened as `effects` (audit rows, notifications,
// consumer notices); this file decides WHO they reach and writes them in the caller's transaction,
// so a transition and its side records land together or not at all.

/** The transaction handle drizzle passes to `db.transaction`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Consumers that rendered the template (not as a preview) this recently get its notices. */
export const CONSUMER_NOTICE_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export interface EffectContext {
  /** The demo clock, read once by the action. */
  at: Date;
  actorId: string;
  teamId: string;
  templateId: string;
  /** The version the transition is about. An effect may name another one (`versionId`). */
  versionId: string;
}

export interface EffectsWritten {
  audit: number;
  notifications: number;
  consumerNotices: number;
}

/**
 * Writes what a lifecycle transition asked for, inside the caller's transaction.
 *
 * - **audit**: one row with the team, the template and the version (`template.created` has none).
 * - **notification**: one row per recipient. `user` is that user; `team_role` is every active member
 *   holding the role on the template's team, minus `exceptUserIds`. Nobody is notified of their own
 *   action. The link becomes an href under the team's slug.
 * - **consumer_notice**: one row per consumer that rendered the template, not as a preview, in the
 *   last 90 days (from the render log). The payload carries version numbers, dates and contract
 *   changes, never variable values.
 */
export async function writeEffects(
  tx: Tx,
  effects: readonly LifecycleEffect[],
  ctx: EffectContext,
): Promise<EffectsWritten> {
  const written: EffectsWritten = { audit: 0, notifications: 0, consumerNotices: 0 };
  // Read once, and only when a notification or a notice needs it.
  let template: Promise<{ name: string; teamSlug: string }> | undefined;
  const templateInfo = () => (template ??= templateOf(tx, ctx));
  let audience: Promise<string[]> | undefined;
  const consumerAudience = () => (audience ??= recentConsumers(tx, ctx));

  for (const effect of effects) {
    switch (effect.kind) {
      case "audit": {
        await tx.insert(auditEvents).values({
          id: newId("ae"),
          at: ctx.at,
          actorId: ctx.actorId,
          teamId: ctx.teamId,
          templateId: ctx.templateId,
          // The creation event is about the template; the rest belong to a version.
          versionId: effect.action === "template.created" ? null : (effect.versionId ?? ctx.versionId),
          action: effect.action,
          details: effect.details,
          sessionKey: null,
        });
        written.audit += 1;
        break;
      }

      case "notification": {
        const userIds = (await resolveRecipients(tx, effect.to, ctx.teamId)).filter((id) => id !== ctx.actorId);
        if (userIds.length === 0) break;
        const { teamSlug } = await templateInfo();
        // A stage reviewer outside the template's team opens the version from their own space.
        const spaces = effect.link.to === "review" ? await recipientSpaces(tx, userIds, teamSlug) : null;
        await tx.insert(notifications).values(
          userIds.map((userId) => ({
            id: newId("nt"),
            userId,
            teamId: ctx.teamId,
            kind: effect.notification,
            title: effect.title,
            body: effect.body ?? null,
            href: notificationHref(spaces?.get(userId) ?? teamSlug, effect.link),
            createdAt: ctx.at,
            readAt: null,
          })),
        );
        written.notifications += userIds.length;
        break;
      }

      case "consumer_notice": {
        const consumerIds = await consumerAudience();
        if (consumerIds.length === 0) break;
        const { name } = await templateInfo();
        await tx.insert(consumerNotices).values(
          consumerIds.map((consumerId) => ({
            id: newId("cn"),
            consumerId,
            templateId: ctx.templateId,
            versionId: effect.versionId,
            kind: effect.notice,
            payload: { templateName: name, ...effect.payload },
            createdAt: ctx.at,
          })),
        );
        written.consumerNotices += consumerIds.length;
        break;
      }
    }
  }
  return written;
}

/** The template's name and its team's slug (notifications link under the slug; notices carry the name). */
async function templateOf(tx: Tx, ctx: EffectContext): Promise<{ name: string; teamSlug: string }> {
  const rows = await tx
    .select({ name: templates.name, teamSlug: teams.slug })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .where(eq(templates.id, ctx.templateId))
    .limit(1);
  return rows[0] ?? { name: ctx.templateId, teamSlug: ctx.teamId };
}

/**
 * The space each recipient opens a review link in: the template's team when they can see it (an
 * active membership there, or a platform role); otherwise their own first space by name, as the
 * team switcher lists it (a stage that names someone outside the team: `requireReviewVersion`).
 */
async function recipientSpaces(tx: Tx, userIds: readonly string[], teamSlug: string): Promise<Map<string, string>> {
  const [people, rows] = await Promise.all([
    tx.select({ id: users.id, platformRole: users.platformRole }).from(users).where(inArray(users.id, [...userIds])),
    tx
      .selectDistinct({ userId: memberships.userId, slug: teams.slug, name: teams.name })
      .from(memberships)
      .innerJoin(teams, eq(teams.id, memberships.teamId))
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .where(and(inArray(memberships.userId, [...userIds]), eq(memberships.status, "active"))),
  ]);
  const spaces = new Map<string, string>();
  for (const userId of userIds) {
    if (people.find((p) => p.id === userId)?.platformRole) continue;
    const mine = rows.filter((r) => r.userId === userId);
    if (mine.length === 0 || mine.some((r) => r.slug === teamSlug)) continue;
    spaces.set(userId, [...mine].sort((a, b) => a.name.localeCompare(b.name))[0]!.slug);
  }
  return spaces;
}

/** The users a notification goes to, before the actor is taken out. Sorted, without repeats. */
export async function resolveRecipients(tx: Tx, to: Recipients, teamId: string): Promise<string[]> {
  if (to.kind === "user") return [to.userId];
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .where(
      and(eq(memberships.teamId, teamId), eq(memberships.status, "active"), eq(membershipRoles.role, to.role)),
    );
  const except = new Set(to.exceptUserIds ?? []);
  return [...new Set(rows.map((r) => r.userId))].filter((id) => !except.has(id)).sort();
}

/** `/{team}/review/{templateId}/{n}`, `/{team}/templates/{id}` or `/{team}/templates/{id}/versions`. */
export function notificationHref(teamSlug: string, link: NotificationLink): string {
  switch (link.to) {
    case "review":
      return `/${teamSlug}/review/${link.templateId}/${link.versionNumber}`;
    case "template":
      return `/${teamSlug}/templates/${link.templateId}`;
    case "versions":
      return `/${teamSlug}/templates/${link.templateId}/versions`;
  }
}

/** Registered consumers with a non-preview render of the template in the notice window. */
async function recentConsumers(tx: Tx, ctx: EffectContext): Promise<string[]> {
  const since = new Date(ctx.at.getTime() - CONSUMER_NOTICE_WINDOW_DAYS * DAY_MS);
  const rows = await tx
    .selectDistinct({ consumerId: consumers.id })
    .from(renderLog)
    .innerJoin(consumers, eq(consumers.id, renderLog.consumerId))
    .where(
      and(eq(renderLog.templateId, ctx.templateId), eq(renderLog.isPreview, false), gte(renderLog.at, since)),
    );
  return rows.map((r) => r.consumerId).sort();
}

// ── Transactions ──────────────────────────────────────────────

function isBusy(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === "SQLITE_BUSY" || (cause !== undefined && isBusy(cause));
}

/**
 * One write transaction, retried when the local file is busy (as in `drafts/apply-patch.ts`). Two
 * writes at once make the second `BEGIN IMMEDIATE` fail with SQLITE_BUSY because the file has no busy
 * timeout; the failed attempt rolled back whole, so running it again is safe. The retry re-reads
 * everything, so its compare-and-set sees the first write. Against Turso this never triggers.
 */
export async function inTransaction<T>(db: Db, run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(run);
    } catch (error) {
      if (attempt >= 5 || !isBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * 2 ** attempt));
    }
  }
}

