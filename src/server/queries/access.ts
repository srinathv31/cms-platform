import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  DAY_MS,
  changeRoles,
  decideRecertItem,
  firstName,
  heldAsLastAdmin,
  inactivity,
  keepInactive,
  memberConsequences,
  recertFootnote,
  recertItemOutcome,
  recertPhase,
  recertProgress,
  recertRemoveConsequence,
  reinstate,
  removeMember,
  requestConsequences,
  requestDecisionRefusal,
  startRecert,
  startRecertConsequence,
  suspendInactive,
} from "@/domain/access";
import {
  INACTIVITY_FLAG_DAYS,
  INACTIVITY_SUSPEND_DAYS,
  REQUESTABLE_ROLES,
  type AccessRequestFacts,
  type AccessRequestRow,
  type AccessRequestsSection,
  type InactivityRow,
  type InactivitySection,
  type MemberRow,
  type MembersSection,
  type MembershipFacts,
  type MyAccessRequest,
  type Named,
  type RecertFacts,
  type RecertificationSection,
  type RecertItemRow,
  type RecertView,
  type RequestAccessData,
  type SidebarCardModel,
} from "@/domain/access-types";
import { ALL_SPACE, assertCan, can, spacesFor } from "@/domain/permissions";
import type { Person } from "@/domain/review-types";
import { TEAM_ROLES, type PermissionResult, type Viewer } from "@/domain/types";
import { loadMembershipFacts, loadRecertFacts, loadRequestFacts } from "@/server/access-sweep";
import { db } from "@/server/db/client";
import { accessRequests, auditEvents, memberships, recertifications, teams, users } from "@/server/db/schema/ucomp";
import { getViewer } from "@/server/viewer";
import { demoNow } from "./dynamic";

// Read models for team access: the Request access page (anyone), the four Team sections of the
// settings modal (the team's Team Admins) and the sidebar cards. Every date is relative to the demo
// clock. `can` on each row is the domain's own answer, dry-run against the facts, so a disabled
// control carries the exact sentence the action would refuse with; `consequences` are the domain's
// lines for each action's strip, so the screens word nothing themselves.

const DECIDED_WINDOW_DAYS = 30;

// ── Shared ────────────────────────────────────────────────────

interface UserInfo extends Person {
  title: string;
  email: string;
  lastActiveAt: Date | null;
}

const getUsers = cache(async (): Promise<ReadonlyMap<string, UserInfo>> => {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      initials: users.initials,
      hue: users.avatarHue,
      title: users.title,
      email: users.email,
      lastActiveAt: users.lastActiveAt,
    })
    .from(users);
  return new Map(rows.map((r) => [r.id, r]));
});

function userOf(people: ReadonlyMap<string, UserInfo>, id: string): UserInfo {
  return (
    people.get(id) ?? {
      id,
      name: id,
      initials: id.slice(0, 2).toUpperCase(),
      hue: 0,
      title: "",
      email: "",
      lastActiveAt: null,
    }
  );
}

const personOf = (people: ReadonlyMap<string, UserInfo>, id: string): Person => {
  const { id: uid, name, initials, hue } = userOf(people, id);
  return { id: uid, name, initials, hue };
};

const named = (p: { id: string; name: string }): Named => ({ id: p.id, name: p.name });
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const isoOrUndefined = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);
const today = (d: Date) => d.toISOString().slice(0, 10);
const okOr = (r: { ok: true } | { ok: false; reason: string }): PermissionResult =>
  r.ok ? { ok: true } : { ok: false, reason: r.reason };
const okUnless = (reason: string | null): PermissionResult => (reason ? { ok: false, reason } : { ok: true });

/** The team behind a space slug (team ids are their slugs). 404 for an unknown one or "all". */
async function teamBySlug(slug: string) {
  if (slug === ALL_SPACE) notFound();
  const team = await db.query.teams.findFirst({ where: eq(teams.slug, slug) });
  if (!team) notFound();
  return team;
}

