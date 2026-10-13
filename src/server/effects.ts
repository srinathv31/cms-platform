import "server-only";
import { and, eq, gte, inArray, max, type SQL } from "drizzle-orm";
import { noticeAudienceSince } from "@/domain/golive/audience";
import {
  linkMayMove,
  notificationRecipients,
  recipientLink,
  type RecipientFacts,
  type RecipientMembership,
} from "@/domain/recipients";
import type { LifecycleEffect } from "@/domain/review-types";
import type { Db } from "@/server/db/client";
import {
  auditEvents,
  consumerNotices,
  consumers,
  membershipRoles,
  memberships,
  notifications,
  renderLog,
  settings,
  teams,
  templates,
  users,
  versions,
} from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import { notificationHref } from "@/server/notification-href";

// The write side every lifecycle action shares: the transaction (`inTransaction`, run once) and the
// effects writer. A domain transition says WHAT happened as `effects` (audit rows, notifications,
// consumer notices); this file decides WHO they reach and writes them in the caller's transaction,
// so a transition and its side records land together or not at all.

/** The transaction handle drizzle passes to `db.transaction`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export { CONSUMER_NOTICE_WINDOW_DAYS } from "@/domain/golive/audience";
export { notificationHref } from "@/server/notification-href";

export interface EffectContext {
  /**
   * When it happened: the demo clock, read once by the action. The sunset sweep passes the instant the
   * sunset passed. Audit rows are dated then, and consumer notices go to the consumers that rendered the
   * template from 90 days before it on.
   */
  at: Date;
  /**
   * When the effects are written, if later than `at`: the sunset sweep runs after the sunset. Notifications
   * and consumer notices are created then, the moment they can first be read. Defaults to `at`.
   */
  writtenAt?: Date;
  /** Who acted; null for the system (the sunset sweep). */
  actorId: string | null;
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
 * - **consumer_notice**: one row per consumer that rendered the template, not as a preview, from 90
 *   days before `at` on (from the render log). The payload carries the name of the version the notice
 *   is about (`templateName`), version numbers, dates and contract changes, never variable values. Each
 *   row takes the next `seq` (`takeNoticeSeqs`), the order the notices API pages in, and is created at
 *   `writtenAt`.
 */
export async function writeEffects(
  tx: Tx,
  effects: readonly LifecycleEffect[],
  ctx: EffectContext,
): Promise<EffectsWritten> {
  const written: EffectsWritten = {
    audit: 0,
    notifications: 0,
    consumerNotices: 0,
  };
  const createdAt = ctx.writtenAt ?? ctx.at;
  // Read once, and only when a notification or a notice needs it.
  let team: Promise<string> | undefined;
  const teamSlugOf = () => (team ??= teamSlug(tx, ctx));
  const names = new Map<string, Promise<string>>();
  const nameOf = (versionId: string) => {
    let name = names.get(versionId);
    if (!name) names.set(versionId, (name = versionName(tx, versionId, ctx)));
    return name;
  };
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
        // Who it reaches and where each link opens are the domain's rules (domain/recipients.ts); this reads
        // the facts they need.
        const members =
          effect.to.kind === "team_role"
            ? await membershipsWhere(tx, eq(memberships.teamId, ctx.teamId))
            : [];
        const userIds = notificationRecipients(
          effect.to,
          ctx.teamId,
          members,
          ctx.actorId,
        );
        if (userIds.length === 0) break;
        const teamSlug = await teamSlugOf();
        const people = linkMayMove(effect.link)
          ? await recipientFacts(tx, userIds)
          : new Map<string, RecipientFacts>();
        await tx.insert(notifications).values(
          userIds.map((userId) => {
            const person = people.get(userId);
            const opens = person
              ? recipientLink(person, teamSlug, effect.link)
              : { teamSlug, link: effect.link };
            return {
              id: newId("nt"),
              userId,
              teamId: ctx.teamId,
              kind: effect.notification,
              title: effect.title,
              body: effect.body ?? null,
              href: notificationHref(opens.teamSlug, opens.link),
              createdAt,
              readAt: null,
            };
          }),
        );
        written.notifications += userIds.length;
        break;
      }

      case "consumer_notice": {
        const consumerIds = await consumerAudience();
        if (consumerIds.length === 0) break;
        const name = await nameOf(effect.versionId);
        const first = await takeNoticeSeqs(tx, consumerIds.length);
        await tx.insert(consumerNotices).values(
          consumerIds.map((consumerId, i) => ({
            id: newId("cn"),
            seq: first + i,
            consumerId,
            templateId: ctx.templateId,
            versionId: effect.versionId,
            kind: effect.notice,
            payload: { templateName: name, ...effect.payload },
            createdAt,
          })),
        );
        written.consumerNotices += consumerIds.length;
        break;
      }
    }
  }
  return written;
}

/** The template's team's slug: notifications link under it. */
async function teamSlug(tx: Tx, ctx: EffectContext): Promise<string> {
  const rows = await tx
    .select({ teamSlug: teams.slug })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .where(eq(templates.id, ctx.templateId))
    .limit(1);
  return rows[0]?.teamSlug ?? ctx.teamId;
}

