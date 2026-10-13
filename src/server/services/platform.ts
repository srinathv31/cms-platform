// Platform settings (Platform Admin): teams, content types and their required sections, which channels a
// content type allows, its approval chain, and the business time zone sunsets are read in.
//
// Typed for step 2b from today's read models; they still run in src/server/actions/platform.ts and
// src/server/queries/platform.ts.

import type {
  ApprovalChainsSection,
  BusinessZoneSection,
  ChannelRulesSection,
  ContentTypesSection,
  TeamsSection,
} from "@/domain/access-types";
import type { ApproverRule, Channel, RequiredSection } from "@/domain/types";
import type { ActionResult, ReadResult, RequestContext } from "./types";

export interface PlatformService {
  createTeam(
    ctx: RequestContext,
    input: {
      name: string;
      description: string;
      icon: string;
      adminUserId: string;
    },
  ): Promise<ActionResult<{ teamId: string; slug: string }>>;
  updateContentType(
    ctx: RequestContext,
    input: { contentTypeId: string; requiredSections: RequiredSection[] },
  ): Promise<ActionResult>;
  setChannelRule(
    ctx: RequestContext,
    input: { contentTypeId: string; channel: Channel; allowed: boolean },
  ): Promise<ActionResult>;
  saveApprovalChain(
    ctx: RequestContext,
    input: {
      contentTypeId: string;
      stages: { id?: string; name: string; rule: ApproverRule }[];
    },
  ): Promise<ActionResult>;
  setBusinessZone(
    ctx: RequestContext,
    input: { zone: string },
  ): Promise<ActionResult>;

  teams(ctx: RequestContext): Promise<ReadResult<{ section: TeamsSection }>>;
  contentTypes(
    ctx: RequestContext,
  ): Promise<ReadResult<{ section: ContentTypesSection }>>;
  channelRules(
    ctx: RequestContext,
  ): Promise<ReadResult<{ section: ChannelRulesSection }>>;
  approvalChains(
    ctx: RequestContext,
  ): Promise<ReadResult<{ section: ApprovalChainsSection }>>;
  businessZone(
    ctx: RequestContext,
  ): Promise<ReadResult<{ section: BusinessZoneSection }>>;
}
