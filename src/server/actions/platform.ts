"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/domain/access-types";
import {
  CHANNELS,
  type ApproverRule,
  type Channel,
  type RequiredSection,
} from "@/domain/types";
import { services } from "@/server/services";
import type { Changed } from "@/server/services/types";
import { serverAction } from "./kit";

// Platform settings (Platform Admin): teams, content types, channel rules, approval chains and the business time
// zone (contract: `PlatformActions` in queries/access-models.ts). Each action runs on the server action kit
// (kit.ts) behind the platform service (src/server/services/platform.ts, which says what each command promises
// and refuses): it parses its input and calls `services().platform`, which checks `platform.manage`, decides with
// the domain (domain/platform-config/) and writes with its audit rows and notifications. Then every page
// refreshes (the switcher, the sidebar and the settings modal all read this configuration), unless the setting
// was saved as it already was.
//
// A "use server" file may export only async functions: the helpers below stay private.

function refreshAll() {
  revalidatePath("/", "layout");
  refresh();
}

/** Refreshes only when the service wrote something. */
function refreshIfChanged({ changed }: Changed) {
  if (changed) refreshAll();
}

/** The action answers `{ ok: true }`: whether the service wrote is the kit's business (`after`), not the page's. */
function withoutChanged(result: ActionResult<Changed>): ActionResult {
  return result.ok ? { ok: true } : result;
}

// ── Teams ─────────────────────────────────────────────────────

const CreateTeamInput = z.object({
  name: z.string().max(500),
  description: z.string().max(2000),
  icon: z.string().max(64),
  adminUserId: z.string().min(1).max(64),
});

/** Creates a team (its slug from the name) with its first Team Admin, who is told. */
export async function createTeam(input: {
  name: string;
  description: string;
  icon: string;
  adminUserId: string;
}): Promise<ActionResult<{ teamId: string; slug: string }>> {
  return serverAction(input, {
    input: CreateTeamInput,
    call: (ctx, input) => services().platform.createTeam(ctx, input),
    after: refreshAll,
  });
}

// ── Content types ─────────────────────────────────────────────

const SectionsInput = z.object({
  contentTypeId: z.string().min(1).max(64),
  requiredSections: z
    .array(z.object({ key: z.string().max(64), title: z.string().max(500) }))
    .max(30),
});

/**
 * Replaces a content type's required sections (in order; existing ones by key). Only templates
 * created afterwards take the new sections: existing documents keep the headings they carry.
 */
export async function updateContentType(input: {
  contentTypeId: string;
  requiredSections: RequiredSection[];
}): Promise<ActionResult> {
  return serverAction(input, {
    input: SectionsInput,
    call: (ctx, input) => services().platform.updateContentType(ctx, input),
    after: refreshIfChanged,
  }).then(withoutChanged);
}

// ── Channel rules ─────────────────────────────────────────────

const ChannelInput = z.object({
  contentTypeId: z.string().min(1).max(64),
  channel: z.enum(CHANNELS),
  allowed: z.boolean(),
});

/**
 * Turns a channel on or off for a content type. Off takes effect at once: the render API refuses the
 * channel for the type's templates, Active versions included (the confirm named how many). A channel
 * of the other family (a document type's Push or SMS, a message type's PDF, Web or Email) is refused.
 */
export async function setChannelRule(input: {
  contentTypeId: string;
  channel: Channel;
  allowed: boolean;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: ChannelInput,
    call: (ctx, input) => services().platform.setChannelRule(ctx, input),
    after: refreshIfChanged,
  }).then(withoutChanged);
}

// ── Approval chains ───────────────────────────────────────────

// Only the Approver role decides, so it is the only role a stage may name (domain validateChain).
const RuleInput: z.ZodType<ApproverRule> = z.union([
  z.object({ kind: z.literal("team_role"), role: z.literal("approver") }),
  z.object({ kind: z.literal("user"), userId: z.string().min(1).max(64) }),
]);

const ChainInput = z.object({
  contentTypeId: z.string().min(1).max(64),
  stages: z
    .array(
      z.object({
        id: z.string().min(1).max(64).optional(),
        name: z.string().max(500),
        rule: RuleInput,
      }),
    )
    .max(20),
});

/**
 * Saves the whole chain, in order. Every stage must pass the domain's `validateChain`, which the chain
 * editor also runs as the admin edits. Existing stages keep their id; versions in review keep the
 * stages they recorded at submit, and a new rule on a stage reaches them when they reach it.
 */
export async function saveApprovalChain(input: {
  contentTypeId: string;
  stages: { id?: string; name: string; rule: ApproverRule }[];
}): Promise<ActionResult> {
  return serverAction(input, {
    input: ChainInput,
    call: (ctx, input) => services().platform.saveApprovalChain(ctx, input),
    after: refreshIfChanged,
  }).then(withoutChanged);
}

// ── Business time zone ────────────────────────────────────────

const ZoneInput = z.object({ zone: z.string().min(1).max(64) });

/**
 * Sets the business time zone sunset dates are read in (decision 0017): one of `BUSINESS_ZONES`. Only
 * dates picked afterwards follow it; every sunset already set keeps its instant, since its consumers
 * have been told when it ends. The same zone again writes nothing.
 */
export async function setBusinessZone(input: {
  zone: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: ZoneInput,
    call: (ctx, input) => services().platform.setBusinessZone(ctx, input),
    after: refreshIfChanged,
  }).then(withoutChanged);
}
