import type {
  AccessEffect,
  AccessEffectContext,
  AccessEffectsWritten,
  AccessRecipients,
} from "@/domain/access-types";
import { newId } from "@/server/ids";
import type { FakeState } from "./state";
import type { FakeTx } from "./store";

// The fake's effects writer for access and platform changes, the twin of `writeAccessEffects`
// (services/local/access-effects.ts): audit rows and notifications, written into the command's `FakeTx`, with
// the same recipients. A notification stores its kind, its facts and its link (by team id). The access commands
// that write through it move behind the seam with plan P2.

/** Writes an access transition's audit rows and notifications, as `writeAccessEffects` does. */
export function writeFakeAccessEffects(
  tx: FakeTx,
  effects: readonly AccessEffect[],
  ctx: AccessEffectContext,
): AccessEffectsWritten {
  const written: AccessEffectsWritten = { audit: 0, notifications: 0 };
  for (const effect of effects) {
    const at = effect.at ?? ctx.now;
    if (effect.kind === "audit") {
      tx.insert("auditEvents", {
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
    const recipients = accessRecipients(tx.state, effect.to).filter(
      (id) => id !== ctx.actorId,
    );
    for (const userId of recipients)
      tx.insert("notifications", {
        id: newId("nt"),
        userId,
        teamId: effect.teamId,
        kind: effect.notification,
        facts: effect.facts,
        link: effect.link,
        body: effect.body ?? null,
        createdAt: at,
        readAt: null,
      });
    written.notifications += recipients.length;
  }
  return written;
}

/**
 * Who an access notification reaches (`resolveAccessRecipients`): the user it names; every active Team Admin of
 * the team, less `exceptUserIds`; or every Platform Admin. Sorted, without repeats.
 */
export function accessRecipients(
  state: FakeState,
  to: AccessRecipients,
): string[] {
  const sorted = (ids: string[]) =>
    [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (to.kind === "user") return [to.userId];
  if (to.kind === "platform_admins")
    return sorted(
      state.users
        .filter((u) => u.platformRole === "platform_admin")
        .map((u) => u.id),
    );
  const except = new Set(to.exceptUserIds ?? []);
  return sorted(
    state.memberships
      .filter(
        (m) =>
          m.teamId === to.teamId &&
          m.status === "active" &&
          !except.has(m.userId) &&
          state.membershipRoles.some(
            (r) => r.membershipId === m.id && r.role === "team_admin",
          ),
      )
      .map((m) => m.userId),
  );
}
