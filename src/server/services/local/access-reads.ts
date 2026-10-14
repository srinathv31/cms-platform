import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DAY_MS } from "@/domain/dates";
import {
  currentRecert,
  recertPhase,
  recertProgress,
} from "@/domain/access/recertification";
import { heldAsLastAdmin } from "@/domain/access/consequences";
import { inactivity } from "@/domain/access/inactivity";
import {
  inactivityActions,
  memberActions,
  recertItemActions,
  requestActions,
  startRecertAction,
} from "@/domain/access/row-actions";
import {
  DECIDED_REQUESTS_WINDOW_DAYS,
  type AccessRequestFacts,
  type MembershipFacts,
} from "@/domain/access-types";
import { can, REASONS, spacesFor } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Action } from "@/domain/types";
import {
  loadMembershipFacts,
  loadRecertFacts,
  loadRequestFacts,
} from "./access-facts";
import { db } from "@/server/db/client";
import {
  accessRequests,
  auditEvents,
  memberships,
  recertifications,
  teams,
} from "@/server/db/schema/ucomp";
import type {
  AccessService,
  InactiveMemberFacts,
  MemberFacts,
  RecertMemberFacts,
  RequestFacts,
  SidebarCardFacts,
  TeamFacts,
} from "../access";
import { refusal, type ReadResult } from "../results";
import type { RequestContext } from "../types";
import type { LocalDeps } from "./command";
import { byName, loadUsers, named, peopleOf, titleOf } from "./users";

// Team access on this app's own database, the reads (src/server/services/access.ts says what each promises):
// the rows as stored, what the viewer may do on each (`can`, decided by src/domain/access/row-actions.ts), and
// what time decides at the instant they answer (`asOf`). Nothing here is worded: the BFF words the strips'
// consequences, a settled row's outcome and the cards.

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const STATUS_ORDER = { active: 0, suspended: 1, lapsed: 2 } as const;

export function localAccessReads(
  deps: LocalDeps,
): Pick<
  AccessService,
  | "requestAccessData"
  | "members"
  | "requests"
  | "recertification"
  | "inactivity"
  | "sidebarCards"
  | "homeCard"
