// Platform configuration: teams, content types (required sections), channel rules and approval
// chains. Pure TypeScript: every function takes `now` (the demo clock) and returns what to write and
// what to record (`effects`); server/actions/platform.ts applies both in one transaction.
// Contracts: ./access-types.ts (`PlatformConfigDomain`).
//
// The rules:
//   - A team's slug comes from its name; it must be new (slug and name, case-insensitive) and not a
//     route the app owns. The team starts with one member, its first Team Admin.
//   - Required sections shape only templates created afterwards. A document carries its sections as
//     headings with a `requiredKey`, and the editor protects those, so an existing template keeps the
//     sections it was made with. Removing a section is allowed: nothing at submit checks sections, so
//     no existing draft becomes unsubmittable (`conformToSections` shapes a new template's starter).
//   - A channel turned off stops rendering at once, Active versions included: the consequence names
//     how many. At least one channel stays on.
//   - Approval chains: every stage must be one somebody can approve (`validateChain`): the Approver
//     role, or a person who can approve and isn't on another stage. Nobody names themselves. A
//     version in review goes through the stages it recorded at submit, so an edit never moves it; a
//     new rule on one of its stages reaches it. A stage some in-review version still needs (the one it
//     waits on, or one ahead of it) can't be removed.
//   - The business time zone is one of `BUSINESS_ZONES` (business-zone.ts). Changing it moves no sunset
//     already set: only dates picked afterwards end at 00:00 in the new zone.

import type {
  AccessEffect,
  ApproverFacts,
  MembershipChange,
  Named,
  Ok,
  PlatformArea,
  PlatformConfigDomain,
  Refused,
} from "./access-types";
import { ROLE_LABEL } from "./access";
import { isBusinessZone, zoneLabel, type BusinessZone } from "./business-zone";
import { refusal, refuse, type Refusal } from "./refusals";
import { CHANNEL_LABELS, joinWithAnd } from "./render/errors";
import { versionsNeeding } from "./approval-chain";
import type { ApprovalStage, VersionStage } from "./review-types";
import {
  CHANNELS,
  TEAM_ROLES,
  type ApproverRule,
  type Channel,
  type JSONContent,
  type RequiredSection,
  type TeamRole,
} from "./types";

// ── Limits and wording ───────────────────────────────────────────────────────

export const TEAM_NAME_MAX = 60;
export const TEAM_DESCRIPTION_MAX = 200;
export const SECTION_TITLE_MAX = 60;
export const STAGE_NAME_MAX = 40;

/** Lucide keys the team icon picker offers (the seed's teams use the first three). */
export const TEAM_ICONS = [
  "credit-card",
  "piggy-bank",
  "receipt-text",
  "landmark",
  "wallet",
  "home",
  "car",
  "briefcase",
  "shield-check",
  "scale",
  "megaphone",
  "building-2",
] as const;

