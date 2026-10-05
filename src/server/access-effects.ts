import "server-only";
import { and, eq } from "drizzle-orm";
import type { AccessEffect, AccessLink, AccessRecipients, MembershipChange } from "@/domain/access-types";
import { ALL_SPACE } from "@/domain/permissions";
import { auditEvents, membershipRoles, memberships, notifications, users } from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import type { Tx } from "./effects";

// The write side of Phase 6 (access and platform settings), the twin of ./effects.ts for lifecycle
// transitions. A domain function (domain/access.ts, domain/platform-config.ts) says WHAT changed and
// what to record; these helpers write it inside the caller's transaction (`inTransaction` from
// ./effects), so a decision, its membership row, its audit row and its notifications land together.

export interface AccessEffectContext {
  /** The demo clock, read once by the action. Effects with their own `at` (the sweep) keep it. */
  now: Date;
  /** Who acted. null for the system (the clock-driven sweep). Effects may override with `actorId`. */
  actorId: string | null;
}

export interface AccessEffectsWritten {
  audit: number;
  notifications: number;
}

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
    const recipients = (await resolveAccessRecipients(tx, effect.to)).filter((id) => id !== ctx.actorId);
    if (recipients.length === 0) continue;
    const href = accessHref(effect.link);
    await tx.insert(notifications).values(
      recipients.map((userId) => ({
        id: newId("nt"),
        userId,
        teamId: effect.teamId,
        kind: effect.notification,
        title: effect.title,
        body: effect.body ?? null,
        href,
        createdAt: at,
        readAt: null,
      })),
    );
    written.notifications += recipients.length;
  }
  return written;
}

/** Sorted, without repeats. */
export async function resolveAccessRecipients(tx: Tx, to: AccessRecipients): Promise<string[]> {
  if (to.kind === "user") return [to.userId];
  if (to.kind === "platform_admins") {
    const admins = await tx.select({ id: users.id }).from(users).where(eq(users.platformRole, "platform_admin"));
    return admins.map((u) => u.id).sort();
  }
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .where(
      and(
        eq(memberships.teamId, to.teamId),
        eq(memberships.status, "active"),
        eq(membershipRoles.role, "team_admin"),
      ),
    );
  const except = new Set(to.exceptUserIds ?? []);
  return [...new Set(rows.map((r) => r.userId))].filter((id) => !except.has(id)).sort();
}

/** Team ids are their slugs (seed contract), so every link builds from the id. */
export function accessHref(link: AccessLink): string {
  switch (link.to) {
    case "settings":
      return `/${link.teamId}/settings/${link.section}`;
    case "library":
      return `/${link.teamId}/library`;
    case "request-access":
      return "/request-access";
    case "platform":
      return `/${ALL_SPACE}/settings/${link.section}`;
  }
}

/**
 * Applies one membership change. Returns the membership id (a new one for an insert). `roles`
 * replaces the membership_roles rows. A delete removes the roles with it (cascade).
 */
export async function applyMembershipChange(tx: Tx, change: MembershipChange): Promise<string> {
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
      if (roles.length) await tx.insert(membershipRoles).values(roles.map((role) => ({ membershipId: id, role })));
      return id;
    }
    case "update": {
      const { roles, ...set } = change.set;
      if (Object.keys(set).length) await tx.update(memberships).set(set).where(eq(memberships.id, change.membershipId));
      if (roles) {
        await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, change.membershipId));
        if (roles.length) {
          await tx.insert(membershipRoles).values(roles.map((role) => ({ membershipId: change.membershipId, role })));
        }
      }
      return change.membershipId;
    }
    case "delete": {
      // SQLite enforces the cascade only with foreign_keys on: delete the roles explicitly.
      await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, change.membershipId));
      await tx.delete(memberships).where(eq(memberships.id, change.membershipId));
      return change.membershipId;
    }
  }
}
