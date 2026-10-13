// The bell's notifications, worded when they are read (decision 0055). Pure TypeScript.
//
// A notification row stores what happened, never a sentence or an app URL: its kind, the kind's facts (ids,
// numbers, instants, and names as they were), a link descriptor that names its team by id, and, as its body,
// only a person's own words (a submit note, a reason, a comment). The facts each kind stores are declared beside
// its kind: `NotificationFacts` (review-types.ts) for the lifecycle, `AccessNotificationFacts`
// (access-types.ts) for access. The writers are typed against them.
//
// `describeNotification` words a stored notification for the person reading it. A row is JSON from the backend,
// so it is read defensively, as audit details are (audit.ts): when the facts lack what the kind's sentence
// needs, the kind's plain sentence stands in, and a kind this code doesn't know yet reads as a generic one.
// The href is the BFF's (src/server/notification-href.ts): it needs the app's routes and the team's slug.

import { ROLE_LABEL, rolesLabel } from "./access/roles";
import { quarterLabel } from "./access/recertification";
import {
  INACTIVITY_FLAG_DAYS,
  type AccessLink,
  type AccessNotificationFacts,
  type AnyNotificationKind,
} from "./access-types";
import { formatLongDate, isCalendarDay } from "./dates";
import { plural } from "./plural";
import type { NotificationFacts, PlacedNotificationLink } from "./review-types";
import { versionLabel } from "./rounds";
import {
  TEAM_ROLES,
  VERSION_STATES,
  type TeamRole,
  type VersionState,
} from "./types";

// ── The kinds ───────────────────────────────────────────────────────────────

/** Every kind the bell knows, lifecycle (Phase 4) then access (Phase 6). */
export const NOTIFICATION_KINDS = [
  "review_requested",
  "changes_requested",
  "stage_approved",
  "version_live",
  "comment_added",
  "revoke_started",
  "version_revoked",
  "sunset_scheduled",
  "access_requested",
  "access_granted",
  "access_denied",
  "roles_changed",
  "access_removed",
  "access_lapsed",
  "access_suspended",
  "inactivity_flagged",
  "recert_due",
  "team_admin_appointed",
] as const satisfies readonly AnyNotificationKind[];

// Fails to compile when a kind is added to AnyNotificationKind but not listed above.
type MissingKind = Exclude<
  AnyNotificationKind,
  (typeof NOTIFICATION_KINDS)[number]
>;
const allKindsListed: MissingKind extends never ? true : MissingKind = true;
void allKindsListed;

export function isNotificationKind(kind: string): kind is AnyNotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

/** The facts a kind stores, lifecycle or access. */
export type NotificationFactsOf<K extends AnyNotificationKind> =
  (NotificationFacts & AccessNotificationFacts)[K];

/**
 * What a notification row stores as its link: a lifecycle link placed in the space it opens in, or an access
 * link. Ids only: the BFF builds the href with the team's slug when it reads the row (decision 0053).
 */
export type StoredNotificationLink = PlacedNotificationLink | AccessLink;

// ── Wording ─────────────────────────────────────────────────────────────────

/** A notification as its reader sees it: one sentence, and a second line when the facts word one. */
export interface NotificationWords {
  title: string;
  /** Worded from the facts ("Next: Legal."); null when the kind has none. A person's own words are the row's `body`. */
  body: string | null;
}

/**
 * The sentence (and the second line) a stored notification shows to `readerId`. The facts are the kind's
 * (`NotificationFacts`, `AccessNotificationFacts`); one about a member (`userId`) reads "Your access…" to that
 * member and "Devon Lin's access…" to anyone else. When the facts lack what the sentence needs, the kind's plain
 * sentence ("A version is waiting for your review."); for a kind this code doesn't know, a generic one.
 */
export function describeNotification(
  kind: string,
  facts: Record<string, unknown> | null,
  readerId: string,
): NotificationWords {
  const f = facts ?? {};
  if (!isNotificationKind(kind)) return words(GENERIC);
  return (
    SENTENCES[kind](f, readerId) ??
    words(FALLBACKS[kind](text(f.teamName) ?? "your team"))
  );
}

const GENERIC = "Something changed in Stencil.";

type Facts = Record<string, unknown>;
type Sentence = (f: Facts, readerId: string) => NotificationWords | null;

