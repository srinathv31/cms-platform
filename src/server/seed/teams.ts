import type { TeamRole } from "@/domain/types";
import type { SeedCtx } from "./context";
import { userName } from "./people";
import { platformConfigDetails } from "./platform";

export const TEAM_IDS = [
  "coral-offers",
  "deposits",
  "card-statements",
] as const;
export type TeamId = (typeof TEAM_IDS)[number];

const TEAMS: {
  id: TeamId;
  name: string;
  description: string;
  icon: string;
  createdDaysAgo: number;
  /** Who the team's push notifications and SMS come from (decision 0034): every seeded team has both. */
  appName: string;
  /** A fictional US short code, a word on a phone keypad: 26725 is CORAL, 33767 DEPOS, 22737 CARDS. */
  smsSender: string;
}[] = [
  {
    id: "coral-offers",
    name: "Coral Offers",
    description:
      "Card offer disclosures: balance transfers, cash back and promotional terms.",
    icon: "credit-card",
    createdDaysAgo: 420,
    appName: "Coral",
    smsSender: "26725",
  },
  {
    id: "deposits",
    name: "Deposits",
    description:
      "Savings and checking disclosures: rates, fees and account terms.",
    icon: "piggy-bank",
    createdDaysAgo: 395,
    appName: "Deposits Online",
    smsSender: "33767",
  },
  {
    id: "card-statements",
    name: "Card Statements",
    description:
      "Statement inserts: rate changes, enrollment notices and annual notices.",
    icon: "receipt-text",
    createdDaysAgo: 380,
    appName: "Card Center",
    smsSender: "22737",
  },
];

interface Member {
  user: string;
  team: TeamId;
  roles: TeamRole[];
  addedDaysAgo: number;
  addedBy: string;
  /** Days ago the 90-day inactivity flag was raised (people.ts sets their last sign-in). */
  flaggedDaysAgo?: number;
}

// Matches the persona table in the build plan. Morgan has no membership on purpose. Dana Park (Legal)
// views Coral Offers so a "Legal reviewer" stage that names her can be demoed (Phase 6).
export const MEMBERS: Member[] = [
  {
    user: "alex",
    team: "coral-offers",
    roles: ["team_admin", "approver"],
    addedDaysAgo: 400,
    addedBy: "riley",
  },
  {
    user: "jordan",
    team: "coral-offers",
    roles: ["approver"],
    addedDaysAgo: 380,
    addedBy: "alex",
  },
  {
    user: "maya",
    team: "coral-offers",
    roles: ["author"],
    addedDaysAgo: 370,
    addedBy: "alex",
  },
  {
    user: "priya",
    team: "coral-offers",
    roles: ["author"],
    addedDaysAgo: 340,
    addedBy: "alex",
  },
  {
    user: "sam",
    team: "coral-offers",
    roles: ["viewer"],
    addedDaysAgo: 300,
    addedBy: "alex",
  },
  // Last signed in 95 days ago: flagged 5 days ago, suspended automatically 25 days from now.
  {
    user: "devon",
    team: "coral-offers",
    roles: ["viewer"],
    addedDaysAgo: 250,
    addedBy: "alex",
    flaggedDaysAgo: 5,
  },
  {
    user: "dana",
    team: "coral-offers",
    roles: ["viewer"],
    addedDaysAgo: 60,
    addedBy: "alex",
  },

  {
    user: "naomi",
    team: "deposits",
    roles: ["team_admin", "approver"],
    addedDaysAgo: 380,
    addedBy: "riley",
  },
  {
    user: "eli",
    team: "deposits",
    roles: ["author"],
    addedDaysAgo: 370,
    addedBy: "naomi",
  },
  {
    user: "priya",
    team: "deposits",
    roles: ["viewer"],
    addedDaysAgo: 120,
    addedBy: "naomi",
  },

  {
    user: "hana",
    team: "card-statements",
    roles: ["team_admin", "approver"],
    addedDaysAgo: 360,
    addedBy: "riley",
  },
  {
    user: "marcus",
    team: "card-statements",
    roles: ["author"],
    addedDaysAgo: 350,
    addedBy: "hana",
  },
];

export function seedTeams(ctx: SeedCtx) {
  for (const t of TEAMS) {
    ctx.sink.teams.push({
      id: t.id,
      slug: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      createdAt: ctx.at(t.createdDaysAgo),
      appName: t.appName,
      smsSender: t.smsSender,
    });
    // As `createTeam` writes it: the team, and the person made its Team Admin.
    const admin = MEMBERS.find(
      (m) => m.team === t.id && m.roles.includes("team_admin"),
    );
    if (!admin) throw new Error(`Seed: ${t.id} has no Team Admin`);
    ctx.sink.auditEvents.push({
      id: ctx.id(`team:${t.id}`, "ae"),
      at: ctx.at(t.createdDaysAgo),
      actorId: "riley",
      teamId: t.id,
      action: "platform.config_changed",
      details: platformConfigDetails(
        "teams",
        `Created team ${t.name} with ${userName(admin.user)} as Team Admin`,
        {
          teamName: t.name,
          slug: t.id,
          userId: admin.user,
          userName: userName(admin.user),
        },
      ),
    });
  }

  for (const m of MEMBERS) {
    const id = ctx.id(`team:${m.team}`, "m");
    ctx.sink.memberships.push({
      id,
      userId: m.user,
      teamId: m.team,
      status: "active",
      addedAt: ctx.at(m.addedDaysAgo),
      addedBy: m.addedBy,
      statusChangedAt: null,
      statusReason: null,
      inactivityFlaggedAt:
        m.flaggedDaysAgo === undefined ? null : ctx.at(m.flaggedDaysAgo),
      inactivityKeptAt: null,
    });
    for (const role of m.roles)
      ctx.sink.membershipRoles.push({ membershipId: id, role });
    ctx.sink.auditEvents.push({
      id: ctx.id(`team:${m.team}`, "ae"),
      at: ctx.at(m.addedDaysAgo),
      actorId: m.addedBy,
      teamId: m.team,
      action: "access.granted",
      details: {
        userId: m.user,
        userName: userName(m.user),
        role: m.roles[0],
        roles: m.roles,
        // A team's first Team Admin is appointed when the team is created.
        ...(m.roles.includes("team_admin") ? { appointed: true } : {}),
      },
    });
  }
}

/** Who a recertification covers: the team's members, Team Admins aside (domain/access/recertification.ts `recertSubjects`). */
export const recertSubjectIds = (team: TeamId) =>
  MEMBERS.filter((m) => m.team === team && !m.roles.includes("team_admin"))
    .map((m) => m.user)
    .sort();

export const flaggedMembers = (team: TeamId) =>
  MEMBERS.filter((m) => m.team === team && m.flaggedDaysAgo !== undefined);
