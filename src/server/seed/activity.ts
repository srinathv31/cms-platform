import type { SeedCtx } from "./context";
import { teamMemberIds } from "./teams";
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
  const members = teamMemberIds(coral);
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

  // ── Notifications ──────────────────────────────────────────────
  const cashBack = ctx.template("cash-back");
  const waiver = ctx.template("annual-fee-waiver");
  const balanceTransfer = ctx.template("balance-transfer");
  const holiday = ctx.template("holiday-points");
  const waiverReason = sink.approvals.find(
    (a) => a.versionId === waiver.versions.v1.id && a.decision === "changes_requested",
  )?.reason;

  const note = (n: {
    user: string;
    kind: string;
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
    title: `Review requested: ${cashBack.name} v3`,
    body: `${userName("maya")} submitted v3. It adds the required variable annual_fee, a breaking change for consumers.`,
    href: `/${coral}/review/${cashBack.id}/3`,
    at: 0.9,
  });
  note({
    user: "maya",
    kind: "changes_requested",
    title: `${userName("jordan")} requested changes on ${waiver.name} v1`,
    body: waiverReason ?? undefined,
    href: `/${coral}/templates/${waiver.id}`,
    at: 3.9,
  });
  note({
    user: "alex",
    kind: "access_request",
    title: `${userName("chris")} requested Author access to Coral Offers`,
    body: requestReason,
    href: `/${coral}/settings/access-requests`,
    at: 1.5,
  });
  note({
    user: "alex",
    kind: "recertification_due",
    title: "Recertification due in 30 days",
    body: `${label} access review for Coral Offers: confirm ${members.length} members.`,
    href: `/${coral}/settings/recertification`,
    at: 4,
  });
  note({
    user: "priya",
    kind: "sunset_set",
    title: `Sunset set for ${balanceTransfer.name} v1`,
    body: "Coral still renders v1. It keeps working until the sunset date.",
    href: `/${coral}/templates/${balanceTransfer.id}`,
    at: 2.2,
  });

  // Already read: a little history in the bell
  note({
    user: "maya",
    kind: "version_active",
    title: `${cashBack.name} v2 is now Active`,
    href: `/${coral}/templates/${cashBack.id}`,
    at: 86.5,
    read: true,
  });
  note({
    user: "priya",
    kind: "version_active",
    title: `${balanceTransfer.name} v2 is now Active`,
    href: `/${coral}/templates/${balanceTransfer.id}`,
    at: 47.5,
    read: true,
  });
  note({
    user: "priya",
    kind: "revoke_confirmed",
    title: `${holiday.name} v1 was revoked`,
    body: "Reason: Wrong bonus amount.",
    href: `/${coral}/templates/${holiday.id}`,
    at: 34.3,
    read: true,
  });
}
