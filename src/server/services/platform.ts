// Platform settings (Platform Admin): teams, content types and their required sections, which channels a
// content type allows, its approval chain, and the business time zone sunsets are read in.
//
// Every command checks `platform.manage` first (`generic` for anyone else), then asks the domain
// (src/domain/platform-config) and writes its answer with its audit rows and notifications. A setting saved as it
// already is answers `changed: false` and writes nothing. A refusal writes nothing.
//
// The commands run behind the seam (local and fake); the reads are typed here and still run in
// src/server/queries/platform.ts until they move (plan P4b).

import type { ApproverRule, Channel, RequiredSection } from "@/domain/types";
import type {
  ActionResult,
  Changed,
  ReadResult,
  RequestContext,
  Unsettled,
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

  teams(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the teams' facts">>>;
  contentTypes(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the content types' facts">>>;
  channelRules(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the channel rules' facts">>>;
  approvalChains(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the approval chains' facts">>>;
  businessZone(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the business zone's facts">>>;
}
