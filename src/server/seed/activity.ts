import type { AnyNotificationKind } from "@/domain/access-types";
import { formatLongDate } from "@/domain/dates";
import { reviewPath, versionLabel, type NumberedRound } from "@/domain/rounds";
import type { SeedCtx, VersionRef } from "./context";
import { flaggedMembers, recertSubjectIds } from "./teams";
import { userName } from "./people";

// Access requests, recertification and notifications. Lifecycle audit events and consumer notices
// come from the template builder, so they always agree with the version rows.

function quarterLabel(ms: number): string {
  const d = new Date(ms);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

export function seedActivity(ctx: SeedCtx) {
  const { sink } = ctx;
  const coral = "coral-offers";

  // ── Chris Morales asks to join Coral Offers as an Author ───────
  const requestReason =
    "I'm joining the Offers content team next week and will draft the spring promotion disclosures.";
  sink.accessRequests.push({
    id: ctx.id("ar"),
    userId: "chris",
    teamId: coral,
    role: "author",
    reason: requestReason,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: ctx.at(1.5),
  });
  sink.auditEvents.push({
    id: ctx.id("ae"),
    at: ctx.at(1.5),
    actorId: "chris",
    teamId: coral,
    action: "access.requested",
    details: { role: "author", reason: requestReason },
  });

  // ── Quarterly recertification, due in 30 days ──────────────────
  const recertId = ctx.id("rc");
  const dueAt = ctx.at(-30);
  const label = quarterLabel(dueAt.getTime());
  sink.recertifications.push({
    id: recertId,
    teamId: coral,
    label,
    startsAt: ctx.at(4),
    dueAt,
    completedAt: null,
  });
  const members = recertSubjectIds(coral);
  for (const userId of members) {
    sink.recertItems.push({ recertId, userId, decision: null, decidedBy: null, decidedAt: null });
  }
  sink.auditEvents.push({
    id: ctx.id("ae"),
    at: ctx.at(4),
    actorId: null,
    teamId: coral,
    action: "recert.started",
    details: { label, dueAt: dueAt.toISOString(), members: members.length },
  });

  // ── Devon Lin: flagged for inactivity 5 days ago (90 days without a sign-in) ──
  for (const m of flaggedMembers(coral)) {
    sink.auditEvents.push({
      id: ctx.id("ae"),
      at: ctx.at(m.flaggedDaysAgo!),
      actorId: null,
      teamId: coral,
      action: "access.flagged_inactive",
      details: {
        userId: m.user,
        userName: userName(m.user),
        lastActiveAt: ctx.at(m.flaggedDaysAgo! + 90).toISOString(),
        suspendsAt: ctx.at(m.flaggedDaysAgo! - 30).toISOString(),
      },
    });
  }

  // ── Notifications ──────────────────────────────────────────────
  // Kinds are domain/access-types.ts `AnyNotificationKind`.
  const cashBack = ctx.template("cash-back");
  const waiver = ctx.template("annual-fee-waiver");
  const balanceTransfer = ctx.template("balance-transfer");
  const holiday = ctx.template("holiday-points");
  const abroad = ctx.template("card-used-abroad");
  const reminder = ctx.template("payment-due-reminder");
  const reasonFor = (version: VersionRef) =>
    sink.approvals.find((a) => a.versionId === version.id && a.decision === "changes_requested")?.reason;
  const waiverReason = reasonFor(waiver.versions.v1);
  // A round as the app's notifications name it (rounds.ts): "v3, round 2".
  const round = (version: VersionRef): NumberedRound => ({ number: version.number!, round: version.round!, state: version.state });
  const sentence = (version: VersionRef) => versionLabel(round(version), { style: "sentence" });

  const note = (n: {
    user: string;
    kind: AnyNotificationKind;
    title: string;
    body?: string;
    href?: string;
    at: number;
    read?: boolean;
  }) =>
    sink.notifications.push({
      id: ctx.id("nt"),
      userId: n.user,
      teamId: coral,
      kind: n.kind,
      title: n.title,
      body: n.body ?? null,
      href: n.href ?? null,
      createdAt: ctx.at(n.at),
      readAt: n.read ? ctx.at(n.at - 0.05) : null,
    });

  // Waiting on someone
  note({
    user: "jordan",
    kind: "review_requested",
    title: `${userName("maya")} submitted ${cashBack.name} ${sentence(cashBack.versions.v3)} for review.`,
    body: "It adds the required variable annual_fee, a breaking change for consumers.",
    href: reviewPath(coral, cashBack.id, round(cashBack.versions.v3)),
    at: 0.9,
  });
  note({
    user: "jordan",
    kind: "review_requested",
    title: `${userName("priya")} submitted ${abroad.name} ${sentence(abroad.versions.v1)} for review.`,
    body: "Fraud Operations asked for a push and a text when a card is used outside the US.",
    href: reviewPath(coral, abroad.id, round(abroad.versions.v1)),
    at: 1.2,
  });
  note({
    user: "maya",
    kind: "changes_requested",
    title: `${userName("jordan")} requested changes on ${waiver.name} ${sentence(waiver.versions.v1)}.`,
    body: waiverReason ?? undefined,
    href: `/${coral}/templates/${waiver.id}`,
    at: 3.9,
  });
  note({
    user: "alex",
    kind: "access_requested",
    title: `${userName("chris")} asked for Author access to Coral Offers.`,
    body: requestReason,
    href: `/${coral}/settings/access-requests`,
    at: 1.5,
  });
  note({
    user: "alex",
    kind: "recert_due",
    title: "Recertification is due in 30 days.",
    body: `${label} access review for Coral Offers: confirm ${members.length} members.`,
    href: `/${coral}/settings/recertification`,
    at: 4,
  });
  for (const m of flaggedMembers(coral)) {
    note({
      user: "alex",
      kind: "inactivity_flagged",
      title: `${userName(m.user)} hasn't signed in for 90 days.`,
      body: `Access to Coral Offers is suspended automatically on ${formatLongDate(ctx.at(m.flaggedDaysAgo! - 30))}.`,
      href: `/${coral}/settings/inactivity`,
      at: m.flaggedDaysAgo!,
      read: true,
    });
  }
  note({
    user: "priya",
    kind: "sunset_scheduled",
    title: `Sunset set for ${balanceTransfer.name} v1.`,
    body: "Coral still renders v1. It keeps working until the sunset date.",
    href: `/${coral}/templates/${balanceTransfer.id}`,
    at: 2.2,
  });

  // Already read: a little history in the bell
  note({
    user: "maya",
    kind: "changes_requested",
    title: `${userName("jordan")} requested changes on ${cashBack.name} ${sentence(cashBack.versions.v3r1)}.`,
    body: reasonFor(cashBack.versions.v3r1) ?? undefined,
    href: `/${coral}/templates/${cashBack.id}`,
    at: 2.6,
    read: true,
  });
  note({
    user: "maya",
    kind: "version_live",
    title: `${cashBack.name} v2 is now Active.`,
    href: `/${coral}/templates/${cashBack.id}`,
    at: 86.5,
    read: true,
  });
  note({
    user: "maya",
    kind: "version_live",
    title: `${reminder.name} v1 is now Active.`,
    href: `/${coral}/templates/${reminder.id}`,
    at: 51.5,
    read: true,
  });
  note({
    user: "priya",
    kind: "version_live",
    title: `${balanceTransfer.name} v2 is now Active.`,
    href: `/${coral}/templates/${balanceTransfer.id}`,
    at: 47.5,
    read: true,
  });
  note({
    user: "priya",
    kind: "version_revoked",
    title: `${holiday.name} v1 was revoked.`,
    body: "Reason: Wrong bonus amount.",
    href: `/${coral}/templates/${holiday.id}`,
    at: 34.3,
    read: true,
  });
}
