import type { AnyNotificationKind } from "@/domain/access-types";
import { quarterLabel } from "@/domain/access/recertification";
import {
  DEFAULT_BUSINESS_ZONE,
  sunsetDay as sunsetDayIn,
} from "@/domain/business-zone";
import type {
  NotificationFactsOf,
  StoredNotificationLink,
} from "@/domain/notifications";
import { recipientLink } from "@/domain/recipients";
import type { NotificationLink } from "@/domain/review-types";
import { asNumbered, reviewLink } from "@/domain/rounds";
import type { SeedCtx, VersionRef } from "./context";
import { flaggedMembers, recertSubjectIds, teamName } from "./teams";
import { userName } from "./people";

// Access requests, recertification and notifications. Lifecycle audit events and consumer notices
// come from the template builder, so they always agree with the version rows.

export function seedActivity(ctx: SeedCtx) {
  const { sink } = ctx;
  const coral = "t_coral";

  // ── Chris Morales asks to join Coral Offers as an Author ───────
  const requestReason =
    "I'm joining the Offers content team next week and will draft the spring promotion disclosures.";
  sink.accessRequests.push({
    id: ctx.id("activity", "ar"),
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
    id: ctx.id("activity", "ae"),
    at: ctx.at(1.5),
    actorId: "chris",
    teamId: coral,
    action: "access.requested",
    details: {
      userId: "chris",
      userName: userName("chris"),
      role: "author",
      reason: requestReason,
    },
  });

  // ── Quarterly recertification, due in 30 days ──────────────────
  const recertId = ctx.id("activity", "rc");
  const dueAt = ctx.at(-30);
  const label = quarterLabel(dueAt);
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
    sink.recertItems.push({
      recertId,
      userId,
      decision: null,
      decidedBy: null,
      decidedAt: null,
    });
  }
  sink.auditEvents.push({
    id: ctx.id("activity", "ae"),
    at: ctx.at(4),
    // A Team Admin starts a review (`startRecert`); Coral Offers' is Alex.
    actorId: "alex",
    teamId: coral,
    action: "recert.started",
    details: { label, dueAt: dueAt.toISOString(), members: members.length },
  });

  // ── Devon Lin: flagged for inactivity 5 days ago (90 days without a sign-in) ──
  for (const m of flaggedMembers(coral)) {
    sink.auditEvents.push({
      id: ctx.id("activity", "ae"),
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
  // As the runtime writes them (decision 0055): the kind, its facts with names as they were (read from the
  // rows the template builder wrote, so they agree), a link placed in the team by id (`recipientLink`), and a
  // person's own words as the body. The bell words them when it reads them, so a seeded notification reads
  // like a live one, at whatever moment the seed is loaded.
  const cashBack = ctx.template("cash-back");
  const waiver = ctx.template("annual-fee-waiver");
  const balanceTransfer = ctx.template("balance-transfer");
  const holiday = ctx.template("holiday-points");
  const abroad = ctx.template("card-used-abroad");
  const reminder = ctx.template("payment-due-reminder");
  const coralName = teamName(coral);

  const rowOf = (version: VersionRef) => {
    const row = sink.versions.find((v) => v.id === version.id);
    if (!row) throw new Error(`Seed: no version ${version.id}`);
    return row;
  };
  /** Who decided the version that way (its approvals row). */
  const decision = (
    version: VersionRef,
    kind: "approved" | "changes_requested",
  ) => {
    const row = sink.approvals.find(
      (a) => a.versionId === version.id && a.decision === kind,
    );
    if (!row) throw new Error(`Seed: ${version.id} has no ${kind} decision`);
    return row;
  };
  /** A round, as a notification about it stores it: its name then, its number and its round. */
  const roundOf = (version: VersionRef) => ({
    templateName: rowOf(version).name,
    number: version.number!,
    round: version.round!,
  });
  /** A released version: its name then and its number. */
  const releasedOf = (version: VersionRef) => ({
    templateName: rowOf(version).name,
    number: version.number!,
  });
  const inCoral = (link: NotificationLink) => recipientLink(null, coral, link);

  const note = <K extends AnyNotificationKind>(n: {
    user: string;
    kind: K;
    facts: NotificationFactsOf<K>;
    body?: string | null;
    link: StoredNotificationLink;
    at: number;
    read?: boolean;
  }) =>
    sink.notifications.push({
      id: ctx.id("activity", "nt"),
      userId: n.user,
      teamId: coral,
      kind: n.kind,
      facts: n.facts,
      link: n.link,
      body: n.body ?? null,
      createdAt: ctx.at(n.at),
      readAt: n.read ? ctx.at(n.at - 0.05) : null,
    });

  // Waiting on someone: a submit asks the first stage's approvers, with the submitter's note.
  for (const [template, version, at] of [
    [cashBack, cashBack.versions.v3, 0.9],
    [abroad, abroad.versions.v1, 1.2],
  ] as const) {
    const row = rowOf(version);
    note({
      user: "jordan",
      kind: "review_requested",
      facts: { actorName: userName(row.submittedBy!), ...roundOf(version) },
      body: row.submitNote,
      link: inCoral(reviewLink(template.id, asNumbered(version))),
      at,
    });
  }
  // A send-back tells the submitter, with the reason.
  const sentBack = decision(waiver.versions.v1, "changes_requested");
  note({
    user: "maya",
    kind: "changes_requested",
    facts: {
      actorName: userName(sentBack.actorId),
      ...roundOf(waiver.versions.v1),
    },
    body: sentBack.reason,
    link: inCoral({ to: "template", templateId: waiver.id }),
    at: 3.9,
  });
  note({
    user: "alex",
    kind: "access_requested",
    facts: {
      actorName: userName("chris"),
      teamName: coralName,
      role: "author",
    },
    body: requestReason,
    link: { to: "settings", teamId: coral, section: "access-requests" },
    at: 1.5,
  });
  note({
    user: "alex",
    kind: "recert_due",
    facts: {
      teamName: coralName,
      dueAt: dueAt.toISOString(),
      members: members.length,
    },
    link: { to: "settings", teamId: coral, section: "recertification" },
    at: 4,
  });
  for (const m of flaggedMembers(coral)) {
    note({
      user: "alex",
      kind: "inactivity_flagged",
      facts: {
        userId: m.user,
        userName: userName(m.user),
        teamName: coralName,
        suspendsAt: ctx.at(m.flaggedDaysAgo! - 30).toISOString(),
      },
      link: { to: "settings", teamId: coral, section: "inactivity" },
      at: m.flaggedDaysAgo!,
      read: true,
    });
  }
  // The sunset Jordan set on Balance Transfer v1 tells Priya, who submitted it.
  const sunsetAt = rowOf(balanceTransfer.versions.v1).sunsetAt!;
  note({
    user: "priya",
    kind: "sunset_scheduled",
    facts: {
      ...releasedOf(balanceTransfer.versions.v1),
      sunsetAt: sunsetAt.toISOString(),
      sunsetDay: sunsetDayIn(sunsetAt, DEFAULT_BUSINESS_ZONE),
      zone: DEFAULT_BUSINESS_ZONE,
    },
    link: inCoral({ to: "versions", templateId: balanceTransfer.id }),
    at: 2.2,
  });

  // Already read: a little history in the bell
  const firstSendBack = decision(cashBack.versions.v3r1, "changes_requested");
  note({
    user: "maya",
    kind: "changes_requested",
    facts: {
      actorName: userName(firstSendBack.actorId),
      ...roundOf(cashBack.versions.v3r1),
    },
    body: firstSendBack.reason,
    link: inCoral({ to: "template", templateId: cashBack.id }),
    at: 2.6,
    read: true,
  });
  for (const [user, template, version, at] of [
    ["maya", cashBack, cashBack.versions.v2, 86.5],
    ["maya", reminder, reminder.versions.v1, 51.5],
    ["priya", balanceTransfer, balanceTransfer.versions.v2, 47.5],
  ] as const) {
    note({
      user,
      kind: "version_live",
      facts: {
        actorName: userName(decision(version, "approved").actorId),
        ...releasedOf(version),
      },
      link: inCoral({ to: "template", templateId: template.id }),
      at,
      read: true,
    });
  }
  const revoked = rowOf(holiday.versions.v1).revoke!;
  note({
    user: "priya",
    kind: "version_revoked",
    facts: {
      actorName: userName(revoked.confirmedBy!),
      ...releasedOf(holiday.versions.v1),
    },
    body: revoked.reason,
    link: inCoral({ to: "versions", templateId: holiday.id }),
    at: 34.3,
    read: true,
  });
}