const SENTENCES: Record<AnyNotificationKind, Sentence> = {
  review_requested: (f) => {
    const named = roundNamed(f, "in_review");
    const stage = text(f.stage);
    if (named && stage) return words(`${named} is waiting on ${stage}.`);
    const actor = text(f.actorName);
    return named && actor
      ? words(`${actor} submitted ${named} for review.`)
      : null;
  },

  stage_approved: (f) => {
    const named = roundNamed(f, "in_review");
    const [actor, stage, next] = [f.actorName, f.stage, f.next].map(text);
    return named && actor && stage && next
      ? words(`${actor} approved ${named} for ${stage}.`, `Next: ${next}.`)
      : null;
  },

  version_live: (f) => {
    const named = releasedNamed(f);
    const actor = text(f.actorName);
    return named && actor
      ? words(`${named} is now Active.`, `${actor} approved it.`)
      : null;
  },

  changes_requested: (f) => {
    const named = roundNamed(f, "changes_requested");
    const actor = text(f.actorName);
    return named && actor
      ? words(`${actor} requested changes on ${named}.`)
      : null;
  },

  comment_added: (f) => {
    const actor = text(f.actorName);
    const name = text(f.templateName);
    if (!actor || !name || typeof f.reply !== "boolean") return null;
    const number = whole(f.number);
    const round = whole(f.round);
    const state = stateOf(f.state);
    let on: string;
    if (f.number === null) on = `the draft of ${name}`;
    else if (number !== null && round !== null && state !== null)
      on = `${name} ${versionLabel({ number, round, state }, { style: "sentence" })}`;
    else return null;
    return words(`${actor} ${f.reply ? "replied" : "commented"} on ${on}.`);
  },

  revoke_started: (f) => {
    const named = releasedNamed(f);
    const actor = text(f.actorName);
    return named && actor
      ? words(`${actor} started revoking ${named}. Confirm or cancel.`)
      : null;
  },

  version_revoked: (f) => {
    const named = releasedNamed(f);
    const actor = text(f.actorName);
    return named && actor
      ? words(`${actor} confirmed the revoke of ${named}.`)
      : null;
  },

  sunset_scheduled: (f) => {
    const named = releasedNamed(f);
    const day = typeof f.sunsetDay === "string" ? f.sunsetDay : "";
    return named && isCalendarDay(day)
      ? words(`${named} will stop rendering on ${formatLongDate(day)}.`)
      : null;
  },

  access_requested: (f) => {
    const [actor, team] = [f.actorName, f.teamName].map(text);
    const role = roleOf(f.role);
    return actor && team && role
      ? words(`${actor} asked for ${ROLE_LABEL[role]} access to ${team}.`)
      : null;
  },

  access_granted: (f) => {
    const [actor, team] = [f.actorName, f.teamName].map(text);
    if (!actor || !team) return null;
    // Absent: a suspended or lapsed member was restored with their roles.
    if (f.role === undefined)
      return words(`${actor} restored your access to ${team}.`);
    const role = roleOf(f.role);
    return role
      ? words(`${actor} approved your ${ROLE_LABEL[role]} access to ${team}.`)
      : null;
  },

  access_denied: (f) => {
    const [actor, team] = [f.actorName, f.teamName].map(text);
    const role = roleOf(f.role);
    return actor && team && role
      ? words(
          `${actor} declined your request for ${ROLE_LABEL[role]} access to ${team}.`,
        )
      : null;
  },

  roles_changed: (f) => {
    const [actor, team] = [f.actorName, f.teamName].map(text);
    const roles = rolesOf(f.roles);
    return actor && team && roles
      ? words(`${actor} changed your roles on ${team} to ${rolesLabel(roles)}.`)
      : null;
  },

  access_removed: (f) => {
    const [actor, team] = [f.actorName, f.teamName].map(text);
    if (!team) return null;
    if (f.recertDueAt !== undefined) {
      const due = instant(f.recertDueAt);
      return due
        ? words(
            `Your access to ${team} was removed in the ${quarterLabel(due)} access review.`,
          )
        : null;
    }
    return actor ? words(`${actor} removed your access to ${team}.`) : null;
  },

  access_lapsed: (f, readerId) => {
    const [user, team] = [f.userName, f.teamName].map(text);
    const due = instant(f.dueAt);
    if (!user || !team || !due) return null;
    const by = formatLongDate(due);
    return f.userId === readerId
      ? words(`Your access to ${team} lapsed: it wasn't recertified by ${by}.`)
      : words(
          `${possessive(user)} access to ${team} lapsed: not recertified by ${by}.`,
        );
  },

  access_suspended: (f, readerId) => {
    const [user, team] = [f.userName, f.teamName].map(text);
    const days = whole(f.daysInactive);
    if (!user || !team || days === null) return null;
    const idle = `after ${plural(days, "day")} without a sign-in`;
    const actor = text(f.actorName);
    const whose =
      f.userId === readerId ? "your access" : `${possessive(user)} access`;
    return actor
      ? words(`${actor} suspended ${whose} to ${team} ${idle}.`)
      : words(`${capitalize(whose)} to ${team} was suspended ${idle}.`);
  },

  inactivity_flagged: (f) => {
    const [user, team] = [f.userName, f.teamName].map(text);
    if (!user || !team) return null;
    if (f.keptLastAdmin === true) {
      const days = whole(f.daysInactive);
      return days === null
        ? null
        : words(
            `${user} hasn't signed in for ${plural(days, "day")}, but as the last Team Admin of ${team} their access stays on.`,
          );
    }
    const suspends = instant(f.suspendsAt);
    return suspends
      ? words(
          `${user} hasn't signed in for ${INACTIVITY_FLAG_DAYS} days.`,
          `Access to ${team} is suspended automatically on ${formatLongDate(suspends)}.`,
        )
      : null;
  },

  recert_due: (f) => {
    const team = text(f.teamName);
    const due = instant(f.dueAt);
    if (!team || !due) return null;
    if (f.keptLastAdmin === true) {
      const user = text(f.userName);
      return user
        ? words(
            `${user} wasn't recertified by ${formatLongDate(due)}, but as the last Team Admin of ${team} their access stays on.`,
          )
        : null;
    }
    const members = whole(f.members);
    return members === null
      ? null
      : words(
          `${quarterLabel(due)} access review for ${team} is due ${formatLongDate(due)}.`,
          `Confirm ${plural(members, "member")}.`,
        );
  },

  team_admin_appointed: (f) => {
    const [actor, team] = [f.actorName, f.teamName].map(text);
    return actor && team
      ? words(`${actor} made you Team Admin of ${team}.`)
      : null;
  },
};

