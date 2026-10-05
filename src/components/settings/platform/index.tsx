import type { PlatformSettingsSection } from "@/domain/access-types";
import {
  getApprovalChainsSection,
  getChannelRulesSection,
  getContentTypesSection,
  getTeamsSection,
} from "@/server/queries/platform";
import type { SectionBody } from "../section-body";
import { ApprovalChainsSectionView } from "./approval-chains";
import { ChannelRulesSectionView } from "./channel-rules";
import { ContentTypesSectionView } from "./content-types";
import { TeamsSectionView } from "./teams";

// Platform group section bodies (Phase 6, slice U2). Each is an async server component that reads its
// query (a 404 for anyone but a Platform Admin) inside the settings panel's Suspense, then hands the
// read model to a client view.

async function Teams() {
  return <TeamsSectionView section={await getTeamsSection()} />;
}

async function ContentTypes() {
  return <ContentTypesSectionView types={(await getContentTypesSection()).types} />;
}

async function ChannelRules() {
  return <ChannelRulesSectionView section={await getChannelRulesSection()} />;
}

async function ApprovalChains() {
  return <ApprovalChainsSectionView section={await getApprovalChainsSection()} />;
}

export const PLATFORM_SECTION_BODIES: Record<PlatformSettingsSection, SectionBody> = {
  teams: Teams,
  "content-types": ContentTypes,
  "channel-rules": ChannelRules,
  "approval-chains": ApprovalChains,
};