/** A Team section: the viewer must manage the team's members (Team Admin). Throws `PermissionError`. */
async function teamSection(slug: string, action: "team.manageMembers" | "team.decideAccessRequest" = "team.manageMembers") {
  const viewer = await getViewer();
  const team = await teamBySlug(slug);
  assertCan(viewer, action, { teamId: team.id });
  const nowDate = await demoNow();
  const people = await getUsers();
  return { viewer, team, nowDate, people, header: { id: team.id, slug: team.slug, name: team.name } };
}

/** `can(viewer, "team.manageMembers")` on a member, then the domain's own answer. */
function manage(viewer: Viewer, teamId: string, subjectUserId: string, domain: () => PermissionResult): PermissionResult {
  const allowed = can(viewer, "team.manageMembers", { teamId, subjectUserId });
  return allowed.ok ? domain() : allowed;
}

// ── Request access (/request-access) ─────────────────────────

function myRequest(r: AccessRequestFacts, teamName: string, people: ReadonlyMap<string, UserInfo>): MyAccessRequest {
  return {
    id: r.id,
    teamId: r.teamId,
    teamName,
    role: r.role,
    reason: r.reason,
    status: r.status,
    createdAt: iso(r.createdAt),
    decidedBy: r.decidedBy ? personOf(people, r.decidedBy) : undefined,
    decidedAt: isoOrUndefined(r.decidedAt),
    note: r.decisionNote,
  };
}

/** Every team (with its Team Admins and the viewer's roles), the viewer's latest request per team, and ended access. */
export const getRequestAccessData = cache(async (): Promise<RequestAccessData> => {
  const viewer = await getViewer();
  const people = await getUsers();
  const teamRows = await db.select().from(teams).orderBy(teams.name);
  const all = await loadMembershipFacts(db);
  const nameOf = new Map(teamRows.map((t) => [t.id, t.name]));
  const mine = all.filter((m) => m.userId === viewer.userId);

  const latest = new Map<string, AccessRequestFacts>();
  for (const r of await loadRequestFacts(db, eq(accessRequests.userId, viewer.userId))) latest.set(r.teamId, r); // oldest first
  const requests = [...latest.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
    .map((r) => myRequest(r, nameOf.get(r.teamId) ?? r.teamId, people));

  return {
    teams: teamRows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      icon: t.icon,
      admins: all
        .filter((m) => m.teamId === t.id && m.status === "active" && m.roles.includes("team_admin"))
        .map((m) => personOf(people, m.userId))
        .sort((a, b) => a.name.localeCompare(b.name)),
      myRoles: mine.find((m) => m.teamId === t.id && m.status === "active")?.roles ?? [],
    })),
    requests,
    ended: mine
      .filter((m): m is MembershipFacts & { status: "lapsed" | "suspended" } => m.status !== "active")
      .sort((a, b) => (b.statusChangedAt?.getTime() ?? 0) - (a.statusChangedAt?.getTime() ?? 0))
      .map((m) => ({
        teamId: m.teamId,
        teamName: nameOf.get(m.teamId) ?? m.teamId,
        status: m.status,
        reason: m.statusReason,
        at: iso(m.statusChangedAt ?? m.addedAt),
      })),
    roles: REQUESTABLE_ROLES,
  };
});

// ── Members ──────────────────────────────────────────────────

const STATUS_ORDER = { active: 0, suspended: 1, lapsed: 2 } as const;

export const getMembersSection = cache(async (teamSlug: string): Promise<MembersSection> => {
  const { viewer, team, nowDate, people, header } = await teamSection(teamSlug);
  const teamMemberships = await loadMembershipFacts(db, eq(memberships.teamId, team.id));
  const actor = { id: viewer.userId, name: viewer.name };

  const rows = teamMemberships.map((m): MemberRow => {
    const user = userOf(people, m.userId);
    const input = { membership: m, member: named(user), team: named(team), actor, now: nowDate, teamMemberships };
    const said = memberConsequences(input);
    return {
      membershipId: m.id,
      person: personOf(people, m.userId),
      title: user.title,
      email: user.email,
      roles: m.roles,
      status: m.status,
      statusReason: m.statusReason,
      statusChangedAt: isoOrNull(m.statusChangedAt),
      lastActiveAt: isoOrNull(m.lastActiveAt),
      addedAt: iso(m.addedAt),
      isYou: m.userId === viewer.userId,
      can: {
        // Which roles is the editor's choice: here, only whether this member's roles can change at all.
        editRoles: manage(viewer, team.id, m.userId, () => okOr(changeRoles({ ...input, roles: m.roles }))),
        remove: manage(viewer, team.id, m.userId, () => okOr(removeMember(input))),
        reinstate: manage(viewer, team.id, m.userId, () => okOr(reinstate(input))),
      },
      consequences: { remove: said.remove, reinstate: said.reinstate },
    };
  });
  rows.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.person.name.localeCompare(b.person.name),
  );
  return { team: header, rows, roles: TEAM_ROLES, today: today(nowDate) };
});

