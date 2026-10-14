// Platform settings (Platform Admin): teams, content types and their required sections, which channels a
// content type allows, its approval chain, and the business time zone sunsets are read in.
//
// Every command checks `platform.manage` first (`generic` for anyone else), then asks the domain
// (src/domain/platform-config) and writes its answer with its audit rows and notifications. A setting saved as it
// already is answers `changed: false` and writes nothing. A refusal writes nothing.
//
// The reads answer facts: the configuration as stored, what the admin may do on it (`can`, decided), and
// `Person` lists for the ids they name. Every section refuses 403 `generic` unless the viewer holds
// `platform.manage` (the Platform Admin). The BFF words and lays out what they show: a stage's rule label, the
// people's "All teams", the time zones' labels and "2 sunsets already set don't move"
// (src/server/queries/platform.ts, decision 0018 amended).
//
// The commands run behind the seam, local and fake; the reads run behind it in the local implementation.

import type { ApproverFacts } from "@/domain/access-types";
import type { Person } from "@/domain/review-types";
import type {
  ApproverRule,
  Channel,
  PermissionResult,
  RequiredSection,
} from "@/domain/types";
import type {
  ActionResult,
  Changed,
  ReadResult,
  RequestContext,
} from "./types";

export interface PlatformService {
  /**
   * Creates a team, its slug from its name, with its first Team Admin, who is told. `teamId` is the new team's
   * opaque id, never its slug (decision 0053). Refuses `generic`, `pick_person` (no such person), then the
   * domain's `auditor_cant_be_admin`, `team_name_missing`, `team_name_too_long`, `team_description_too_long`,
   * `team_icon_missing`, `team_name_reserved`, `team_name_taken`.
   */
  createTeam(
    ctx: RequestContext,
    input: {
      name: string;
      description: string;
      icon: string;
      adminUserId: string;
    },
  ): Promise<ActionResult<{ teamId: string; slug: string }>>;
  /**
   * Replaces a content type's required sections, in order (existing ones by key). Only templates created
   * afterwards take them. Refuses `generic`, `content_type_gone`, then the domain's `sections_on_messages`,
   * `last_section`, `section_title_missing`, `section_title_too_long`, `section_duplicate`.
   */
  updateContentType(
    ctx: RequestContext,
    input: { contentTypeId: string; requiredSections: RequiredSection[] },
  ): Promise<ActionResult<Changed>>;
  /**
   * Turns a channel on or off for a content type; off takes effect at once, for Active versions too. Refuses
   * `generic`, `content_type_gone`, then the domain's `channel_family` (a channel of the other family) and
   * `last_channel`.
   */
  setChannelRule(
    ctx: RequestContext,
    input: { contentTypeId: string; channel: Channel; allowed: boolean },
  ): Promise<ActionResult<Changed>>;
  /**
   * Saves the whole chain, in order; existing stages keep their id, and a waiting stage that now names someone
   * else tells them about the versions already waiting on it. Versions in review keep the stages they were
   * submitted with. Refuses `generic`, `content_type_gone`, then the domain's `stage_changed` (a stale stage id),
   * the first of `validateChain`'s problems (`last_stage`, `stage_name_missing`, `stage_name_too_long`,
   * `stage_duplicate`, `pick_stage_role`, `role_cant_approve`, `pick_person`, `names_yourself`,
   * `auditor_cant_approve`, `admin_without_team_role`, `no_active_access`, `person_on_two_stages`), and
   * `stage_in_use` for a stage a version in review still needs.
   */
  saveApprovalChain(
    ctx: RequestContext,
    input: {
      contentTypeId: string;
      stages: { id?: string; name: string; rule: ApproverRule }[];
    },
  ): Promise<ActionResult<Changed>>;
  /**
   * Sets the business time zone sunset dates are read in (decision 0017). Every sunset already set keeps its
   * instant. Refuses `generic`, then `pick_zone` for a zone off the list.
   */
  setBusinessZone(
    ctx: RequestContext,
    input: { zone: string },
  ): Promise<ActionResult<Changed>>;

