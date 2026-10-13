import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { utcDay } from "@/domain/dates";
import {
  memberConsequences,
  recertFootnote,
  recertItemOutcome,
  recertProgressLabel,
  recertRemoveConsequence,
  requestConsequences,
  startRecertConsequence,
} from "@/domain/access/consequences";
import { firstName } from "@/domain/access/roles";
import {
  INACTIVITY_FLAG_DAYS,
  INACTIVITY_SUSPEND_DAYS,
  REQUESTABLE_ROLES,
} from "@/domain/access-types";
import type { Person } from "@/domain/review-types";
import { TEAM_ROLES } from "@/domain/types";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type {
  HomeCardFacts,
  InactiveMemberFacts,
  InactivityFacts,
  MemberFacts,
  MembersFacts,
  RecertificationFacts,
  RequestAccessFacts,
  RequestFacts,
  RequestsFacts,
  SidebarCardsFacts,
} from "@/server/services/access";
import type {
  AccessRequestRow,
  AccessRequestsSection,
  InactivityRow,
  InactivitySection,
  MemberRow,
  MembersSection,
  RecertificationSection,
  RecertItemRow,
  RecertView,
  RequestAccessData,
  SidebarCardModel,
} from "@/server/queries/access-models";
import { isoOrUndefined } from "./iso";
import { personOf, type People } from "./people";
import { requireSpace } from "./spaces";

// Read models for team access: the Request access page (anyone), the four Team sections of the settings modal
// (the team's Team Admins) and the sidebar cards. The facts and the decisions come from the access service
// (`services().access`, decision 0070): the rows as stored, what the viewer may do on each (`can`, decided),
// and what time decides at the instant the read names (`asOf`). These read models word and lay them out: each
// strip's `consequences`, how a settled row reads, a review's footnote, "4 of 6 confirmed", the cards' ids.
// They decide nothing and read no clock: every date is counted from the read's `asOf`.

const peopleMap = (list: readonly Person[]): People =>
  new Map(list.map((p) => [p.id, p]));

const named = (people: People, id: string) => {
  const { name } = personOf(people, id);
  return { id, name };
};

/** The Date a fact's ISO instant is, for the domain's wording functions. */
const date = (value: string | null): Date | null =>
  value === null ? null : new Date(value);

// ── Request access (/request-access) ─────────────────────────

/** Every team (with its Team Admins and the viewer's roles), the viewer's latest request per team, and ended access. */
export const getRequestAccessData = cache(
  async (): Promise<RequestAccessData> => {
    const ctx = await requireRequestContext();
    const facts = await services().access.requestAccessData(ctx);
    if (!facts.ok)
      throw new Error(
        `Request access refused a signed-in viewer: ${facts.code}`,
      );
    return requestAccessData(facts);
  },
);

/** The Request access page from the service's facts. */
export function requestAccessData(
  facts: RequestAccessFacts,
): RequestAccessData {
  const people = peopleMap(facts.people);
  const teamName = new Map(facts.teams.map((t) => [t.id, t.name]));
  return {
    teams: facts.teams.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      icon: t.icon,
      admins: t.adminIds.map((id) => personOf(people, id)),
      myRoles: t.myRoles,
    })),
    requests: facts.requests.map((r) => ({
      id: r.id,
      teamId: r.teamId,
      teamName: teamName.get(r.teamId) ?? r.teamId,
      role: r.role,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      decidedBy: r.decidedBy ? personOf(people, r.decidedBy) : undefined,
      decidedAt: isoOrUndefined(date(r.decidedAt)),
      note: r.note,
    })),
    ended: facts.ended.map((e) => ({
      teamId: e.teamId,
      teamName: teamName.get(e.teamId) ?? e.teamId,
      status: e.status,
      reason: e.reason,
      at: e.at,
    })),
    roles: REQUESTABLE_ROLES,
  };
}

// ── The Team sections ────────────────────────────────────────

/**
 * A Team section's space: the `[team]` segment resolved once (`requireSpace`), and its team's id for the service.
 * Not found for All teams, which has no members to manage.
 */
async function teamSpace(slug: string) {
  const space = await requireSpace(slug);
  if (space.teamId === null) notFound();
  return { ctx: await requireRequestContext(), teamId: space.teamId };
}

/** A section's facts, or Not found: a section the viewer may not read is not there (decision 0052). */
function orNotFound<T>(facts: ({ ok: true } & T) | { ok: false }): T {
  if (!facts.ok) notFound();
  return facts;
}

// ── Members ──────────────────────────────────────────────────

