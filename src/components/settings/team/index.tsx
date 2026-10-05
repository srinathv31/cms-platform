import type { TeamSettingsSection } from "@/domain/access-types";
import type { SectionBody } from "../section-body";
import { AccessRequestsBody, InactivityBody, MembersBody, RecertificationBody } from "./bodies";

// Team group section bodies (Phase 6, slice U1). The group's nav counts live in ./nav-counts.ts.

export const TEAM_SECTION_BODIES: Record<TeamSettingsSection, SectionBody> = {
  members: MembersBody,
  "access-requests": AccessRequestsBody,
  recertification: RecertificationBody,
  inactivity: InactivityBody,
};