  /** Every team, with its Team Admins, its size and who it messages as; and who could be a new team's first Team Admin. */
  teams(ctx: RequestContext): Promise<ReadResult<TeamsFacts>>;
  /** Every content type, with its sections, its channels and whether its sections may be edited. */
  contentTypes(ctx: RequestContext): Promise<ReadResult<ContentTypesFacts>>;
  /** Per content type and channel: whether it is on, how many Active versions use it, and whether its switch may flip. */
  channelRules(ctx: RequestContext): Promise<ReadResult<ChannelRulesFacts>>;
  /** Per content type: its stages in order, with the versions in review that still need each. */
  approvalChains(ctx: RequestContext): Promise<ReadResult<ApprovalChainsFacts>>;
  /** The business time zone in force, and how many sunsets already set a change of zone would leave in place. */
  businessZone(ctx: RequestContext): Promise<ReadResult<BusinessZoneFacts>>;
}

// ── The reads' facts ─────────────────────────────────────────────────────────

/** A team in the Teams section. */
export interface PlatformTeamFacts {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  /** Its active Team Admins, by name (user ids). */
  adminIds: string[];
  /** People with an active membership. */
  members: number;
  templates: number;
  /** ISO. */
  createdAt: string;
  /** The app name the team's push notifications show ("Coral"); null when not set. */
  appName: string | null;
  /** The short code the team's SMS come from ("26725"); null when not set. */
  smsSender: string | null;
}

export interface TeamsFacts {
  /** By name. */
  teams: PlatformTeamFacts[];
  /** Whoever the domain lets be a new team's first Team Admin (everyone but an Auditor), by name. */
  firstAdminCandidates: { id: string; title: string }[];
  people: Person[];
}

export interface ContentTypeFacts {
  id: string;
  key: string;
  name: string;
  /** In the order of `CHANNELS`. */
  allowedChannels: Channel[];
  requiredSections: RequiredSection[];
  /** The SMS footer every SMS of this type ends with; null when none. */
  smsFooter: string | null;
  /** The parts an SMS may take with the long sample values before submit refuses it. */
  smsMaxParts: number;
  templates: number;
  can: {
    /** A message type has no sections to edit. */
    editSections: PermissionResult;
  };
}

export interface ContentTypesFacts {
  /** By name. */
  types: ContentTypeFacts[];
}

export interface ChannelRuleFacts {
  contentTypeId: string;
  name: string;
  allowed: Record<Channel, boolean>;
  /** Active versions that use each channel. */
  activeUsing: Record<Channel, number>;
  can: {
    /** Per channel, whether its switch may flip: the last channel on can't go off. */
    toggle: Record<Channel, PermissionResult>;
  };
}

export interface ChannelRulesFacts {
  /** By content type name. */
  rows: ChannelRuleFacts[];
}

export interface ChainStageFacts {
  id: string;
  /** 0-based, in order. */
  position: number;
  name: string;
  rule: ApproverRule;
  /**
   * Versions in review that still need this stage: the one they wait on, or one ahead of it in the stages
   * they recorded at submit. Removing it is refused while there are any.
   */
  waiting: number;
}

export interface ApprovalChainFacts {
  contentTypeId: string;
  name: string;
  stages: ChainStageFacts[];
}

export interface ApprovalChainsFacts {
  /** By content type name. */
  chains: ApprovalChainFacts[];
  /** People a stage may name, by name, with the names of the teams whose templates they see (shown beside theirs). */
  choices: { id: string; title: string; teamNames: string[] }[];
  /**
   * The facts `validateChain` checks, for everyone in `choices` and everyone a stage names now (who may have
   * lost access since).
   */
  approvers: ApproverFacts[];
  /** Everyone `choices`, `approvers` and the stages' rules name by id. */
  people: Person[];
}

export interface BusinessZoneFacts {
  /** ISO: the instant the pending sunsets were counted at. */
  asOf: string;
  /** The IANA id in force (the default until someone changes it). */
  zone: string;
  /** Superseded versions whose sunset is set and hasn't passed at `asOf`: what a change of zone leaves in place. */
  pendingSunsets: number;
  can: { change: PermissionResult };
}
