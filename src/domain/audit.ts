// The Audit page and the bell, as pure TypeScript (Phase 6, slice S3):
//
//   - the action catalog: each audit action's category ("templates" | "access" | "platform") and
//     its label for the Action column ("Submitted", "Access granted", "Configuration changed");
//   - one plain sentence per event (`describeAuditEvent`): lifecycle actions delegate to
//     domain/activity.ts, access and platform actions read their details;
//   - the filters (`?team&person&action&template&from&to`, each a comma list), their matching and
//     the facet counts the five menus show;
//   - the CSV export (RFC 4180);
//   - a fallback sentence and link for every notification kind the bell shows.
//
// No framework imports: the server queries, the export route and client components all use it.

import { ROLE_LABEL, rolesLabel } from "./access";
import type {
  AnyNotificationKind,
  AuditCategory,
  AuditDomain,
  AuditFilters,
  AuditRow,
} from "./access-types";
import { INACTIVITY_FLAG_DAYS } from "./access-types";
import { SYSTEM_ACTOR, describeActivity } from "./activity";
import { formatLongDate } from "./render/errors";
import type { Person } from "./review-types";
import { TEAM_ROLES, type TeamRole } from "./types";

// ── The action catalog ──────────────────────────────────────────────────────

export const AUDIT_CATEGORIES = ["templates", "access", "platform"] as const satisfies readonly AuditCategory[];

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  templates: "Templates",
  access: "Access",
  platform: "Platform",
};

interface ActionInfo {
  label: string;
  category: AuditCategory;
}

/** Canonical actions, in the Action menu's order. */
const ACTIONS = {
  "template.created": { label: "Template created", category: "templates" },
  "draft.started": { label: "Draft started", category: "templates" },
  "draft.edited": { label: "Draft edited", category: "templates" },
  "version.submitted": { label: "Submitted", category: "templates" },
  "comment.added": { label: "Commented", category: "templates" },
  "thread.resolved": { label: "Comment resolved", category: "templates" },
  "thread.reopened": { label: "Comment reopened", category: "templates" },
  "version.changes_requested": { label: "Changes requested", category: "templates" },
  "version.approved": { label: "Approved", category: "templates" },
  "version.activated": { label: "Became Active", category: "templates" },
  "version.superseded": { label: "Superseded", category: "templates" },
  "version.sunset_set": { label: "Sunset set", category: "templates" },
  "version.revoke_started": { label: "Revoke started", category: "templates" },
  "version.revoke_cancelled": { label: "Revoke canceled", category: "templates" },
  "version.revoked": { label: "Revoked", category: "templates" },

  "access.requested": { label: "Access requested", category: "access" },
  "access.granted": { label: "Access granted", category: "access" },
  "access.denied": { label: "Access denied", category: "access" },
  "access.role_changed": { label: "Roles changed", category: "access" },
  "access.removed": { label: "Access removed", category: "access" },
  "access.flagged_inactive": { label: "Flagged inactive", category: "access" },
  "access.kept": { label: "Kept after inactivity", category: "access" },
  "access.suspended": { label: "Suspended", category: "access" },
  "access.lapsed": { label: "Access lapsed", category: "access" },
  "access.reinstated": { label: "Reinstated", category: "access" },
  "access.kept_last_admin": { label: "Kept: last Team Admin", category: "access" },
  "recert.started": { label: "Review started", category: "access" },
  "recert.kept": { label: "Recertified", category: "access" },
  "recert.removed": { label: "Removed in review", category: "access" },
  "recert.closed": { label: "Review closed", category: "access" },

  "platform.config_changed": { label: "Configuration changed", category: "platform" },
} as const satisfies Record<string, ActionInfo>;

export type CanonicalAuditAction = keyof typeof ACTIONS;

/** Other spellings that mean the same thing (the seed's, and one stage of a multi-stage chain). */
const ALIASES: Record<string, CanonicalAuditAction> = {
  "version.stage_approved": "version.approved",
  "version.revoke_confirmed": "version.revoked",
  "comment.resolved": "thread.resolved",
};

const ACTION_INFO: Readonly<Record<string, ActionInfo>> = ACTIONS;

