// Team access: asking for a role, deciding requests, the members table, recertification and inactivity. The
// deadlines (recertification lapses, the inactivity flag and suspension) are the backend's scheduled jobs; the
// local implementation also runs them before each access command, its own lazy trigger.
//
// Typed for step 2b: they still run in src/server/actions/access.ts and src/server/queries/access.ts.

import type { TeamRole } from "@/domain/types";
import type {
  ActionResult,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";

/** A role a person may ask for: Team Admins are appointed, never requested. */
export type RequestableRole = "viewer" | "author" | "approver";

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
    input: { recertId: string; userId: string; decision: "keep" | "remove" },
  ): Promise<ActionResult>;
  startRecertification(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ActionResult<{ recertId: string }>>;

  /** The request-access page: the teams the viewer may ask to join, and their own requests. */
  requestAccessData(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the request-access facts">>>;
  members(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<Unsettled<"P4b: the members table's facts">>>;
  requests(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<Unsettled<"P4b: the access requests' facts">>>;
  recertification(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<Unsettled<"P4b: the recertification's facts">>>;
  inactivity(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<Unsettled<"P4b: the inactivity facts">>>;
  /** The one dismissible sidebar card per space, by team id. */
  sidebarCards(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the sidebar cards' facts">>>;
  /** The card for a viewer with no space yet (their pending request). */
  homeCard(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the home card's facts">>>;
}