/**
 * Slugs the app's own routes use: a team can't take them. Every top-level segment under src/app
 * (route groups looked through) must be here; platform-config.test.ts checks the folder.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "all",
  "api",
  "request-access",
  "design",
  "editor-lab",
  "pdf-lab",
  "sim",
  "settings",
  "audit",
  "new",
  "_next",
]);

/** Why a Platform settings change can't be saved: a code to branch on, and the sentence shown at the control. */
export const PLATFORM_REFUSALS = {
  teamName: refusal("team_name_missing", "Give the team a name."),
  teamNameTooLong: refusal("team_name_too_long", `Keep the name under ${TEAM_NAME_MAX} characters.`),
  descriptionTooLong: refusal("team_description_too_long", `Keep the description under ${TEAM_DESCRIPTION_MAX} characters.`),
  icon: refusal("team_icon_missing", "Pick an icon."),
  reservedName: refusal("team_name_reserved", (name: string) => `"${name}" can't be used as a team name.`),
  teamTaken: refusal("team_name_taken", (name: string) => `A team called ${name} already exists.`),
  pickPerson: refusal("pick_person", "Pick a person."),
  /** A new team's first Team Admin: the Auditor is read-only everywhere. */
  auditorCantBeAdmin: refusal("auditor_cant_be_admin", (person: string) => `${person} is an Auditor and can't be a Team Admin.`),
  oneSection: refusal("last_section", "Keep at least one required section."),
  sectionTitle: refusal("section_title_missing", "Give every section a title."),
  sectionTitleTooLong: refusal("section_title_too_long", `Keep section titles under ${SECTION_TITLE_MAX} characters.`),
  sectionDuplicate: refusal("section_duplicate", (title: string) => `There are two sections called ${title}.`),
  oneChannel: refusal("last_channel", "Keep at least one channel on."),
  oneStage: refusal("last_stage", "Keep at least one stage."),
  stageName: refusal("stage_name_missing", "Give every stage a name."),
  stageNameTooLong: refusal("stage_name_too_long", `Keep stage names under ${STAGE_NAME_MAX} characters.`),
  stageDuplicate: refusal("stage_duplicate", (name: string) => `There are two stages called ${name}.`),
  stageGone: refusal("stage_changed", "A stage changed since you opened this. Try again."),
  pickRole: refusal("pick_stage_role", "Pick a role."),
  roleCantApprove: refusal("role_cant_approve", (role: TeamRole) => `The ${ROLE_LABEL[role]} role can't approve.`),
  nameYourself: refusal("names_yourself", "You can't name yourself as an approver."),
  auditorCantApprove: refusal("auditor_cant_approve", (person: string) => `${person} is an Auditor and can't approve.`),
  adminWithoutTeamRole: refusal(
    "admin_without_team_role",
    (person: string) => `${person} is a Platform Admin with no team role and can't approve.`,
  ),
  noActiveAccess: refusal("no_active_access", (person: string) => `${person} has no active access.`),
  personTwice: refusal("person_on_two_stages", (person: string, stage: number) => `${person} already reviews stage ${stage}.`),
  stageWaiting: refusal(
    "stage_in_use",
    (count: number, name: string) =>
      `${count} ${count === 1 ? "version" : "versions"} in review still ${count === 1 ? "needs" : "need"} ${name}.`,
  ),
  pickZone: refusal("pick_zone", "Pick a time zone from the list."),
} as const;

function configChanged(area: PlatformArea, teamId: string | null, summary: string, details: Record<string, unknown>): AccessEffect {
  return { kind: "audit", action: "platform.config_changed", teamId, details: { area, summary, ...details } };
}

// ── Teams ────────────────────────────────────────────────────────────────────

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
    if (description.length > TEAM_DESCRIPTION_MAX) return PLATFORM_REFUSALS.descriptionTooLong;
    if (!(TEAM_ICONS as readonly string[]).includes(input.icon)) return PLATFORM_REFUSALS.icon;
    if (!slug || RESERVED_SLUGS.has(slug)) return PLATFORM_REFUSALS.reservedName(name);
    const taken = input.existing.find((t) => t.slug === slug || t.name.toLowerCase() === name.toLowerCase());
    return taken ? PLATFORM_REFUSALS.teamTaken(taken.name) : null;
  })();
  return { name, description, slug, problem };
}

/** What creating the team does, said before it's confirmed. */
export function newTeamConsequences(name: string, adminName: string): string[] {
  return [`${adminName} becomes Team Admin of ${name} and approves its access requests.`, `${name} starts with no templates.`];
}