// ── Access requests ──────────────────────────────────────────

export const getAccessRequestsSection = cache(async (teamSlug: string): Promise<AccessRequestsSection> => {
  const { viewer, team, nowDate, people, header } = await teamSection(teamSlug, "team.decideAccessRequest");
  const requests = await loadRequestFacts(db, eq(accessRequests.teamId, team.id)); // oldest first
  const actor = { id: viewer.userId, name: viewer.name };
  const since = nowDate.getTime() - DECIDED_WINDOW_DAYS * DAY_MS;

  const row = (r: AccessRequestFacts): AccessRequestRow => {
    const user = userOf(people, r.userId);
    const allowed = can(viewer, "team.decideAccessRequest", { teamId: team.id, requesterId: r.userId });
    return {
      id: r.id,
      person: personOf(people, r.userId),
      title: user.title,
      role: r.role,
      reason: r.reason,
      status: r.status,
      createdAt: iso(r.createdAt),
      decidedBy: r.decidedBy ? personOf(people, r.decidedBy) : undefined,
      decidedAt: isoOrUndefined(r.decidedAt),
      note: r.decisionNote,
      can: { decide: allowed.ok ? okUnless(requestDecisionRefusal(r, actor)) : allowed },
      consequences: requestConsequences({ requester: named(user), role: r.role, team: named(team) }),
    };
  };

  return {
    team: header,
    pending: requests.filter((r) => r.status === "pending").map(row),
    decided: requests
      .filter((r) => r.status !== "pending" && r.decidedAt && r.decidedAt.getTime() >= since && r.decidedAt <= nowDate)
      .sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())
      .map(row),
  };
});

// ── Recertification ──────────────────────────────────────────

/** The open (or upcoming) review; else the most recent one. */
function pickCurrent(recerts: readonly RecertFacts[], nowDate: Date): RecertFacts | null {
  const live = recerts.filter((r) => recertPhase(r, nowDate) !== "closed");
  if (live.length) return live[0]!; // earliest start first
  return [...recerts].sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime())[0] ?? null;
}

