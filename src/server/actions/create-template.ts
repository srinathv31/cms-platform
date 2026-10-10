"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { teams } from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import { conformToContentType, freshTemplateId, insertNewTemplate, newTemplateType } from "@/server/templates/create";
import { STARTER_KEYS, buildStarter, type StarterChoice } from "@/server/starters";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { JUST_CREATED_COOKIE, JUST_CREATED_MAX_AGE } from "@/components/workspace/just-created";
import { createDraft } from "@/domain/lifecycle";
import { check, refuse, serverAction } from "./kit";

// New template, from a starter, on the server action kit (kit.ts). It sits apart from the other
// template actions (templates.ts) because it is the only one that builds starters: the starter bodies,
// and the editor schema they are normalized with, load only where New template is offered, not with
// every Edit button.

const team = { teamSlug: z.string().min(1).max(64) };

/** A starter of the kind chosen: a Document's starter keys, or an Alert's (`STARTER_KEYS`). */
const CreateTemplateInput = z.discriminatedUnion("family", [
  z.object({ ...team, family: z.literal("document"), starterKey: z.enum(STARTER_KEYS.document) }),
  z.object({ ...team, family: z.literal("message"), starterKey: z.enum(STARTER_KEYS.message) }),
]);

/**
 * Creates a template and its first draft from a starter of the kind the author chose, Document or
 * Alert, then opens it in the workspace. The kind decides the content type (`newTemplateContentType`),
 * which the template keeps for life (decision 0034): a document renders PDF, Web and Email, an alert
 * Push and SMS. The name field selects the name on arrival so the author can rename it at once: it
 * learns the template is new from a one-shot cookie (`just-created.ts`), so the redirect goes to the
 * template's own address and the address bar never needs tidying (one history entry; Back returns to
 * the Library). Blank starts as "Untitled template"; an example keeps its own name. A refusal (a viewer
 * who can't create on the team, a kind no content type makes) is the answer instead, and nothing is
 * written.
 */
export async function createTemplate(input: { teamSlug: string } & StarterChoice): Promise<ActionResult> {
  return serverAction(input, {
    input: CreateTemplateInput,
    // The team is looked up only to know which team the permission is checked on. An unknown team
    // has no id, so the check refuses it the same way as a team the viewer can't write to.
    authorize: async ({ viewer, input }) => {
      const team = await db.query.teams.findFirst({ where: eq(teams.slug, input.teamSlug) });
      check(viewer, "template.create", { teamId: team?.id ?? null });
      if (!team) refuse(REQUEST_REFUSALS.teamGone);
      return team;
    },
    transaction: async (tx, { viewer, input, found: team, now: at }) => {
      const chosen = await newTemplateType(input.family, tx);
      if (!chosen.ok) refuse(chosen);
      const { contentType } = chosen;
      const templateId = await freshTemplateId(tx);
      const starter = conformToContentType(buildStarter(input, { scope: templateId, now: at }), contentType);
      await insertNewTemplate(tx, {
        templateId,
        teamId: team.id,
        contentTypeId: contentType.id,
        versionId: newId("v"),
        created: createDraft({ starter, createdBy: viewer.userId, now: at }),
        at,
        actorId: viewer.userId,
      });
      return { ok: true, templateId };
    },
    after: async ({ templateId }, { found: team }) => {
      (await cookies()).set(JUST_CREATED_COOKIE, templateId, {
        path: "/",
        sameSite: "lax",
        maxAge: JUST_CREATED_MAX_AGE,
      });
      // The library lists now include it.
      revalidatePath("/[team]/library", "page");
      redirect(`/${team.slug}/templates/${templateId}`);
    },
  });
}
