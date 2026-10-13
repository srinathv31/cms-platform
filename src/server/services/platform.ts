// Platform settings (Platform Admin): teams, content types and their required sections, which channels a
// content type allows, its approval chain, and the business time zone sunsets are read in.
//
// Typed for step 2b: they still run in src/server/actions/platform.ts and src/server/queries/platform.ts.

import type { ApproverRule, Channel, RequiredSection } from "@/domain/types";
import type {
  ActionResult,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";

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