export const getRecertificationSection = cache(async (teamSlug: string): Promise<RecertificationSection> => {
  const { viewer, team, nowDate, people, header } = await teamSection(teamSlug);
  const teamMemberships = await loadMembershipFacts(db, eq(memberships.teamId, team.id));
  const recerts = await loadRecertFacts(db, eq(recertifications.teamId, team.id));
  const actor = { id: viewer.userId, name: viewer.name };
  const r = pickCurrent(recerts, nowDate);

  let current: RecertView | null = null;
  if (r) {
    const phase = recertPhase(r, nowDate);
    // Who lapsed at this review's deadline: the sweep's audit rows name the review.
    const lapsedRows =
      phase === "closed"
        ? await db
            .select({ details: auditEvents.details })
            .from(auditEvents)
            .where(and(eq(auditEvents.teamId, team.id), eq(auditEvents.action, "access.lapsed")))
        : [];
    const lapsedIds = lapsedRows
      .map((x) => x.details as { recertId?: string; userId?: string } | null)
      .filter((d) => d?.recertId === r.id && typeof d.userId === "string")
      .map((d) => d!.userId!);

    const items = r.items.map((i): RecertItemRow => {
      const user = userOf(people, i.userId);
      const m = teamMemberships.find((x) => x.userId === i.userId) ?? null;
      const decidedBy = i.decidedBy ? personOf(people, i.decidedBy) : undefined;
      return {
        userId: i.userId,
        person: personOf(people, i.userId),
        title: user.title,
        roles: m?.roles ?? [],
        lastActiveAt: isoOrNull(user.lastActiveAt),
        decision: i.decision,
        decidedBy,
        decidedAt: isoOrUndefined(i.decidedAt),
        membership: m?.status ?? "removed",
        outcome: recertItemOutcome({
          item: i,
          decidedBy: decidedBy ?? null,
          membership: m?.status ?? "removed",
          recert: r,
          now: nowDate,
        }),
        can: {
          decide: manage(viewer, team.id, i.userId, () =>
            okOr(
              decideRecertItem({
                recert: r,
                userId: i.userId,
                member: named(user),
                team: named(team),
                actor,
                decision: "keep",
                now: nowDate,
                teamMemberships,
              }),
            ),
          ),
        },
        consequences: { remove: recertRemoveConsequence(named(user), named(team)) },
      };
    });
    items.sort((a, b) => a.person.name.localeCompare(b.person.name));
    const lapsed = [...new Set(lapsedIds)].map((id) => personOf(people, id)).sort((a, b) => a.name.localeCompare(b.name));

    current = {
      id: r.id,
      label: r.label,
      startsAt: iso(r.startsAt),
      dueAt: iso(r.dueAt),
      completedAt: isoOrNull(r.completedAt),
      phase,
      progress: recertProgress(r, teamMemberships),
      items,
      lapsed,
      footnote: recertFootnote({ recert: r, lapsed, team: named(team), now: nowDate }),
    };
  }

  const allowed = can(viewer, "team.manageMembers", { teamId: team.id });
  const start = allowed.ok
    ? okOr(
        startRecert({
          team: named(team),
          actor,
          now: nowDate,
          memberships: teamMemberships,
          unfinished: recerts.filter((x) => x.completedAt === null),
        }),
      )
    : allowed;
  return {
    team: header,
    current,
    can: { start },
    consequences: { start: startRecertConsequence(named(team), nowDate) },
    today: today(nowDate),
  };
});

// ── Inactivity ───────────────────────────────────────────────

export const getInactivitySection = cache(async (teamSlug: string): Promise<InactivitySection> => {
  const { viewer, team, nowDate, people, header } = await teamSection(teamSlug);
  const teamMemberships = await loadMembershipFacts(db, eq(memberships.teamId, team.id));
  const actor = { id: viewer.userId, name: viewer.name };

  const row = (m: MembershipFacts): InactivityRow => {
    const user = userOf(people, m.userId);
    const idle = inactivity(m, nowDate);
    const input = { membership: m, member: named(user), team: named(team), actor, now: nowDate, teamMemberships };
    const said = memberConsequences(input);
    return {
      membershipId: m.id,
      person: personOf(people, m.userId),
      title: user.title,
      roles: m.roles,
      lastActiveAt: isoOrNull(m.lastActiveAt),
      daysInactive: idle.daysInactive,
      // A suspended member's row shows when it happened.
      suspendsAt: iso(m.status === "suspended" && m.statusChangedAt ? m.statusChangedAt : idle.suspendAt),
      status: m.status,
      statusReason: m.statusReason,
      heldAsLastAdmin: heldAsLastAdmin(m, nowDate),
      can: {
        suspend: manage(viewer, team.id, m.userId, () => okOr(suspendInactive(input))),
        keep: manage(viewer, team.id, m.userId, () => okOr(keepInactive(input))),
        reinstate: manage(viewer, team.id, m.userId, () => okOr(reinstate(input))),
      },
      consequences: { suspend: said.suspend, keep: said.keep, reinstate: said.reinstate },
    };
  };

  return {
    team: header,
    flagged: teamMemberships
      .filter((m) => m.status === "active" && inactivity(m, nowDate).state !== "ok")
      .map(row)
      .sort((a, b) => b.daysInactive - a.daysInactive || a.person.name.localeCompare(b.person.name)),
    suspended: teamMemberships
      .filter(
        (m) => m.status === "suspended" && (m.statusReason === "inactivity" || m.statusReason === "inactivity_auto"),
      )
      .sort((a, b) => (b.statusChangedAt?.getTime() ?? 0) - (a.statusChangedAt?.getTime() ?? 0))
      .map(row),
    thresholds: { flagDays: INACTIVITY_FLAG_DAYS, suspendDays: INACTIVITY_SUSPEND_DAYS },
  };
});