/** Creates a team (id = slug, the seed contract) with `admin` as its first Team Admin. */
export function createTeam(input: {
  name: string;
  description: string;
  icon: string;
  admin: Named;
  actor: Named;
  now: Date;
  existing: { slug: string; name: string }[];
}):
  | Ok<{
      team: { id: string; slug: string; name: string; description: string; icon: string; createdAt: Date };
      membership: MembershipChange;
      effects: AccessEffect[];
    }>
  | Refused {
  const { name, description, slug, problem } = validateNewTeam(input);
  if (problem) return refuse(problem);

  const { admin, actor, now } = input;
  const team = { id: slug, slug, name, description, icon: input.icon, createdAt: now };
  return {
    ok: true,
    team,
    membership: {
      kind: "insert",
      membership: { userId: admin.id, teamId: team.id, roles: ["team_admin"], addedAt: now, addedBy: actor.id },
    },
    effects: [
      configChanged("teams", team.id, `Created team ${name} with ${admin.name} as Team Admin`, {
        teamName: name,
        slug,
        userId: admin.id,
        userName: admin.name,
      }),
      {
        kind: "audit",
        action: "access.granted",
        teamId: team.id,
        details: { userId: admin.id, userName: admin.name, role: "team_admin", roles: ["team_admin"], appointed: true },
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

// ── Content types: required sections ────────────────────────────────────────

/** "Rates and fees" → "rates_and_fees". */
export function sectionKey(title: string): string {
  const key = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return /^[a-z]/.test(key) ? key : `section_${key}`.replace(/_+$/, "");
}

/**
 * The first reason a content type's required sections can't be saved, or null: at least one section,
 * and every title given, at most 60 characters and unlike the others (case-insensitive). The sections
 * editor runs it as the admin types; `updateRequiredSections` refuses with it.
 */
export function validateRequiredSections(next: readonly { title: string }[]): Refusal | null {
  if (next.length === 0) return PLATFORM_REFUSALS.oneSection;
  const titles = new Set<string>();
  for (const s of next) {
    const title = s.title.trim();
    if (!title) return PLATFORM_REFUSALS.sectionTitle;
    if (title.length > SECTION_TITLE_MAX) return PLATFORM_REFUSALS.sectionTitleTooLong;
    if (titles.has(title.toLowerCase())) return PLATFORM_REFUSALS.sectionDuplicate(title);
    titles.add(title.toLowerCase());
  }
  return null;
}

/** Why a section can't be removed from a list of `count`, or null: at least one section stays. */
export function removeSectionRefusal(count: number): Refusal | null {
  return count <= 1 ? PLATFORM_REFUSALS.oneSection : null;
}

/** The sections as they'd be saved (new ones keyed from their title), and what changes. */
function planSections(current: readonly RequiredSection[], next: readonly RequiredSection[]) {
  const currentKeys = new Set(current.map((s) => s.key));
  const used = new Set(currentKeys);
  const kept = new Set<string>();
  const requiredSections = next.map((s): RequiredSection => {
    const title = s.title.trim();
    if (currentKeys.has(s.key) && !kept.has(s.key)) {
      kept.add(s.key);
      return { key: s.key, title };
    }
    const base = sectionKey(title);
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    return { key, title };
  });

  const before = new Map(current.map((s) => [s.key, s]));
  const after = new Map(requiredSections.map((s) => [s.key, s]));
  const added = requiredSections.filter((s) => !before.has(s.key)).map((s) => s.title);
  const removed = current.filter((s) => !after.has(s.key)).map((s) => s.title);
  const renamed = requiredSections
    .filter((s) => before.has(s.key) && before.get(s.key)!.title !== s.title)
    .map((s) => ({ from: before.get(s.key)!.title, to: s.title }));
  const keptOrder = (list: readonly RequiredSection[]) =>
    list.filter((s) => before.has(s.key) && after.has(s.key)).map((s) => s.key);
  const reordered = keptOrder(current).join() !== keptOrder(requiredSections).join();
  const changed = added.length > 0 || removed.length > 0 || renamed.length > 0 || reordered;
  return { requiredSections, added, removed, renamed, reordered, changed };
}

export interface SectionsChange {
  /** The first reason the list can't be saved (`validateRequiredSections`), or null. */
  problem: Refusal | null;
  /** Saving would change something: a section added, removed, renamed or moved. */
  changed: boolean;
  /** The strip's lines: the scope, said from the start, then what changes once something does. */
  lines: string[];
}

/**
 * The sections editor's strip as the admin edits `next` (a section being added has a key the type
 * doesn't have): that only new templates take the change, then which sections new templates gain
 * and which become ordinary headings.
 */
export function describeSectionsChange(input: {
  contentTypeName: string;
  current: readonly RequiredSection[];
  next: readonly RequiredSection[];
}): SectionsChange {
  const type = input.contentTypeName;
  const problem = validateRequiredSections(input.next);
  const plan = planSections(input.current, input.next);
  const lines = [`Applies to new ${type} templates only. Existing templates keep their sections.`];
  if (plan.changed && !problem) {
    if (plan.added.length) lines.push(`New templates start with ${joinWithAnd(plan.added)} added.`);
    if (plan.removed.length) lines.push(`${joinWithAnd(plan.removed)} becomes an ordinary heading in new templates.`);
  }
  return { problem, changed: plan.changed, lines };
}

/**
 * The content type's required sections, replaced. `next` lists every section in order: an existing
 * one by its key (its title may change: a rename keeps the key), a new one with any other key (the
 * key is made from its title, never reusing one the type has or had in this list).
 */
export function updateRequiredSections(input: {
  contentType: { id: string; name: string; requiredSections: RequiredSection[] };
  next: RequiredSection[];
  actor: Named;
  now: Date;
}): Ok<{ requiredSections: RequiredSection[]; effects: AccessEffect[] }> | Refused {
  const { contentType } = input;
  const current = contentType.requiredSections;
  const problem = validateRequiredSections(input.next);
  if (problem) return refuse(problem);

  const { requiredSections, added, removed, renamed, reordered, changed } = planSections(current, input.next);
  if (!changed) return { ok: true, requiredSections: current, effects: [] };

  const parts = [
    added.length ? `added ${joinWithAnd(added)}` : null,
    removed.length ? `removed ${joinWithAnd(removed)}` : null,
    ...renamed.map((r) => `renamed ${r.from} to ${r.to}`),
    reordered ? "reordered the sections" : null,
  ].filter((p): p is string => p !== null);
  const summary = `Changed ${contentType.name} required sections: ${parts.join("; ")}`;
  return {
    ok: true,
    requiredSections,
    effects: [
      configChanged("content_types", null, summary, {
        contentTypeId: contentType.id,
        contentTypeName: contentType.name,
        added,
        removed,
        renamed,
        sections: requiredSections.map((s) => s.title),
      }),
    ],
  };
}

/**
 * A new template's starter body, shaped to the content type's sections as they are now: a required
 * heading whose section was removed becomes an ordinary heading (its content stays), a renamed one
 * takes the new title, and a section the starter lacks is added at the end as an H2. Existing
 * templates are never reshaped. `newId` gives the added headings their block ids.
 */
export function conformToSections(body: JSONContent, sections: readonly RequiredSection[], newId: () => string): JSONContent {
  const wanted = new Map(sections.map((s) => [s.key, s]));
  const present = new Set<string>();
  const content = (body.content ?? []).map((block) => {
    const key = block.type === "heading" ? (block.attrs?.requiredKey as string | null | undefined) : null;
    if (!key) return block;
    const section = wanted.get(key);
    if (!section) return { ...block, attrs: { ...block.attrs, requiredKey: null } };
    present.add(key);
    const text = (block.content ?? []).map((n) => n.text ?? "").join("");
    return text === section.title ? block : { ...block, content: [{ type: "text", text: section.title }] };
  });
  for (const s of sections) {
    if (present.has(s.key)) continue;
    content.push({
      type: "heading",
      attrs: { id: newId(), level: 2, requiredKey: s.key },
      content: [{ type: "text", text: s.title }],
    });
  }
  return { ...body, content };
}

// ── Channel rules ────────────────────────────────────────────────────────────

/**
 * What turning a channel off stops, before it is committed (the confirm shows these lines):
 * "2 Active Disclosure versions stop rendering to Email." Turning one on changes nothing that renders.
 */
export function channelOffConsequences(contentTypeName: string, channel: Channel, activeUsing: number): string[] {
  const label = CHANNEL_LABELS[channel];
  const lines =
    activeUsing > 0
      ? [
          `${activeUsing} Active ${contentTypeName} ${activeUsing === 1 ? "version stops" : "versions stop"} rendering to ${label}.`,
        ]
      : [`No Active ${contentTypeName} version renders to ${label}.`];
  lines.push(`New ${contentTypeName} templates can't turn ${label} on.`);
  return lines;
}

/**
 * Why a content type allowing `allowedChannels` can't have `channel` set to `allowed`, or null: it
 * must be a channel, and at least one channel stays on. The channel rules read model asks it for
 * every switch, so the last one on shows disabled with the reason.
 */
export function channelRuleRefusal(allowedChannels: readonly Channel[], channel: Channel, allowed: boolean): Refusal | null {
  if (!(CHANNELS as readonly string[]).includes(channel)) return PLATFORM_REFUSALS.oneChannel;
  const next = CHANNELS.filter((c) => (c === channel ? allowed : allowedChannels.includes(c)));
  return next.length === 0 ? PLATFORM_REFUSALS.oneChannel : null;
}

/** Turns one channel on or off for a content type (the type × channel matrix). */
export function setChannelRule(input: {
  contentType: { id: string; name: string; allowedChannels: Channel[] };
  channel: Channel;
  allowed: boolean;
  activeUsing: number;
  actor: Named;
  now: Date;
}): Ok<{ allowedChannels: Channel[]; consequences: string[]; effects: AccessEffect[] }> | Refused {
  const { contentType, channel, allowed } = input;
  const current = contentType.allowedChannels;
  if (!(CHANNELS as readonly string[]).includes(channel)) return refuse(PLATFORM_REFUSALS.oneChannel);
  if (current.includes(channel) === allowed) return { ok: true, allowedChannels: current, consequences: [], effects: [] };
  const refusal = channelRuleRefusal(current, channel, allowed);
  if (refusal) return refuse(refusal);

  const next = CHANNELS.filter((c) => (c === channel ? allowed : current.includes(c)));

  const label = CHANNEL_LABELS[channel];
  const consequences = allowed ? [] : channelOffConsequences(contentType.name, channel, input.activeUsing);
  const summary = allowed
    ? `Turned on ${label} for ${contentType.name}`
    : `Turned off ${label} for ${contentType.name}` +
      (input.activeUsing > 0
        ? `: ${input.activeUsing} Active ${input.activeUsing === 1 ? "version stopped" : "versions stopped"} rendering to ${label}`
        : "");
  return {
    ok: true,
    allowedChannels: next,
    consequences,
    effects: [
      configChanged("channel_rules", null, summary, {
        contentTypeId: contentType.id,
        contentTypeName: contentType.name,
        channel,
        allowed,
        activeUsing: allowed ? 0 : input.activeUsing,
      }),
    ],
  };
}

// ── Approval chains ──────────────────────────────────────────────────────────

/** "Approver role", or the named person's name. */
export function ruleLabel(rule: ApproverRule, people: readonly Named[]): string {
  if (rule.kind === "team_role") return `${ROLE_LABEL[rule.role]} role`;
  return people.find((p) => p.id === rule.userId)?.name ?? rule.userId;
}

export interface ChainCardStage {
  /** The stage's id; null for a stage being added. */
  id: string | null;
  name: string;
  ruleLabel: string;
  /** "added" and "renamed" mark the After card; "removed" marks the Now card. */
  change: "added" | "removed" | "renamed" | "moved" | null;
}

export interface ChainChange {
  now: ChainCardStage[];
  after: ChainCardStage[];
  /** Plain lines under the cards. Empty when nothing changes. */
  lines: string[];
  changed: boolean;
}

type StageInput = { id?: string; name: string; rule: ApproverRule };

/**
 * The "Now / After" consequence cards for a chain edit, before it is saved, with the lines under
 * them: who reviews what from now on, and that a named person reviews every team's submissions
 * (including teams they aren't a member of). `waiting` counts, per stage id, the versions in review
 * that still need the stage (`versionsNeeding`).
 */
export function describeChainChange(input: {
  contentTypeName: string;
  current: readonly ApprovalStage[];
  next: readonly StageInput[];
  people: readonly Named[];
  waiting?: Readonly<Record<string, number>>;
}): ChainChange {
  const current = [...input.current].sort((a, b) => a.position - b.position);
  const nextIds = new Set(input.next.map((s) => s.id).filter((id): id is string => !!id));
  const byId = new Map(current.map((s, index) => [s.id, { stage: s, index }]));

  const now: ChainCardStage[] = current.map((s) => ({
    id: s.id,
    name: s.name,
    ruleLabel: ruleLabel(s.rule, input.people),
    change: nextIds.has(s.id) ? null : "removed",
  }));
  const keptBefore = current.filter((s) => nextIds.has(s.id)).map((s) => s.id);
  const keptAfter = input.next.filter((s) => s.id && byId.has(s.id)).map((s) => s.id!);
  const after: ChainCardStage[] = input.next.map((s) => {
    const was = s.id ? byId.get(s.id)?.stage : undefined;
    const label = ruleLabel(s.rule, input.people);
    let change: ChainCardStage["change"] = null;
    if (!was) change = "added";
    else if (was.name !== s.name.trim() || ruleLabel(was.rule, input.people) !== label) change = "renamed";
    else if (keptBefore.indexOf(was.id) !== keptAfter.indexOf(was.id)) change = "moved";
    return { id: was ? was.id : null, name: s.name.trim(), ruleLabel: label, change };
  });

  const lines: string[] = [];
  const type = input.contentTypeName;
  for (const s of after.filter((a) => a.change === "added")) {
    lines.push(`${type} submissions will also wait on ${s.name} (${s.ruleLabel}).`);
  }
  for (const s of now.filter((n) => n.change === "removed")) {
    const count = input.waiting?.[s.id!] ?? 0;
    lines.push(
      count > 0
        ? PLATFORM_REFUSALS.stageWaiting(count, s.name).reason
        : `${type} submissions will no longer wait on ${s.name}.`,
    );
  }
  const namedNow = new Set(current.flatMap((s) => (s.rule.kind === "user" ? [s.rule.userId] : [])));
  for (const s of input.next) {
    if (s.rule.kind !== "user" || namedNow.has(s.rule.userId)) continue;
    const person = ruleLabel(s.rule, input.people);
    lines.push(`${person} will review ${type} submissions from every team, including teams they aren't a member of.`);
  }
  const changed = after.some((a) => a.change !== null) || now.some((n) => n.change !== null) || after.length !== now.length;
  return { now, after, lines: changed ? lines : [], changed };
}

/** A reason a chain can't be saved (its code and sentence), tied to the stage (its index) and the field it's about. */
export interface StageProblem extends Refusal {
  stage: number;
  field: "name" | "reviewer";
}

/**
 * Why a stage naming `person` would stall, or null: a named stage gives its person the power to
 * decide only while they hold an active team role somewhere, and never an Auditor (permissions.ts,
 * `namedApprover`); a platform role alone is no approve power. It holds whoever named them and
 * whenever, so `validateChain` checks it for every named person on every save.
 */
export function cannotApprove(person: ApproverFacts): Refusal | null {
  if (person.platformRole === "auditor") return PLATFORM_REFUSALS.auditorCantApprove(person.name);
  if (!person.activeTeamRole) {
    return person.platformRole === "platform_admin"
      ? PLATFORM_REFUSALS.adminWithoutTeamRole(person.name)
      : PLATFORM_REFUSALS.noActiveAccess(person.name);
  }
  return null;
}

/**
 * Why `actorId` can't newly name `person` on a stage (a new stage, or a stage whose reviewer changes
 * to them), or null: `cannotApprove`, and nobody names themselves, since a Platform Admin would be
 * granting themselves approval. The rule is about the act of naming: a stage another admin already
 * named the actor on stays theirs when the actor saves the chain. The chain picker offers only the
 * people this returns null for.
 */
export function approverProblem(person: ApproverFacts, actorId: string): Refusal | null {
  if (person.id === actorId) return PLATFORM_REFUSALS.nameYourself;
  return cannotApprove(person);
}

/**
 * Everything that would stop a chain being saved or, once saved, stall every submission, tied to the
 * stage it's about. Names: blank, too long, or the same as an earlier stage's. Reviewers: a team role
 * other than Approver (no other role can decide); a person who doesn't exist, can't approve
 * (`cannotApprove`), or is already named on an earlier stage (nobody approves two stages of one
 * round); the actor naming themselves on a stage that didn't already name them (`current`, matched by
 * stage id). Every named person is checked, not only new ones: someone named earlier who has since
 * lost access stalls the chain too. In stage order, name before reviewer; empty when the chain is
 * fine. The chain editor runs it as the admin edits, with the facts its read model carries; the
 * server runs it again inside `saveApprovalChain`.
 */
export function validateChain(input: {
  stages: readonly { id?: string; name: string; rule: ApproverRule }[];
  /** The saved chain: a stage (by id) that already names the actor stays theirs. */
  current: readonly { id: string; rule: ApproverRule }[];
  actorId: string;
  people: readonly ApproverFacts[];
}): StageProblem[] {
  const problems: StageProblem[] = [];
  const names = new Set<string>();
  const namedOn = new Map<string, number>();
  const actorsStages = new Set(
    input.current.flatMap((s) => (s.rule.kind === "user" && s.rule.userId === input.actorId ? [s.id] : [])),
  );
  input.stages.forEach((stage, index) => {
    const name = stage.name.trim();
    const key = name.toLowerCase();
    const nameReason = !name
      ? PLATFORM_REFUSALS.stageName
      : name.length > STAGE_NAME_MAX
        ? PLATFORM_REFUSALS.stageNameTooLong
        : names.has(key)
          ? PLATFORM_REFUSALS.stageDuplicate(name)
          : null;
    if (name) names.add(key);
    if (nameReason) problems.push({ stage: index, field: "name", ...nameReason });

    const keptByActor = stage.id !== undefined && actorsStages.has(stage.id);
    const reviewerReason = reviewerProblem(stage.rule, input, keptByActor, namedOn, index);
    if (reviewerReason) problems.push({ stage: index, field: "reviewer", ...reviewerReason });
  });
  return problems;
}

function reviewerProblem(
  rule: ApproverRule,
  { actorId, people }: { actorId: string; people: readonly ApproverFacts[] },
  keptByActor: boolean,
  namedOn: Map<string, number>,
  index: number,
): Refusal | null {
  if (rule.kind === "team_role") {
    if (!(TEAM_ROLES as readonly string[]).includes(rule.role)) return PLATFORM_REFUSALS.pickRole;
    return rule.role === "approver" ? null : PLATFORM_REFUSALS.roleCantApprove(rule.role);
  }
  const person = people.find((p) => p.id === rule.userId);
  if (!person) return PLATFORM_REFUSALS.pickPerson;
  // A stage that already named the actor stays theirs; every other naming of them is them naming themselves.
  const cannot = keptByActor ? cannotApprove(person) : approverProblem(person, actorId);
  if (cannot) return cannot;
  const earlier = namedOn.get(person.id);
  if (earlier !== undefined) return PLATFORM_REFUSALS.personTwice(person.name, earlier + 1);
  namedOn.set(person.id, index);
  return null;
}

/**
 * Why a stage can't be removed from a chain, or null: the chain keeps at least one stage
 * (`remaining`, how many are left once it goes), and a stage some version in review still needs
 * stays (`waiting`, from `versionsNeeding`). The chain editor shows it at the stage's Remove;
 * `saveApprovalChain` refuses with it.
 */
export function removeStageRefusal(stage: { name: string; waiting: number }, remaining: number): Refusal | null {
  if (remaining < 1) return PLATFORM_REFUSALS.oneStage;
  if (stage.waiting > 0) return PLATFORM_REFUSALS.stageWaiting(stage.waiting, stage.name);
  return null;
}

/**
 * The whole chain, in order. Existing stages keep their id, so a new rule on a stage reaches the
 * versions that will reach it; new ones get `id: null`. Versions in review go through the stages they
 * recorded at submit, so no edit moves them. Refuses a stale stage id, then the first of
 * `validateChain`'s problems, then removing a stage an in-review version still needs (the one it waits
 * on, or one ahead of it in its own stages). `people` holds everyone, with the facts `validateChain`
 * checks.
 */
export function saveApprovalChain(input: {
  contentType: { id: string; name: string };
  current: ApprovalStage[];
  next: StageInput[];
  inReview: { versionId: string; stages: VersionStage[] | null; currentStage: number }[];
  people: ApproverFacts[];
  actor: Named;
  now: Date;
}):
  | Ok<{
      stages: (Omit<ApprovalStage, "id"> & { id: string | null })[];
      effects: AccessEffect[];
    }>
  | Refused {
  const { contentType, people } = input;
  const current = [...input.current].sort((a, b) => a.position - b.position);
  if (input.next.length === 0) return refuse(PLATFORM_REFUSALS.oneStage);

  const currentIds = new Set(current.map((s) => s.id));
  const ids = new Set<string>();
  for (const s of input.next) {
    if (s.id !== undefined && (!currentIds.has(s.id) || ids.has(s.id))) return refuse(PLATFORM_REFUSALS.stageGone);
    if (s.id) ids.add(s.id);
  }
  const problem = validateChain({ stages: input.next, current, actorId: input.actor.id, people })[0];
  if (problem) return refuse(problem);

  const needing = versionsNeeding(input.inReview, current);
  for (const s of current) {
    if (ids.has(s.id)) continue;
    const refusal = removeStageRefusal({ name: s.name, waiting: needing[s.id] ?? 0 }, input.next.length);
    if (refusal) return refuse(refusal);
  }

  const stages = input.next.map((s, position) => ({
    id: s.id ?? null,
    position,
    name: s.name.trim(),
    rule: s.rule.kind === "user" ? { kind: "user" as const, userId: s.rule.userId } : { kind: "team_role" as const, role: s.rule.role },
  }));

  const change = describeChainChange({ contentTypeName: contentType.name, current, next: input.next, people });
  if (!change.changed) return { ok: true, stages, effects: [] };

  const chainText = (list: { name: string; rule: ApproverRule }[]) =>
    list.map((s) => `${s.name} (${ruleLabel(s.rule, people)})`).join(" → ");
  return {
    ok: true,
    stages,
    effects: [
      configChanged("approval_chains", null, `Set ${contentType.name} approval chain: ${chainText(stages)}`, {
        contentTypeId: contentType.id,
        contentTypeName: contentType.name,
        before: current.map((s) => s.name),
        after: stages.map((s) => s.name),
        stages: stages.map((s) => ({ name: s.name, rule: s.rule })),
      }),
    ],
  };
}

// ── Business time zone ───────────────────────────────────────────────────────

export interface ZoneChange {
  /** Why the zone picked can't be saved (one off the list), or null. */
  problem: Refusal | null;
  /** The zone picked differs from the one in force. */
  changed: boolean;
  /** "New sunset dates end at 00:00 Pacific (America/Los_Angeles).", once a different zone is picked. */
  lines: string[];
}

/**
 * What picking `next` does, as the admin picks it (the settings screen calls this; `setBusinessZone`
 * refuses with the same `problem`).
 */
export function describeZoneChange(input: { current: string; next: string }): ZoneChange {
  const problem = isBusinessZone(input.next) ? null : PLATFORM_REFUSALS.pickZone;
  const changed = input.next !== input.current;
  return { problem, changed, lines: changed && !problem ? [`New sunset dates end at 00:00 ${zoneLabel(input.next)}.`] : [] };
}

/**
 * What any change of zone leaves in place, from the stored facts (the read model returns it as
 * `consequences`): "2 sunsets already set don't move: their consumers have been told when they end."
 * Nothing with none set. A sunset already set keeps its instant (decision 0017).
 */
export function zoneChangeConsequences(pendingSunsets: number): string[] {
  if (pendingSunsets === 1) return ["1 sunset already set doesn't move: its consumers have been told when it ends."];
  if (pendingSunsets > 1) return [`${pendingSunsets} sunsets already set don't move: their consumers have been told when they end.`];
  return [];
}

/**
 * Sets the business time zone sunset dates are read in. One of `BUSINESS_ZONES` (`describeZoneChange`);
 * the same zone again changes nothing and records nothing. Nothing else is written: sunsets already set
 * keep their instants.
 */
export function setBusinessZone(input: {
  current: string;
  next: string;
  pendingSunsets: number;
  actor: Named;
  now: Date;
}): Ok<{ zone: BusinessZone; effects: AccessEffect[] }> | Refused {
  const { current, next, pendingSunsets } = input;
  const change = describeZoneChange({ current, next });
  if (change.problem || !isBusinessZone(next)) return refuse(change.problem ?? PLATFORM_REFUSALS.pickZone);
  if (!change.changed) return { ok: true, zone: next, effects: [] };
  return {
    ok: true,
    zone: next,
    effects: [
      configChanged("business_zone", null, `Set the business time zone to ${zoneLabel(next)}`, {
        from: current,
        to: next,
        pendingSunsets,
      }),
    ],
  };
}

/** The contract check: these are `PlatformConfigDomain` (access-types.ts). */
export const platformConfig = {
  createTeam,
  updateRequiredSections,
  setChannelRule,
  saveApprovalChain,
  setBusinessZone,
} satisfies PlatformConfigDomain;