/**
 * The name a notice carries: the one the version it is about has, as written now. A new version's
 * notice names it as approved; a sunset or a revoke names the old version as its consumers know it.
 */
async function versionName(
  tx: Tx,
  versionId: string,
  ctx: EffectContext,
): Promise<string> {
  const rows = await tx
    .select({ name: versions.name })
    .from(versions)
    .where(eq(versions.id, versionId))
    .limit(1);
  return rows[0]?.name ?? ctx.templateId;
}

/** Memberships, with their team and roles, as the recipient rules read them. */
async function membershipsWhere(
  tx: Tx,
  where: SQL,
): Promise<RecipientMembership[]> {
  const rows = await tx
    .select({
      id: memberships.id,
      userId: memberships.userId,
      status: memberships.status,
      teamId: teams.id,
      teamSlug: teams.slug,
      teamName: teams.name,
    })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(where);
  const roles = rows.length
    ? await tx
        .select()
        .from(membershipRoles)
        .where(
          inArray(
            membershipRoles.membershipId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map(({ id, ...m }) => ({
    ...m,
    roles: roles.filter((r) => r.membershipId === id).map((r) => r.role),
  }));
}

/** Each recipient's platform role and memberships: where their links open (`recipientLink`). */
async function recipientFacts(
  tx: Tx,
  userIds: readonly string[],
): Promise<Map<string, RecipientFacts>> {
  const [people, held] = await Promise.all([
    tx
      .select({ id: users.id, platformRole: users.platformRole })
      .from(users)
      .where(inArray(users.id, [...userIds])),
    membershipsWhere(tx, inArray(memberships.userId, [...userIds])),
  ]);
  return new Map(
    people.map((p) => [
      p.id,
      {
        userId: p.id,
        platformRole: p.platformRole ?? null,
        memberships: held.filter((m) => m.userId === p.id),
      },
    ]),
  );
}

/** The settings row that holds the last `consumer_notices.seq` handed out. */
export const NOTICE_SEQ_KEY = "consumer_notice_seq";

/**
 * Takes `count` consecutive `consumer_notices.seq` numbers and returns the first.
 *
 * - **Commit order.** It runs inside the writing transaction, which holds SQLite's write lock
 *   (`BEGIN IMMEDIATE`) until it commits, so notices are numbered in the order they become visible
 *   and a consumer paging by `seq` never skips one.
 * - **Never reused.** The last number handed out is kept in `settings` (`NOTICE_SEQ_KEY`) and only goes
 *   up, so deleting the newest notices (test cleanup) can't hand their numbers out again to a notice a
 *   consumer's cursor is already past. The highest stored `seq` is a floor in case the row is missing.
 *   Only a demo reset starts again, and it changes the cursor epoch (`settings.seeded_at`).
 * - The unique index on `seq` refuses a duplicate rather than store one.
 */
export async function takeNoticeSeqs(tx: Tx, count: number): Promise<number> {
  const [counter] = await tx
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, NOTICE_SEQ_KEY));
  const [stored] = await tx
    .select({ last: max(consumerNotices.seq) })
    .from(consumerNotices);
  const last = Math.max(
    typeof counter?.value === "number" ? counter.value : 0,
    stored?.last ?? 0,
  );
  const value = last + count;
  await tx
    .insert(settings)
    .values({ key: NOTICE_SEQ_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  return last + 1;
}

/** Registered consumers with a non-preview render of the template from the notice window before `ctx.at` on. */
async function recentConsumers(tx: Tx, ctx: EffectContext): Promise<string[]> {
  const since = noticeAudienceSince(ctx.at);
  const rows = await tx
    .selectDistinct({ consumerId: consumers.id })
    .from(renderLog)
    .innerJoin(consumers, eq(consumers.id, renderLog.consumerId))
    .where(
      and(
        eq(renderLog.templateId, ctx.templateId),
        eq(renderLog.isPreview, false),
        gte(renderLog.at, since),
      ),
    );
  return rows.map((r) => r.consumerId).sort();
}

// ── Transactions ──────────────────────────────────────────────

/**
 * One write transaction (`BEGIN IMMEDIATE`), run once. Every write transaction in the app runs here: the
 * server actions (`actions/kit.ts`), autosave (`drafts/apply-patch.ts`), import (`import/create.ts`) and
 * the sweeps. Two writes at once never collide: the database client makes the second wait its turn, at
 * most 5 s (src/lib/serialized-writes.ts, the only place the app waits, which also says what a lock held
 * by another process does: it freezes the event loop and fails queued writes one by one). Past the wait
 * it fails with SQLITE_BUSY, and the failure is the answer: a retry here would wait again for every
 * attempt. The transaction reads what it checks, so whichever
 * write goes second sees the first one's, and its compare-and-set refuses if the row moved.
 */
export function inTransaction<T>(
  db: Db,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(run);
}
