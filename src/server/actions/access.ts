"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { ACCESS_REFUSALS } from "@/domain/access/refusals";
import {
  ACCESS_REASON_MAX,
  DECISION_NOTE_MAX,
  type ActionResult,
  type RecertDecision,
  type RequestableRole,
} from "@/domain/access-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { TEAM_ROLES, type TeamRole } from "@/domain/types";
import { services } from "@/server/services";
import type { Changed } from "@/server/services/types";
import { serverAction } from "./kit";

// Team access: requesting and deciding access, members, inactivity and recertification. Each action runs on the
// server action kit (kit.ts) behind the access service (src/server/services/access.ts, which says what each
// command promises and refuses): it parses its input and calls `services().access`, which checks the permission
// on the team, decides with the domain and writes the change with its audit rows and notifications, or refuses
// and writes nothing. Then the pages refresh: the switcher summaries, the sidebar card and the settings sections
// all move. A double click or a colleague acting first is refused with the domain's sentence.
//
// A "use server" file may export only async functions: the helpers below stay private.

/** Every page reads access: the layout (the switcher, the sidebar card) and the settings sections. */
function refreshAfter() {
  revalidatePath("/", "layout");
  refresh();
}

/** Input that doesn't parse is refused with the parser's first problem. */
const invalid = (error: z.ZodError) =>
  REQUEST_REFUSALS.invalidInput(error.issues[0]?.message);

const Id = z.string().min(1).max(64);
const MemberInput = z.object({ membershipId: Id });

/** A member command that names only the membership. */
type MemberCommand =
  "removeMember" | "reinstateMember" | "suspendInactive" | "keepInactive";

/** A member action: parse the membership, call the service's command, refresh. */
function memberAction(
  raw: unknown,
  command: MemberCommand,
): Promise<ActionResult> {
  return serverAction(raw, {
    input: MemberInput,
    invalid,
    call: (ctx, input) => services().access[command](ctx, input),
    after: refreshAfter,
  });
}

// ── Requesting and deciding access ───────────────────────────

const RequestInput = z.object({
  teamId: Id,
  // Any team role parses; the backend refuses one that can't be requested (`pick_requestable_role`).
  role: z.enum(TEAM_ROLES),
  reason: z.string().max(ACCESS_REASON_MAX * 2),
});

/** Anyone asks for Viewer, Author or Approver on a team, with a reason. The team's Team Admins are told. */
export async function requestAccess(input: {
  teamId: string;
  role: RequestableRole;
  reason: string;
}): Promise<ActionResult<{ requestId: string }>> {
  return serverAction(input, {
    input: RequestInput,
    invalid,
    call: (ctx, input) => services().access.requestAccess(ctx, input),
    after: refreshAfter,
  });
}

const DecideInput = z.object({
  requestId: Id,
  decision: z.enum(["approve", "deny"]),
  note: z
    .string()
    .max(DECISION_NOTE_MAX * 2)
    .optional(),
});

/** A Team Admin approves (membership created, extended or reinstated) or denies (with a note) a request. */
export async function decideAccessRequest(input: {
  requestId: string;
  decision: "approve" | "deny";
  note?: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: DecideInput,
    invalid,
    call: (ctx, input) => services().access.decideRequest(ctx, input),
    after: refreshAfter,
  });
}

// ── Members and inactivity ───────────────────────────────────

const RolesInput = MemberInput.extend({
  roles: z.array(z.enum(TEAM_ROLES)).max(TEAM_ROLES.length),
});

/** Replace a member's roles. A team keeps at least one active Team Admin. The roles they have change nothing. */
export async function changeMemberRoles(input: {
  membershipId: string;
  roles: TeamRole[];
}): Promise<ActionResult> {
  return serverAction(input, {
    input: RolesInput,
    // Roles that don't parse are asked for again, whatever else is wrong.
    invalid: (error) =>
      error.issues.some((issue) => issue.path[0] === "roles")
        ? ACCESS_REFUSALS.pickRoles
        : REQUEST_REFUSALS.invalidInput(error.issues[0]?.message),
    call: (ctx, input) => services().access.changeRoles(ctx, input),
    after: ({ changed }) => {
      if (changed) refreshAfter();
    },
  }).then(withoutChanged);
}

/** The action answers `{ ok: true }`: whether the service wrote is the kit's business (`after`), not the page's. */
function withoutChanged(result: ActionResult<Changed>): ActionResult {
  return result.ok ? { ok: true } : result;
}

/** Remove a member: the membership is deleted. */
export async function removeMember(input: {
  membershipId: string;
}): Promise<ActionResult> {
  return memberAction(input, "removeMember");
}

/** Restore a suspended or lapsed member with their previous roles (their inactivity clock restarts). */
export async function reinstateMember(input: {
  membershipId: string;
}): Promise<ActionResult> {
  return memberAction(input, "reinstateMember");
}

/** Suspend a member flagged for inactivity (90 days or more without a sign-in). */
export async function suspendInactive(input: {
  membershipId: string;
}): Promise<ActionResult> {
  return memberAction(input, "suspendInactive");
}

/** Keep a flagged member: their inactivity clock restarts now. */
export async function keepInactive(input: {
  membershipId: string;
}): Promise<ActionResult> {
  return memberAction(input, "keepInactive");
}

// ── Recertification ──────────────────────────────────────────

const RecertItemInput = z.object({
  recertId: Id,
  userId: Id,
  decision: z.enum(["keep", "remove"]),
});

/** Keep or Remove one member in an open review. Remove ends access at once; the last decision closes it. */
export async function decideRecertItem(input: {
  recertId: string;
  userId: string;
  decision: RecertDecision;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: RecertItemInput,
    invalid,
    call: (ctx, input) => services().access.decideRecertItem(ctx, input),
    after: refreshAfter,
  });
}

/** Start a review now, due in 30 days, covering the team's members (Team Admins aside). */
export async function startRecertification(input: {
  teamId: string;
}): Promise<ActionResult<{ recertId: string }>> {
  return serverAction(input, {
    input: z.object({ teamId: Id }),
    invalid,
    call: (ctx, input) => services().access.startRecertification(ctx, input),
    after: refreshAfter,
  });
}
