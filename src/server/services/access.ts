// Team access: asking for a role, deciding requests, the members table, recertification and inactivity.
// Each command runs the access sweeps first, in their own transaction, once its permission has passed
// (`accessAction` in src/server/actions/access.ts); after the port the sweeps are the backend's scheduled jobs.
//
// Typed for step 2b from today's read models; they still run in src/server/actions/access.ts and
// src/server/queries/access.ts.

import type {
  AccessRequestsSection,
  InactivitySection,
  MembersSection,
  RecertDecision,
  RecertificationSection,
  RequestAccessData,
  RequestableRole,
  SidebarCardModel,
} from "@/domain/access-types";
import type { TeamRole } from "@/domain/types";
import type { ActionResult, ReadResult, RequestContext } from "./types";

export interface AccessService {
  requestAccess(
    ctx: RequestContext,
    input: { teamId: string; role: RequestableRole; reason: string },
  ): Promise<ActionResult<{ requestId: string }>>;
  decideRequest(
    ctx: RequestContext,
    input: { requestId: string; decision: "approve" | "deny"; note?: string },
  ): Promise<ActionResult>;
  changeRoles(
    ctx: RequestContext,
    input: { membershipId: string; roles: TeamRole[] },
  ): Promise<ActionResult>;
  removeMember(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  reinstateMember(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  suspendInactive(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  keepInactive(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  decideRecertItem(
    ctx: RequestContext,
    input: { recertId: string; userId: string; decision: RecertDecision },
  ): Promise<ActionResult>;
  startRecertification(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ActionResult<{ recertId: string }>>;

  /** The request-access page: the teams the viewer may ask to join, and their own requests. */
  requestAccessData(ctx: RequestContext): Promise<RequestAccessData>;
  members(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<{ section: MembersSection }>>;
  requests(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<{ section: AccessRequestsSection }>>;
  recertification(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<{ section: RecertificationSection }>>;
  inactivity(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<{ section: InactivitySection }>>;
  /** The one dismissible sidebar card per space, keyed by team id. */
  sidebarCards(
    ctx: RequestContext,
  ): Promise<Record<string, SidebarCardModel | null>>;
  /** The card for a viewer with no space yet (their pending request). */
  homeCard(ctx: RequestContext): Promise<SidebarCardModel | null>;
}