/** The kind's plain sentence, for a row whose facts don't word it: `team` is its team's name, or "your team". */
const FALLBACKS: Record<AnyNotificationKind, (team: string) => string> = {
  review_requested: () => "A version is waiting for your review.",
  changes_requested: () => "Changes were requested on a version you submitted.",
  stage_approved: () => "A version passed a review stage.",
  version_live: () => "A version is now Active.",
  comment_added: () => "There's a new comment on a version in review.",
  revoke_started: () => "A revoke is waiting for a second approver.",
  version_revoked: () => "A version was revoked.",
  sunset_scheduled: () => "A sunset date was set.",
  access_requested: (t) => `Someone asked for access to ${t}.`,
  access_granted: (t) => `You now have access to ${t}.`,
  access_denied: (t) => `Your request for access to ${t} was declined.`,
  roles_changed: (t) => `Your roles in ${t} changed.`,
  access_removed: (t) => `Your access to ${t} was removed.`,
  access_lapsed: (t) => `Access to ${t} lapsed.`,
  access_suspended: (t) => `Access to ${t} was suspended.`,
  inactivity_flagged: (t) =>
    `A member of ${t} hasn't signed in for ${INACTIVITY_FLAG_DAYS} days.`,
  recert_due: (t) => `An access review for ${t} is due.`,
  team_admin_appointed: (t) => `You're the Team Admin of ${t}.`,
};

// ── Reading facts defensively (they're JSON from the backend) ───────────────

function words(title: string, body: string | null = null): NotificationWords {
  return { title, body };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function instant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

function roleOf(value: unknown): TeamRole | null {
  return typeof value === "string" &&
    (TEAM_ROLES as readonly string[]).includes(value)
    ? (value as TeamRole)
    : null;
}

function rolesOf(value: unknown): TeamRole[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const roles = value.map(roleOf);
  return roles.every((r) => r !== null) ? (roles as TeamRole[]) : null;
}

function stateOf(value: unknown): VersionState | null {
  return VERSION_STATES.find((s) => s === value) ?? null;
}

/** "Spring Travel Rewards — Terms v1, round 2": a round as its label named it in that state. */
function roundNamed(f: Facts, state: VersionState): string | null {
  const name = text(f.templateName);
  const number = whole(f.number);
  const round = whole(f.round);
  if (!name || number === null || round === null) return null;
  return `${name} ${versionLabel({ number, round, state }, { style: "sentence" })}`;
}

/** "Balance Transfer — Terms v2": a released version, named by its number alone. */
function releasedNamed(f: Facts): string | null {
  const name = text(f.templateName);
  const number = whole(f.number);
  return name && number !== null ? `${name} v${number}` : null;
}

/** "Devon Lin's" (house style: always 's). */
function possessive(name: string): string {
  return `${name}'s`;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