/**
 * The action an event files under. An approver's final approval is written as `version.activated`
 * with the approver as actor: it reads as "Approved". The same action with no actor is the system
 * making a version Active (the seed's activations): "Became Active".
 */
export function canonicalAction(action: string, byPerson = false): string {
  if (action === "version.activated" && byPerson) return "version.approved";
  return ALIASES[action] ?? action;
}

export function categoryOf(action: string): AuditCategory {
  const known = ACTION_INFO[canonicalAction(action)];
  if (known) return known.category;
  if (action.startsWith("access.") || action.startsWith("recert.")) return "access";
  if (action.startsWith("platform.")) return "platform";
  return "templates";
}

export function actionLabel(action: string, byPerson = false): string {
  const known = ACTION_INFO[canonicalAction(action, byPerson)];
  if (known) return known.label;
  // An action this catalog doesn't know yet: "version.fancy_thing" → "Fancy thing".
  const last = action.split(".").pop() ?? action;
  const words = last.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : action;
}

export function actionOptions(): { value: string; label: string; category: AuditCategory }[] {
  return Object.entries(ACTIONS).map(([value, info]) => ({ value, label: info.label, category: info.category }));
}

export function isAuditCategory(value: unknown): value is AuditCategory {
  return typeof value === "string" && (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

// ── Sentences ───────────────────────────────────────────────────────────────

export interface AuditEventInput {
  action: string;
  details: Record<string, unknown> | null;
  versionNumber: number | null;
}

/**
 * One sentence. Lifecycle actions delegate to `describeActivity`; access and platform actions read
 * their details (userName, role/roles, from/to, reason, note, label, dueAt, area, summary).
 * Details never hold variable values, so nothing here can leak one.
 */
export function describeAuditEvent(e: AuditEventInput, actor: Person | null): string {
  if (categoryOf(e.action) === "templates") return describeActivity(e, actor);

  const d = e.details ?? {};
  const who = actor?.name ?? SYSTEM_ACTOR;
  // Whom the event is about. The seed's requests carry no userName: the requester is the actor.
  const subject = text(d.userName) || (actor?.name ?? "A member");
  const role = roleText(d.role);
  const roles = rolesText(d.roles);
  const label = text(d.label);
  const review = label ? `the ${label} access review` : "the access review";

  switch (e.action) {
    case "access.requested":
      return withText(`${who} asked for ${role || "access"}${role ? " access" : ""}`, d.reason);

    case "access.granted": {
      if (d.appointed === true) return `${who} made ${subject} the Team Admin.`;
      if (typeof d.requestId === "string") {
        return withText(`${who} approved ${possessive(subject)} request for ${role || roles || "team"} access`, d.note);
      }
      return roles ? `${who} gave ${subject} ${roles} access.` : `${who} gave ${subject} access.`;
    }

    case "access.denied":
      return withText(`${who} declined ${possessive(subject)} request for ${role || "team"} access`, d.note);

    case "access.role_changed": {
      const from = rolesText(d.from);
      const to = rolesText(d.to);
      if (from && to) return `${who} changed ${possessive(subject)} roles from ${from} to ${to}.`;
      return to ? `${who} changed ${possessive(subject)} roles to ${to}.` : `${who} changed ${possessive(subject)} roles.`;
    }

    case "access.removed":
      return roles ? `${who} removed ${possessive(subject)} ${roles} access.` : `${who} removed ${subject}.`;

    case "access.flagged_inactive": {
      const until = date(d.suspendsAt);
      const stem = `${subject} hasn't signed in for ${INACTIVITY_FLAG_DAYS} days`;
      return until ? `${stem}: suspends automatically on ${until}.` : `${stem}.`;
    }

    case "access.kept": {
      const days = count(d.daysInactive);
      return days === null
        ? `${who} kept ${possessive(subject)} access.`
        : `${who} kept ${possessive(subject)} access after ${plural(days, "day")} without a sign-in.`;
    }

    case "access.suspended": {
      const days = count(d.daysInactive);
      const idle = days === null ? "for inactivity" : `after ${plural(days, "day")} without a sign-in`;
      if (d.reason === "inactivity_auto" || !actor) return `${possessive(subject)} access was suspended automatically ${idle}.`;
      return `${who} suspended ${possessive(subject)} access ${idle}.`;
    }

    case "access.lapsed": {
      const by = date(d.dueAt);
      return by
        ? `${possessive(subject)} access lapsed: not recertified by ${by}.`
        : `${possessive(subject)} access lapsed: not recertified.`;
    }

    case "access.kept_last_admin": {
      const team = text(d.teamName);
      const as = team ? `the last Team Admin of ${team}` : "the last Team Admin";
      if (d.reason === "recert_unconfirmed") {
        const by = date(d.dueAt);
        return `${possessive(subject)} access didn't lapse${by ? ` on ${by}` : ""}: ${as}.`;
      }
      const days = count(d.daysInactive);
      return `${possessive(subject)} access wasn't suspended automatically${days === null ? "" : ` after ${plural(days, "day")} without a sign-in`}: ${as}.`;
    }

    case "access.reinstated":
      return roles ? `${who} reinstated ${subject} as ${roles}.` : `${who} reinstated ${subject}.`;

    case "recert.started": {
      const members = count(d.members);
      const due = date(d.dueAt);
      const parts = [members === null ? "" : `${plural(members, "member")} to confirm`, due ? `due ${due}` : ""].filter(Boolean);
      const stem = actor ? `${who} started ${review}` : `${capitalize(review)} started`;
      return parts.length ? `${stem}: ${parts.join(", ")}.` : `${stem}.`;
    }

    case "recert.kept":
      return `${who} confirmed ${possessive(subject)} access in ${review}.`;

    case "recert.removed":
      return `${who} removed ${subject} in ${review}.`;

    case "recert.closed": {
      const kept = count(d.kept) ?? 0;
      const removed = count(d.removed) ?? 0;
      const lapsed = count(d.lapsed) ?? 0;
      return `${capitalize(review)} closed: ${kept} kept, ${removed} removed, ${lapsed} lapsed.`;
    }

    case "platform.config_changed": {
      const summary = text(d.summary);
      return summary ? continued(who, summary) : `${who} changed the ${areaText(d.area)}.`;
    }

    default: {
      const summary = text(d.summary);
      if (summary) return continued(who, summary);
      return `${who}: ${actionLabel(e.action).toLowerCase()}.`;
    }
  }
}

/** The person an access event is about (details.userId), for the Person filter and the row. */
export function subjectIdOf(action: string, details: Record<string, unknown> | null): string | null {
  if (categoryOf(action) !== "access") return null;
  const id = details?.userId;
  return typeof id === "string" && id ? id : null;
}

// ── Filters ─────────────────────────────────────────────────────────────────

/** The Person filter's value for events nobody did (the clock-driven sweep, the seed's activations). */
export const SYSTEM_PERSON = "system";

export type AuditListKey = "team" | "person" | "action" | "template";
export const AUDIT_LIST_KEYS = ["team", "person", "action", "template"] as const satisfies readonly AuditListKey[];
/** A facet the menus count: one of the list filters. Dates aren't counted. */
export type AuditFacet = AuditListKey;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PERSON_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const TEMPLATE_RE = /^UC-[0-9A-Z]{6}$/;

/** "2026-02-30" and friends are not days. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const at = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/** The values of one list filter (empty when unset). */
export function filterValues(filters: AuditFilters, key: AuditListKey): string[] {
  const raw = filters[key];
  return raw ? raw.split(",").filter(Boolean) : [];
}

/** The filters with one list replaced (an empty list removes the field). */
export function withFilterValues(filters: AuditFilters, key: AuditListKey, values: readonly string[]): AuditFilters {
  const next: AuditFilters = { ...filters };
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length) next[key] = unique.join(",");
  else delete next[key];
  return next;
}

/** Adds the value when it isn't picked, removes it when it is (a menu checkbox, a chip's ×). */
export function toggleFilterValue(filters: AuditFilters, key: AuditListKey, value: string): AuditFilters {
  const current = filterValues(filters, key);
  return withFilterValues(
    filters,
    key,
    current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
  );
}

function listParam(value: string | string[] | undefined, keep: (v: string) => string | null): string | undefined {
  const parts = (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean)
    .map(keep)
    .filter((v): v is string => v !== null);
  const unique = [...new Set(parts)];
  return unique.length ? unique.join(",") : undefined;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads `?team&person&action&template&from&to`. Drops what is malformed: bad slugs and ids, unknown
 * actions, impossible days. Action spellings fold to the canonical one; a reversed range is swapped.
 */
export function parseAuditFilters(params: Record<string, string | string[] | undefined>): AuditFilters {
  const out: AuditFilters = {};
  const team = listParam(params.team, (v) => (SLUG_RE.test(v) && v !== "all" ? v : null));
  const person = listParam(params.person, (v) => (PERSON_RE.test(v) ? v : null));
  const action = listParam(params.action, (v) => {
    if (isAuditCategory(v)) return v;
    const canonical = canonicalAction(v);
    return canonical in ACTIONS ? canonical : null;
  });
  const template = listParam(params.template, (v) => (TEMPLATE_RE.test(v.toUpperCase()) ? v.toUpperCase() : null));
  if (team) out.team = team;
  if (person) out.person = person;
  if (action) out.action = action;
  if (template) out.template = template;

  let from = firstParam(params.from)?.trim();
  let to = firstParam(params.to)?.trim();
  if (!isDay(from)) from = undefined;
  if (!isDay(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  if (from) out.from = from;
  if (to) out.to = to;
  return out;
}

/** `?team=…&person=…` in a stable order, commas left readable; "" when nothing is set. */
export function auditQuery(filters: AuditFilters): string {
  const keys = ["team", "person", "action", "template", "from", "to"] as const;
  const parts = keys
    .filter((k) => filters[k])
    .map((k) => `${k}=${encodeURIComponent(filters[k]!).replace(/%2C/gi, ",")}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** How many chips the filters make (the date range is one). */
export function activeFilterCount(filters: AuditFilters): number {
  return (
    AUDIT_LIST_KEYS.reduce((n, k) => n + filterValues(filters, k).length, 0) + (filters.from || filters.to ? 1 : 0)
  );
}

/** YYYY-MM-DD of an ISO instant on the demo clock (UTC, as the workspace's `today`). */
export function dayOfIso(iso: string): string {
  return iso.slice(0, 10);
}

/** Does the row pass every filter (but `skip`, for that facet's own counts)? */
export function matchesAuditFilters(row: AuditRow, filters: AuditFilters, skip?: AuditFacet): boolean {
  if (skip !== "team") {
    const teams = filterValues(filters, "team");
    if (teams.length && !(row.team && teams.includes(row.team.slug))) return false;
  }
  if (skip !== "person") {
    const people = filterValues(filters, "person");
    if (people.length && !personKeysOf(row).some((p) => people.includes(p))) return false;
  }
  if (skip !== "action") {
    const actions = filterValues(filters, "action");
    if (actions.length && !actions.includes(row.category) && !actions.includes(actionKeyOf(row))) return false;
  }
  if (skip !== "template") {
    const templates = filterValues(filters, "template");
    if (templates.length && !(row.template && templates.includes(row.template.id))) return false;
  }
  const day = dayOfIso(row.at);
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  return true;
}

export function filterAuditRows(rows: readonly AuditRow[], filters: AuditFilters): AuditRow[] {
  return rows.filter((r) => matchesAuditFilters(r, filters));
}

/** The canonical action a row files under (what the Action filter compares). */
export function actionKeyOf(row: Pick<AuditRow, "action" | "actor">): string {
  return canonicalAction(row.action, row.actor !== null);
}

/** Who the Person filter matches on a row: who acted (or "system") and whom it's about. */
export function personKeysOf(row: Pick<AuditRow, "actor" | "subject">): string[] {
  const keys = [row.actor?.id ?? SYSTEM_PERSON];
  if (row.subject && row.subject.id !== keys[0]) keys.push(row.subject.id);
  return keys;
}

export interface AuditFacetCounts {
  team: Record<string, number>;
  person: Record<string, number>;
  /** Canonical actions AND categories. */
  action: Record<string, number>;
  template: Record<string, number>;
}

/** For each menu: how many rows each value would match with every OTHER filter applied. */
export function auditFacetCounts(rows: readonly AuditRow[], filters: AuditFilters): AuditFacetCounts {
  const counts: AuditFacetCounts = { team: {}, person: {}, action: {}, template: {} };
  const bump = (bag: Record<string, number>, key: string) => (bag[key] = (bag[key] ?? 0) + 1);
  for (const row of rows) {
    if (row.team && matchesAuditFilters(row, filters, "team")) bump(counts.team, row.team.slug);
    if (matchesAuditFilters(row, filters, "person")) for (const p of personKeysOf(row)) bump(counts.person, p);
    if (matchesAuditFilters(row, filters, "action")) {
      bump(counts.action, actionKeyOf(row));
      bump(counts.action, row.category);
    }
    if (row.template && matchesAuditFilters(row, filters, "template")) bump(counts.template, row.template.id);
  }
  return counts;
}

// ── Dates ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
export const AUDIT_DATE_PRESETS = [7, 30, 90] as const;

/** "Last 7 days" etc., ending today (inclusive) on the demo clock. */
export function datePresets(today: string): { days: number; label: string; from: string; to: string }[] {
  const end = new Date(`${today}T00:00:00.000Z`).getTime();
  return AUDIT_DATE_PRESETS.map((days) => ({
    days,
    label: `Last ${days} days`,
    from: new Date(end - (days - 1) * DAY_MS).toISOString().slice(0, 10),
    to: today,
  }));
}

const chipDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The Date chip: "Sep 6, 2026 – Oct 5, 2026", "From Sep 6, 2026", "Until Oct 5, 2026". */
export function dateRangeLabel(from?: string | null, to?: string | null): string {
  const f = (s: string) => chipDate.format(new Date(`${s}T00:00:00.000Z`));
  if (from && to) return from === to ? f(from) : `${f(from)} – ${f(to)}`;
  if (from) return `From ${f(from)}`;
  if (to) return `Until ${f(to)}`;
  return "Any date";
}

// ── CSV ─────────────────────────────────────────────────────────────────────

export const AUDIT_CSV_HEADER = ["When", "Who", "Team", "Template", "Version", "Action", "Details"] as const;

/**
 * One RFC 4180 field: quoted when it holds a comma, a quote, a line break or edge spaces, with
 * quotes doubled. A field a spreadsheet would run as a formula (=, +, -, @, tab, CR first) gets a
 * leading apostrophe (OWASP's CSV-injection guidance): the audit export is opened in Excel.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180: When (ISO, demo clock), Who, Team, Template, Version, Action, Details. CRLF line ends. */
export function toCsv(rows: readonly AuditRow[]): string {
  const lines = [AUDIT_CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.at,
        r.actor?.name ?? SYSTEM_ACTOR,
        r.team?.name ?? "All teams",
        r.template ? `${r.template.name} (${r.template.id})` : "",
        r.versionNumber === null ? "" : `v${r.versionNumber}`,
        r.actionLabel,
        r.summary,
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** RFC 4180 reader (the tests' round trip; not used by the app). */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && csv[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── Notifications (the bell) ────────────────────────────────────────────────

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
type MissingKind = Exclude<AnyNotificationKind, (typeof NOTIFICATION_KINDS)[number]>;
const allKindsListed: MissingKind extends never ? true : MissingKind = true;
void allKindsListed;

export function isNotificationKind(kind: string): kind is AnyNotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

type Where = { team: string | null; teamName: string | null };

const NOTIFICATION_FALLBACKS: Record<AnyNotificationKind, { title: (t: string) => string; href: (w: Where) => string }> = {
  review_requested: { title: () => "A version is waiting for your review.", href: (w) => teamPath(w, "review") },
  changes_requested: { title: () => "Changes were requested on a version you submitted.", href: (w) => teamPath(w, "library") },
  stage_approved: { title: () => "A version passed a review stage.", href: (w) => teamPath(w, "review") },
  version_live: { title: () => "A version is now Active.", href: (w) => teamPath(w, "library") },
  comment_added: { title: () => "There's a new comment on a version in review.", href: (w) => teamPath(w, "review") },
  revoke_started: { title: () => "A revoke is waiting for a second approver.", href: (w) => teamPath(w, "review") },
  version_revoked: { title: () => "A version was revoked.", href: (w) => teamPath(w, "library") },
  sunset_scheduled: { title: () => "A sunset date was set.", href: (w) => teamPath(w, "library") },
  access_requested: { title: (t) => `Someone asked for access to ${t}.`, href: (w) => teamPath(w, "settings/access-requests") },
  access_granted: { title: (t) => `You now have access to ${t}.`, href: (w) => teamPath(w, "library") },
  access_denied: { title: (t) => `Your request for access to ${t} was declined.`, href: () => "/request-access" },
  roles_changed: { title: (t) => `Your roles in ${t} changed.`, href: (w) => teamPath(w, "library") },
  access_removed: { title: (t) => `Your access to ${t} was removed.`, href: () => "/request-access" },
  access_lapsed: { title: (t) => `Access to ${t} lapsed.`, href: () => "/request-access" },
  access_suspended: { title: (t) => `Access to ${t} was suspended.`, href: () => "/request-access" },
  inactivity_flagged: {
    title: (t) => `A member of ${t} hasn't signed in for ${INACTIVITY_FLAG_DAYS} days.`,
    href: (w) => teamPath(w, "settings/inactivity"),
  },
  recert_due: { title: (t) => `An access review for ${t} is due.`, href: (w) => teamPath(w, "settings/recertification") },
  team_admin_appointed: { title: (t) => `You're the Team Admin of ${t}.`, href: (w) => teamPath(w, "settings/members") },
};

/** Team ids are their slugs (seed contract). No team: the app's root, which lands in the viewer's space. */
function teamPath(w: Where, rest: string): string {
  return w.team ? `/${w.team}/${rest}` : "/";
}

/**
 * The sentence and link a notification shows when its row lacks them (rows written before a field
 * existed). Writers store both; the stored ones win. Unknown kinds fall back to the team's library.
 */
export function notificationFallback(
  kind: string,
  where: Where,
): { title: string; href: string } {
  const teamName = where.teamName ?? "your team";
  if (isNotificationKind(kind)) {
    const f = NOTIFICATION_FALLBACKS[kind];
    return { title: f.title(teamName), href: f.href(where) };
  }
  return { title: "Something changed in UCOMP.", href: teamPath(where, "library") };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function isRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value);
}

function roleText(value: unknown): string {
  return isRole(value) ? ROLE_LABEL[value] : "";
}

function rolesText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const roles = value.filter(isRole);
  return roles.length ? rolesLabel(roles) : "";
}

function areaText(value: unknown): string {
  switch (value) {
    case "teams":
      return "teams";
    case "content_types":
      return "content types";
    case "channel_rules":
      return "channel rules";
    case "approval_chains":
      return "approval chains";
    default:
      return "platform configuration";
  }
}

/** "Morgan Lee's" (house style: always 's, "Chris Morales's"). */
function possessive(name: string): string {
  return `${name}'s`;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** "Turned off PDF" → "turned off PDF" (a summary continues the actor's sentence). */
function lowerFirst(s: string): string {
  if (!s) return s;
  // Keep acronyms and names ("PDF", "UCOMP") as they are.
  if (/^[A-Z]{2,}/.test(s)) return s;
  return s[0]!.toLowerCase() + s.slice(1);
}

/** "Riley Brooks turned off PDF for Disclosure." (a summary continues the actor's name). */
function continued(who: string, summary: string): string {
  const s = lowerFirst(summary);
  return `${who} ${s}${/[.!?]$/.test(s) ? "" : "."}`;
}

/** "Stem: the text." with one closing period; just "Stem." when there's no text. Whitespace collapses. */
function withText(stem: string, value: unknown): string {
  const t = text(value);
  if (!t) return `${stem}.`;
  return `${stem}: ${t}${/[.!?]$/.test(t) ? "" : "."}`;
}

/** An ISO date in the long form ("March 1, 2027"), or "" when it isn't one. */
function date(value: unknown): string {
  if (typeof value !== "string") return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : formatLongDate(at);
}

// ── The contract ────────────────────────────────────────────────────────────

/** The `AuditDomain` signatures from access-types.ts, checked against this module. */
export const auditDomain: AuditDomain = {
  categoryOf,
  actionLabel,
  describeAuditEvent,
  actionOptions,
  parseAuditFilters,
  toCsv: (rows) => toCsv(rows),
};
