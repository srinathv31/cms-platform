import "server-only";
import { and, eq } from "drizzle-orm";
import type {
  AccessEffect,
  AccessEffectContext,
  AccessEffectsWritten,
  AccessRecipients,
  MembershipChange,
} from "@/domain/access-types";
import {
  auditEvents,
  membershipRoles,
  memberships,
  notifications,
  users,
} from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import type { Tx } from "./transaction";

// The local backend's write side for access and platform settings, the twin of ./effects.ts for lifecycle
// transitions. A domain function (domain/access/, domain/platform-config/) says WHAT changed and what to
// record; these helpers write it inside the caller's transaction (./transaction.ts), so a decision, its
// membership row, its audit row and its notifications land together. A notification stores its kind, its
// facts and its link (by team id); the BFF words it and builds the href when it reads it (decision 0055). The
// fake's twin is services/fake/access-effects.ts.

export type {
  AccessEffectContext,
  AccessEffectsWritten,
} from "@/domain/access-types";

/**
 * Writes audit rows and notifications. Recipients: `user` is that user; `team_admins` is every
 * active member holding team_admin on the team (read now, inside the transaction), minus
 * `exceptUserIds`; `platform_admins` is every Platform Admin. Nobody is notified of their own action.
 */
export async function writeAccessEffects(
  tx: Tx,
  effects: readonly AccessEffect[],
  ctx: AccessEffectContext,
): Promise<AccessEffectsWritten> {
  const written: AccessEffectsWritten = { audit: 0, notifications: 0 };
  for (const effect of effects) {
    const at = effect.at ?? ctx.now;
    if (effect.kind === "audit") {
      await tx.insert(auditEvents).values({
        id: newId("ae"),
        at,
        actorId: effect.actorId === undefined ? ctx.actorId : effect.actorId,
        teamId: effect.teamId,
        templateId: null,
        versionId: null,
        action: effect.action,
        details: effect.details,
        sessionKey: null,
      });
      written.audit += 1;
      continue;
    }
    const recipients = (await resolveAccessRecipients(tx, effect.to)).filter(
      (id) => id !== ctx.actorId,
    );
    if (recipients.length === 0) continue;
    await tx.insert(notifications).values(
      recipients.map((userId) => ({
        id: newId("nt"),
        userId,
        teamId: effect.teamId,
        kind: effect.notification,
        facts: effect.facts,
        link: effect.link,
        body: effect.body ?? null,
        createdAt: at,
        readAt: null,
      })),
    );
    written.notifications += recipients.length;
  }
  return written;
}

/** Sorted, without repeats. */
export async function resolveAccessRecipients(
  tx: Tx,
  to: AccessRecipients,
): Promise<string[]> {
  if (to.kind === "user") return [to.userId];
  if (to.kind === "platform_admins") {
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.platformRole, "platform_admin"));
    return admins.map((u) => u.id).sort();
  }
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(
      membershipRoles,
      eq(membershipRoles.membershipId, memberships.id),
    )
    .where(
      and(
        eq(memberships.teamId, to.teamId),
        eq(memberships.status, "active"),
        eq(membershipRoles.role, "team_admin"),
      ),
    );
  const except = new Set(to.exceptUserIds ?? []);
  return [...new Set(rows.map((r) => r.userId))]
    .filter((id) => !except.has(id))
    .sort();
}

/**
 * Applies one membership change. Returns the membership id (a new one for an insert). `roles`
 * replaces the membership_roles rows. A delete removes the roles with it (cascade).
 */
export async function applyMembershipChange(
  tx: Tx,
  change: MembershipChange,
): Promise<string> {
  switch (change.kind) {
    case "insert": {
      const id = newId("m");
      const { roles, ...row } = change.membership;
      await tx.insert(memberships).values({
        id,
        ...row,
        status: "active",
        statusChangedAt: null,
        statusReason: null,
        inactivityFlaggedAt: null,
        inactivityKeptAt: null,
      });
      if (roles.length)
        await tx
          .insert(membershipRoles)
          .values(roles.map((role) => ({ membershipId: id, role })));
      return id;
    }
    case "update": {
      const { roles, ...set } = change.set;
      if (Object.keys(set).length)
        await tx
          .update(memberships)
          .set(set)
          .where(eq(memberships.id, change.membershipId));
      if (roles) {
        await tx
          .delete(membershipRoles)
          .where(eq(membershipRoles.membershipId, change.membershipId));
        if (roles.length) {
          await tx.insert(membershipRoles).values(
            roles.map((role) => ({
              membershipId: change.membershipId,
              role,
            })),
          );
        }
      }
      return change.membershipId;
    }
    case "delete": {
      // Delete the roles explicitly rather than lean on the cascade: it fires only while foreign keys are enforced
      // (libSQL's default), and this write shouldn't depend on the connection's setting.
      await tx
        .delete(membershipRoles)
        .where(eq(membershipRoles.membershipId, change.membershipId));
      await tx
        .delete(memberships)
        .where(eq(memberships.id, change.membershipId));
      return change.membershipId;
    }
  }
}
