// Teams. A team's slug comes from its name; it must be new (slug and name, case-insensitive) and not a
// route the app owns. The team starts with one member, its first Team Admin.

import type {
  AccessEffect,
  MembershipChange,
  Named,
  Ok,
  Refused,
} from "../access-types";
import { refuse, type Refusal } from "../refusals";
import type { PlatformRole } from "../types";
import { configChanged } from "./effects";
import {
  TEAM_NAME_MAX,
  TEAM_DESCRIPTION_MAX,
  TEAM_ICONS,
  RESERVED_SLUGS,
} from "./limits";
import { PLATFORM_REFUSALS } from "./refusals";

/** "Coral Offers" → "coral-offers"; "Café & Co." → "cafe-co". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** A new team as typed, tidied: the name with its spaces collapsed, the description trimmed, the slug. */
export interface NewTeamCheck {
  name: string;
  description: string;
  slug: string;
  /** The first reason `createTeam` refuses it, or null. */
  problem: Refusal | null;
}

/**
 * Checks a new team before it's created: a name of at most 60 characters, a description of at most
 * 200, an icon the picker offers, and a slug that's neither a route the app owns nor another team's
 * (slug or name, case-insensitive). The Create team form runs it as the admin types; `createTeam`
 * refuses with its problem.
 */
export function validateNewTeam(input: {
  name: string;
  description: string;
  icon: string;
  existing: readonly { slug: string; name: string }[];
}): NewTeamCheck {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  const slug = slugify(name);
  const problem = ((): Refusal | null => {
    if (!name) return PLATFORM_REFUSALS.teamName;
    if (name.length > TEAM_NAME_MAX) return PLATFORM_REFUSALS.teamNameTooLong;
    if (description.length > TEAM_DESCRIPTION_MAX)
      return PLATFORM_REFUSALS.descriptionTooLong;
    if (!(TEAM_ICONS as readonly string[]).includes(input.icon))
      return PLATFORM_REFUSALS.icon;
    if (!slug || RESERVED_SLUGS.has(slug))
      return PLATFORM_REFUSALS.reservedName(name);
    const taken = input.existing.find(
      (t) => t.slug === slug || t.name.toLowerCase() === name.toLowerCase(),
    );
    return taken ? PLATFORM_REFUSALS.teamTaken(taken.name) : null;
  })();
  return { name, description, slug, problem };
}

/** What creating the team does, said before it's confirmed. */
export function newTeamConsequences(name: string, adminName: string): string[] {
  return [
    `${adminName} becomes Team Admin of ${name} and approves its access requests.`,
    `${name} starts with no templates.`,
  ];
}

/**
 * Why `person` can't be a new team's first Team Admin, or null: the Auditor is read-only everywhere.
 * `createTeam` refuses with it, and the Create team form's picker offers only the people it returns
 * null for.
 */
export function cannotBeFirstTeamAdmin(
  person: Named & { platformRole: PlatformRole | null },
): Refusal | null {
  return person.platformRole === "auditor"
    ? PLATFORM_REFUSALS.auditorCantBeAdmin(person.name)
    : null;
}

/**
 * Creates a team with `admin` as its first Team Admin. `id` is the new team's id, drawn by the caller: opaque,
 * never the slug, which only the URL uses (decision 0053).
 */
export function createTeam(input: {
  id: string;
  name: string;
  description: string;
  icon: string;
  admin: Named & { platformRole: PlatformRole | null };
  actor: Named;
  now: Date;
  existing: { slug: string; name: string }[];
}):
  | Ok<{
      team: {
        id: string;
        slug: string;
        name: string;
        description: string;
        icon: string;
        createdAt: Date;
      };
      membership: MembershipChange;
      effects: AccessEffect[];
    }>
  | Refused {
  const { admin, actor, now } = input;
  const barred = cannotBeFirstTeamAdmin(admin);
  if (barred) return refuse(barred);
  const { name, description, slug, problem } = validateNewTeam(input);
  if (problem) return refuse(problem);

  const team = {
    id: input.id,
    slug,
    name,
    description,
    icon: input.icon,
    createdAt: now,
  };
  return {
    ok: true,
    team,
    membership: {
      kind: "insert",
      membership: {
        userId: admin.id,
        teamId: team.id,
        roles: ["team_admin"],
        addedAt: now,
        addedBy: actor.id,
      },
    },
    effects: [
      configChanged(
        "teams",
        team.id,
        `Created team ${name} with ${admin.name} as Team Admin`,
        {
          teamName: name,
          slug,
          userId: admin.id,
          userName: admin.name,
        },
      ),
      {
        kind: "audit",
        action: "access.granted",
        teamId: team.id,
        details: {
          userId: admin.id,
          userName: admin.name,
          role: "team_admin",
          roles: ["team_admin"],
          appointed: true,
        },
      },
      {
        kind: "notification",
        notification: "team_admin_appointed",
        to: { kind: "user", userId: admin.id },
        teamId: team.id,
        title: `${actor.name} made you Team Admin of ${name}.`,
        link: { to: "settings", teamId: team.id, section: "members" },
      },
    ],
  };
}
