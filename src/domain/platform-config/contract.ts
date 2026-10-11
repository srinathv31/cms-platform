// The contract check: the platform settings functions satisfy `PlatformConfigDomain` (access-types.ts).

import type { PlatformConfigDomain } from "../access-types";
import { saveApprovalChain } from "./approval-chains";
import { setChannelRule } from "./channels";
import { updateRequiredSections } from "./sections";
import { createTeam } from "./teams";
import { setBusinessZone } from "./time-zone";

/** The contract check: these are `PlatformConfigDomain` (access-types.ts). */
export const platformConfig = {
  createTeam,
  updateRequiredSections,
  setChannelRule,
  saveApprovalChain,
  setBusinessZone,
} satisfies PlatformConfigDomain;