export const getMembersSection = cache(
  async (teamSlug: string): Promise<MembersSection> => {
    const { ctx, teamId } = await teamSpace(teamSlug);
    return membersSection(
      orNotFound(await services().access.members(ctx, { teamId })),
      ctx.viewer.userId,
    );
  },
);

/** The Members section from the service's facts: each row with its strips' lines. */
export function membersSection(
  facts: MembersFacts,
  viewerId: string,
): MembersSection {
  const people = peopleMap(facts.people);
  const now = new Date(facts.asOf);
  return {
    team: facts.team,
    rows: facts.rows.map((m): MemberRow => {
      const said = memberConsequences({
        membership: membershipOf(m),
        member: named(people, m.userId),
        team: facts.team,
        now,
      });
      return {
        membershipId: m.membershipId,
        person: personOf(people, m.userId),
        title: m.title,
        email: m.email,
        roles: m.roles,
        status: m.status,
        statusReason: m.statusReason,
        statusChangedAt: m.statusChangedAt,
        lastActiveAt: m.lastActiveAt,
        addedAt: m.addedAt,
        isYou: m.userId === viewerId,
        can: m.can,
        consequences: { remove: said.remove, reinstate: said.reinstate },
      };
    }),
    roles: TEAM_ROLES,
    today: utcDay(now),
  };
}

/** What `memberConsequences` reads of a membership. */
function membershipOf(
  m: Pick<MemberFacts, "roles" | "addedAt" | "lastActiveAt">,
) {
  return {
    roles: m.roles,
    addedAt: new Date(m.addedAt),
    lastActiveAt: date(m.lastActiveAt),
  };
}

// ── Access requests ──────────────────────────────────────────

export const getAccessRequestsSection = cache(
  async (teamSlug: string): Promise<AccessRequestsSection> => {
    const { ctx, teamId } = await teamSpace(teamSlug);
    return accessRequestsSection(
      orNotFound(await services().access.requests(ctx, { teamId })),
    );
  },
);

/** The Access requests section from the service's facts. */
export function accessRequestsSection(
  facts: RequestsFacts,
): AccessRequestsSection {
  const people = peopleMap(facts.people);
  const row = (r: RequestFacts): AccessRequestRow => ({
    id: r.id,
    person: personOf(people, r.userId),
    title: r.title,
    role: r.role,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    decidedBy: r.decidedBy ? personOf(people, r.decidedBy) : undefined,
    decidedAt: r.decidedAt ?? undefined,
    note: r.note,
    can: r.can,
    consequences: requestConsequences({
      requester: named(people, r.userId),
      role: r.role,
      team: facts.team,
    }),
  });
  return {
    team: facts.team,
    pending: facts.pending.map(row),
    decided: facts.decided.map(row),
    today: utcDay(facts.asOf),
  };
}

// ── Recertification ──────────────────────────────────────────

export const getRecertificationSection = cache(
  async (teamSlug: string): Promise<RecertificationSection> => {
    const { ctx, teamId } = await teamSpace(teamSlug);
    return recertificationSection(
      orNotFound(await services().access.recertification(ctx, { teamId })),
    );
  },
);

/** The Recertification section from the service's facts: the review's rows, outcomes and footnote. */
export function recertificationSection(
  facts: RecertificationFacts,
): RecertificationSection {
  const people = peopleMap(facts.people);
  const now = new Date(facts.asOf);
  const r = facts.current;

  let current: RecertView | null = null;
  if (r) {
    const recert = {
      startsAt: new Date(r.startsAt),
      dueAt: new Date(r.dueAt),
      completedAt: date(r.completedAt),
    };
    const lapsed = r.lapsedIds.map((id) => personOf(people, id));
    current = {
      id: r.id,
      label: r.label,
      startsAt: r.startsAt,
      dueAt: r.dueAt,
      completedAt: r.completedAt,
      phase: r.phase,
      progress: r.progress,
      items: r.items.map((i): RecertItemRow => {
        const decidedBy = i.decidedBy
          ? personOf(people, i.decidedBy)
          : undefined;
        return {
          userId: i.userId,
          person: personOf(people, i.userId),
          title: i.title,
          roles: i.roles,
          lastActiveAt: i.lastActiveAt,
          decision: i.decision,
          decidedBy,
          decidedAt: i.decidedAt ?? undefined,
          membership: i.membership,
          outcome: recertItemOutcome({
            item: { decision: i.decision, decidedAt: date(i.decidedAt) },
            decidedBy: decidedBy ?? null,
            membership: i.membership,
            recert,
            now,
          }),
          can: i.can,
          consequences: {
            remove: recertRemoveConsequence(
              named(people, i.userId),
              facts.team,
            ),
          },
        };
      }),
      lapsed,
      footnote: recertFootnote({ recert, lapsed, team: facts.team, now }),
    };
  }
  return {
    team: facts.team,
    current,
    can: facts.can,
    consequences: { start: startRecertConsequence(facts.team, now) },
    today: utcDay(now),
  };
}