> {
  /** A Team section's team, when it exists and the viewer holds `action` there. */
  async function teamSection(
    ctx: RequestContext,
    teamId: string,
    action: Action,
  ): Promise<ReadResult<{ team: TeamFacts }>> {
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
    });
    if (!team) return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
    if (!can(ctx.viewer, action, { teamId: team.id }).ok)
      return refusal(403, REASONS.generic);
    return {
      ok: true,
      team: { id: team.id, slug: team.slug, name: team.name },
    };
  }

  return {
    async requestAccessData(ctx) {
      const { viewer } = ctx;
      const all = await loadUsers();
      const teamRows = await db
        .select()
        .from(teams)
        .orderBy(teams.name, teams.id);
      const every = await loadMembershipFacts(db);
      const mine = every.filter((m) => m.userId === viewer.userId);

      const latest = new Map<string, AccessRequestFacts>();
      for (const r of await loadRequestFacts(
        db,
        eq(accessRequests.userId, viewer.userId),
      ))
        latest.set(r.teamId, r); // oldest first
      const requests = [...latest.values()].sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id),
      );

      const adminIds = (teamId: string) =>
        [
          ...new Set(
            every
              .filter(
                (m) =>
                  m.teamId === teamId &&
                  m.status === "active" &&
                  m.roles.includes("team_admin"),
              )
              .map((m) => m.userId),
          ),
        ].sort(byName(all));
      const ended = mine
        .filter(
          (m): m is MembershipFacts & { status: "lapsed" | "suspended" } =>
            m.status !== "active",
        )
        .sort(
          (a, b) =>
            (b.statusChangedAt?.getTime() ?? 0) -
            (a.statusChangedAt?.getTime() ?? 0),
        );

      const teamFacts = teamRows.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        description: t.description,
        icon: t.icon,
        adminIds: adminIds(t.id),
        myRoles:
          mine.find((m) => m.teamId === t.id && m.status === "active")?.roles ??
          [],
      }));
      return {
        ok: true,
        teams: teamFacts,
        requests: requests.map((r) => ({
          id: r.id,
          teamId: r.teamId,
          role: r.role,
          reason: r.reason,
          status: r.status,
          createdAt: iso(r.createdAt),
          decidedBy: r.decidedBy,
          decidedAt: isoOrNull(r.decidedAt),
          note: r.decisionNote,
        })),
        ended: ended.map((m) => ({
          teamId: m.teamId,
          status: m.status,
          reason: m.statusReason,
          at: iso(m.statusChangedAt ?? m.addedAt),
        })),
        people: peopleOf(all, [
          ...teamFacts.flatMap((t) => t.adminIds),
          ...requests.map((r) => r.decidedBy),
        ]),
      };
    },

    async members(ctx, { teamId }) {
      const section = await teamSection(ctx, teamId, "team.manageMembers");
      if (!section.ok) return section;
      const { team } = section;
      const now = await deps.clock();
      const all = await loadUsers();
      const teamMemberships = await loadMembershipFacts(
        db,
        eq(memberships.teamId, team.id),
      );

      const rows = teamMemberships
        .map((m): MemberFacts => {
          const user = all.get(m.userId);
          return {
            membershipId: m.id,
            userId: m.userId,
            title: user?.title ?? "",
            email: user?.email ?? "",
            roles: m.roles,
            status: m.status,
            statusReason: m.statusReason,
            statusChangedAt: isoOrNull(m.statusChangedAt),
            lastActiveAt: isoOrNull(m.lastActiveAt),
            addedAt: iso(m.addedAt),
            can: memberActions({
              viewer: ctx.viewer,
              membership: m,
              member: named(all, m.userId),
              team,
              now,
              teamMemberships,
            }),
          };
        })
        .sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            byName(all)(a.userId, b.userId),
        );
      return {
        ok: true,
        asOf: iso(now),
        team,
        rows,
        people: peopleOf(
          all,
          rows.map((r) => r.userId),
        ),
      };
    },

    async requests(ctx, { teamId }) {
      const section = await teamSection(
        ctx,
        teamId,
        "team.decideAccessRequest",
      );
      if (!section.ok) return section;
      const { team } = section;
      const now = await deps.clock();
      const all = await loadUsers();
      const requests = await loadRequestFacts(
        db,
        eq(accessRequests.teamId, team.id),
      ); // oldest first
      const since = now.getTime() - DECIDED_REQUESTS_WINDOW_DAYS * DAY_MS;

      const row = (r: AccessRequestFacts): RequestFacts => ({
        id: r.id,
        userId: r.userId,
        title: titleOf(all, r.userId),
        role: r.role,
        reason: r.reason,
        status: r.status,
        createdAt: iso(r.createdAt),
        decidedBy: r.decidedBy,
        decidedAt: isoOrNull(r.decidedAt),
        note: r.decisionNote,
        can: requestActions(ctx.viewer, team.id, r),
      });
      const pending = requests.filter((r) => r.status === "pending");
      const decided = requests
        .filter(
          (r) =>
            r.status !== "pending" &&
            r.decidedAt &&
            r.decidedAt.getTime() >= since &&
            r.decidedAt <= now,
        )
        .sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime());
      return {
        ok: true,
        asOf: iso(now),
        team,
        pending: pending.map(row),
        decided: decided.map(row),
        people: peopleOf(all, [
          ...[...pending, ...decided].flatMap((r) => [r.userId, r.decidedBy]),
        ]),
      };
    },

    async recertification(ctx, { teamId }) {
      const section = await teamSection(ctx, teamId, "team.manageMembers");
      if (!section.ok) return section;
      const { team } = section;
      const now = await deps.clock();
      const all = await loadUsers();
      const teamMemberships = await loadMembershipFacts(
        db,
        eq(memberships.teamId, team.id),
      );
      const recerts = await loadRecertFacts(
        db,
        eq(recertifications.teamId, team.id),
      );
      const r = currentRecert(recerts, now);

      let current = null;
      let lapsedIds: string[] = [];
      if (r) {
        const phase = recertPhase(r, now);
        // Who lapsed at this review's deadline: the sweep's audit rows name the review.
        const lapsedRows =
          phase === "closed"
            ? await db
                .select({ details: auditEvents.details })
                .from(auditEvents)
                .where(
                  and(
                    eq(auditEvents.teamId, team.id),
                    eq(auditEvents.action, "access.lapsed"),
                  ),
                )
            : [];
        lapsedIds = [
          ...new Set(
            lapsedRows
              .map(
                (x) =>
                  x.details as { recertId?: string; userId?: string } | null,
              )
              .filter(
                (d) => d?.recertId === r.id && typeof d.userId === "string",
              )
              .map((d) => d!.userId!),
          ),
        ].sort(byName(all));

        const items = r.items
          .map((i): RecertMemberFacts => {
            const m =
              teamMemberships.find((x) => x.userId === i.userId) ?? null;
            return {
              userId: i.userId,
              title: titleOf(all, i.userId),
              roles: m?.roles ?? [],
              lastActiveAt: isoOrNull(all.get(i.userId)?.lastActiveAt),
              decision: i.decision,
              decidedBy: i.decidedBy,
              decidedAt: isoOrNull(i.decidedAt),
              membership: m?.status ?? "removed",
              can: recertItemActions({
                viewer: ctx.viewer,
                recert: r,
                member: named(all, i.userId),
                team,
                now,
                teamMemberships,
              }),
            };
          })
          .sort((a, b) => byName(all)(a.userId, b.userId));
        current = {
          id: r.id,
          label: r.label,
          startsAt: iso(r.startsAt),
          dueAt: iso(r.dueAt),
          completedAt: isoOrNull(r.completedAt),
          phase,
          progress: recertProgress(r, teamMemberships),
          items,
          lapsedIds,
        };
      }

      return {
        ok: true,
        asOf: iso(now),
        team,
        current,
        can: {
          start: startRecertAction({
            viewer: ctx.viewer,
            team,
            now,
            teamMemberships,
            unfinished: recerts.filter((x) => x.completedAt === null),
          }),
        },
        people: peopleOf(all, [
          ...lapsedIds,
          ...(current?.items.flatMap((i) => [i.userId, i.decidedBy]) ?? []),
        ]),
      };
    },

    async inactivity(ctx, { teamId }) {
      const section = await teamSection(ctx, teamId, "team.manageMembers");
      if (!section.ok) return section;
      const { team } = section;
      const now = await deps.clock();
      const all = await loadUsers();
      const teamMemberships = await loadMembershipFacts(
        db,
        eq(memberships.teamId, team.id),
      );

      const row = (m: MembershipFacts): InactiveMemberFacts => {
        const idle = inactivity(m, now);
        return {
          membershipId: m.id,
          userId: m.userId,
          title: titleOf(all, m.userId),
          roles: m.roles,
          status: m.status,
          statusReason: m.statusReason,
          lastActiveAt: isoOrNull(m.lastActiveAt),
          addedAt: iso(m.addedAt),
          daysInactive: idle.daysInactive,
          // A suspended member's row shows when it happened.
          suspendsAt: iso(
            m.status === "suspended" && m.statusChangedAt
              ? m.statusChangedAt
              : idle.suspendAt,
          ),
          heldAsLastAdmin: heldAsLastAdmin(m, now),
          can: inactivityActions({
            viewer: ctx.viewer,
            membership: m,
            member: named(all, m.userId),
            team,
            now,
            teamMemberships,
          }),
        };
      };

      const flagged = teamMemberships
        .filter(
          (m) => m.status === "active" && inactivity(m, now).state !== "ok",
        )
        .map(row)
        .sort(
          (a, b) =>
            b.daysInactive - a.daysInactive || byName(all)(a.userId, b.userId),
        );
      const suspended = teamMemberships
        .filter(
          (m) =>
            m.status === "suspended" &&
            (m.statusReason === "inactivity" ||
              m.statusReason === "inactivity_auto"),
        )
        .sort(
          (a, b) =>
            (b.statusChangedAt?.getTime() ?? 0) -
            (a.statusChangedAt?.getTime() ?? 0),
        )
        .map(row);
      return {
        ok: true,
        asOf: iso(now),
        team,
        flagged,
        suspended,
        people: peopleOf(
          all,
          [...flagged, ...suspended].map((r) => r.userId),
        ),
      };
    },

    async sidebarCards(ctx) {
      const { viewer } = ctx;
      const now = await deps.clock();
      const asOf = iso(now);
      const teamRows = await db
        .select({ id: teams.id, slug: teams.slug, name: teams.name })
        .from(teams);
      const slugOf = (teamId: string) =>
        teamRows.find((t) => t.id === teamId)!.slug;
      const teamIds = spacesFor(viewer, teamRows).flatMap((s) =>
        s.teamId === null ? [] : [s.teamId],
      );
      const managed = teamIds.filter(
        (teamId) =>
          can(viewer, "team.decideAccessRequest", { teamId }).ok ||
          can(viewer, "team.manageMembers", { teamId }).ok,
      );
      if (managed.length === 0)
        return { ok: true, asOf, cards: [], people: [] };

      const all = await loadUsers();
      const pending = await loadRequestFacts(
        db,
        and(
          inArray(accessRequests.teamId, managed),
          eq(accessRequests.status, "pending"),
        ),
      );
      const recerts = await loadRecertFacts(
        db,
        inArray(recertifications.teamId, managed),
      );
      const allMemberships = await loadMembershipFacts(
        db,
        inArray(memberships.teamId, managed),
      );

      const cards: SidebarCardFacts[] = [];
      for (const teamId of managed) {
        // Requests the viewer may decide (never their own), newest first.
        const waiting = pending
          .filter((r) => r.teamId === teamId && r.userId !== viewer.userId)
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.id.localeCompare(a.id),
          );
        if (
          waiting.length &&
          can(viewer, "team.decideAccessRequest", { teamId }).ok
        ) {
          const newest = waiting[0]!;
          cards.push({
            kind: "access_requests",
            teamId,
            teamSlug: slugOf(teamId),
            newestRequestId: newest.id,
            count: waiting.length,
            requesterId: newest.userId,
            role: newest.role,
          });
          continue;
        }
        const open = recerts.find(
          (r) => r.teamId === teamId && recertPhase(r, now) === "open",
        );
        if (open && can(viewer, "team.manageMembers", { teamId }).ok) {
          const progress = recertProgress(
            open,
            allMemberships.filter((m) => m.teamId === teamId),
          );
          if (progress.pending > 0)
            cards.push({
              kind: "recert_due",
              teamId,
              teamSlug: slugOf(teamId),
              recertId: open.id,
              label: open.label,
              dueAt: iso(open.dueAt),
              progress,
            });
        }
      }
      return {
        ok: true,
        asOf,
        cards,
        people: peopleOf(
          all,
          cards.flatMap((c) =>
            c.kind === "access_requests" ? [c.requesterId] : [],
          ),
        ),
      };
    },

    async homeCard(ctx) {
      const { viewer } = ctx;
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
        .where(
          and(
            eq(accessRequests.userId, viewer.userId),
            eq(accessRequests.status, "pending"),
          ),
        )
        .orderBy(desc(accessRequests.createdAt), desc(accessRequests.id))
        .limit(1);
      if (!newest) return { ok: true, request: null, people: [] };
      // Who decides it: the team's active Team Admins, the first by name.
      const all = await loadUsers();
      const [adminId] = (
        await loadMembershipFacts(db, eq(memberships.teamId, newest.teamId))
      )
        .filter(
          (m) =>
            m.status === "active" &&
            m.roles.includes("team_admin") &&
            m.userId !== viewer.userId,
        )
        .map((m) => m.userId)
        .sort(byName(all));
      return {
        ok: true,
        request: {
          id: newest.id,
          teamName: newest.teamName,
          role: newest.role,
          createdAt: iso(newest.createdAt),
          adminId: adminId ?? null,
        },
        people: peopleOf(all, [adminId ?? null]),
      };
    },
  };
}