// ── Sidebar cards ────────────────────────────────────────────

/**
 * One card per space the viewer can switch to, by priority: access requests waiting (Team Admin),
 * then a review open with members left to confirm (Team Admin). null when there's nothing to say.
 * The id changes when the content does, so a dismissed card comes back for a new request.
 */
export const getSidebarCards = cache(async (): Promise<Record<string, SidebarCardModel | null>> => {
  const viewer = await getViewer();
  const teamRows = await db.select({ slug: teams.slug, name: teams.name }).from(teams);
  const spaces = spacesFor(viewer, teamRows);
  const cards: Record<string, SidebarCardModel | null> = Object.fromEntries(spaces.map((s) => [s.slug, null]));
  const managed = spaces
    .filter((s) => s.kind === "team")
    .map((s) => s.slug)
    .filter(
      (teamId) =>
        can(viewer, "team.decideAccessRequest", { teamId }).ok || can(viewer, "team.manageMembers", { teamId }).ok,
    );
  if (managed.length === 0) return cards;

  const nowDate = await demoNow();
  const people = await getUsers();
  const pending = await loadRequestFacts(
    db,
    and(inArray(accessRequests.teamId, managed), eq(accessRequests.status, "pending")),
  );
  const recerts = await loadRecertFacts(db, inArray(recertifications.teamId, managed));
  const allMemberships = await loadMembershipFacts(db, inArray(memberships.teamId, managed));

  for (const teamId of managed) {
    // Requests the viewer may decide (never their own), newest first.
    const waiting = pending
      .filter((r) => r.teamId === teamId && r.userId !== viewer.userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    if (waiting.length && can(viewer, "team.decideAccessRequest", { teamId }).ok) {
      const newest = waiting[0]!;
      cards[teamId] = {
        kind: "access_requests",
        id: `access-requests:${teamId}:${newest.id}:${waiting.length}`,
        teamSlug: teamId,
        count: waiting.length,
        firstName: firstName(userOf(people, newest.userId).name),
        role: newest.role,
      };
      continue;
    }
    const open = recerts.find((r) => r.teamId === teamId && recertPhase(r, nowDate) === "open");
    if (open && can(viewer, "team.manageMembers", { teamId }).ok) {
      const progress = recertProgress(open, allMemberships.filter((m) => m.teamId === teamId));
      if (progress.pending > 0) {
        cards[teamId] = {
          kind: "recert_due",
          id: `recert:${open.id}`,
          teamSlug: teamId,
          label: open.label,
          dueAt: iso(open.dueAt),
          progressLabel: progress.label,
        };
      }
    }
  }
  return cards;
});

/**
 * The card for a viewer with no space yet (Morgan on /request-access): their newest pending request.
 * Additive to the contract: `getShell` folds it in as `ShellData.homeCard`.
 */
export const getHomeCard = cache(async (): Promise<SidebarCardModel | null> => {
  const viewer = await getViewer();
  const [newest] = await db
    .select({
      id: accessRequests.id,
      role: accessRequests.role,
      createdAt: accessRequests.createdAt,
      teamId: accessRequests.teamId,
      teamName: teams.name,
    })
    .from(accessRequests)
    .innerJoin(teams, eq(teams.id, accessRequests.teamId))
    .where(and(eq(accessRequests.userId, viewer.userId), eq(accessRequests.status, "pending")))
    .orderBy(desc(accessRequests.createdAt), desc(accessRequests.id))
    .limit(1);
  if (!newest) return null;
  // Who decides it: the team's active Team Admins, the first by name ("waiting on Alex Kim").
  const people = await getUsers();
  const [admin] = (await loadMembershipFacts(db, eq(memberships.teamId, newest.teamId)))
    .filter((m) => m.status === "active" && m.roles.includes("team_admin") && m.userId !== viewer.userId)
    .map((m) => userOf(people, m.userId).name)
    .sort((a, b) => a.localeCompare(b));
  return {
    kind: "my_request",
    id: `my-request:${newest.id}`,
    teamName: newest.teamName,
    role: newest.role,
    createdAt: iso(newest.createdAt),
    ...(admin ? { adminName: admin } : {}),
  };
});