// ── Inactivity ───────────────────────────────────────────────

export const getInactivitySection = cache(
  async (teamSlug: string): Promise<InactivitySection> => {
    const { ctx, teamId } = await teamSpace(teamSlug);
    return inactivitySection(
      orNotFound(await services().access.inactivity(ctx, { teamId })),
    );
  },
);

/** The Inactivity section from the service's facts: each row with its strips' lines. */
export function inactivitySection(facts: InactivityFacts): InactivitySection {
  const people = peopleMap(facts.people);
  const now = new Date(facts.asOf);
  const row = (m: InactiveMemberFacts): InactivityRow => {
    const said = memberConsequences({
      membership: membershipOf(m),
      member: named(people, m.userId),
      team: facts.team,
      now,
    });
    return {
      membershipId: m.membershipId,
      person: personOf(people, m.userId),
      title: m.title,
      roles: m.roles,
      lastActiveAt: m.lastActiveAt,
      daysInactive: m.daysInactive,
      suspendsAt: m.suspendsAt,
      status: m.status,
      statusReason: m.statusReason,
      heldAsLastAdmin: m.heldAsLastAdmin,
      can: m.can,
      consequences: {
        suspend: said.suspend,
        keep: said.keep,
        reinstate: said.reinstate,
      },
    };
  };
  return {
    team: facts.team,
    flagged: facts.flagged.map(row),
    suspended: facts.suspended.map(row),
    thresholds: {
      flagDays: INACTIVITY_FLAG_DAYS,
      suspendDays: INACTIVITY_SUSPEND_DAYS,
    },
    today: utcDay(now),
  };
}

// ── Sidebar cards ────────────────────────────────────────────

/**
 * The cards of the team spaces the viewer can switch to that have something to say, by team id: access requests
 * waiting (Team Admin), then a review open with members left to confirm (Team Admin). A team with nothing to say
 * has no entry. The id changes when the content does, so a dismissed card comes back for a new request.
 */
export const getSidebarCards = cache(
  async (): Promise<Record<string, SidebarCardModel>> => {
    const ctx = await requireRequestContext();
    const facts = await services().access.sidebarCards(ctx);
    if (!facts.ok)
      throw new Error(
        `The sidebar cards refused a signed-in viewer: ${facts.code}`,
      );
    return sidebarCards(facts);
  },
);

/** The cards from the service's facts, by team id. */
export function sidebarCards(
  facts: SidebarCardsFacts,
): Record<string, SidebarCardModel> {
  const people = peopleMap(facts.people);
  return Object.fromEntries(
    facts.cards.map((card): [string, SidebarCardModel] => [
      card.teamId,
      card.kind === "access_requests"
        ? {
            kind: "access_requests",
            id: `access-requests:${card.teamId}:${card.newestRequestId}:${card.count}`,
            teamSlug: card.teamSlug,
            count: card.count,
            firstName: firstName(personOf(people, card.requesterId).name),
            role: card.role,
          }
        : {
            kind: "recert_due",
            id: `recert:${card.recertId}`,
            teamSlug: card.teamSlug,
            label: card.label,
            dueAt: card.dueAt,
            progressLabel: recertProgressLabel(card.progress),
          },
    ]),
  );
}

/**
 * The card for a viewer with no space yet (Morgan on /request-access): their newest pending request.
 * Additive to the contract: `getShell` folds it in as `ShellData.homeCard`.
 */
export const getHomeCard = cache(async (): Promise<SidebarCardModel | null> => {
  const ctx = await requireRequestContext();
  const facts = await services().access.homeCard(ctx);
  if (!facts.ok)
    throw new Error(`The home card refused a signed-in viewer: ${facts.code}`);
  return homeCard(facts);
});

/** The home card from the service's facts. */
export function homeCard(facts: HomeCardFacts): SidebarCardModel | null {
  const { request } = facts;
  if (!request) return null;
  const people = peopleMap(facts.people);
  return {
    kind: "my_request",
    id: `my-request:${request.id}`,
    teamName: request.teamName,
    role: request.role,
    createdAt: request.createdAt,
    ...(request.adminId
      ? { adminName: personOf(people, request.adminId).name }
      : {}),
  };
}
