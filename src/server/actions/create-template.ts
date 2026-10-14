"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { newId } from "@/server/ids";
import {
  conformToContentType,
  draftContentOf,
  prepareDraftContent,
} from "@/server/templates/create";
import { services } from "@/server/services";
import {
  STARTER_KEYS,
  buildStarter,
  type StarterChoice,
} from "@/server/starters";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import {
  JUST_CREATED_COOKIE,
  JUST_CREATED_MAX_AGE,
} from "@/domain/arrival-cookies";
import { refuse, serverAction } from "./kit";

// New template, from a starter, on the server action kit (kit.ts). It sits apart from the other
// template actions (templates.ts) because it is the only one that builds starters: the starter bodies,
// and the editor schema they are normalized with, load only where New template is offered, not with
// every Edit button.
//
// The BFF builds the first draft (decision 0065, H3): it resolves the team's slug to its id, asks the backend
// which content type the kind chosen is made on, builds the starter for it, fits it to that content type, and
// makes its documents ready for storage. The backend stores the draft (`templates.create`).

const team = { teamSlug: z.string().min(1).max(64) };

/** A starter of the kind chosen: a Document's starter keys, or an Alert's (`STARTER_KEYS`). */
const CreateTemplateInput = z.discriminatedUnion("family", [
  z.object({
    ...team,
    family: z.literal("document"),
    starterKey: z.enum(STARTER_KEYS.document),
  }),
  z.object({
    ...team,
    family: z.literal("message"),
    starterKey: z.enum(STARTER_KEYS.message),
  }),
]);

/**
 * Creates a template and its first draft from a starter of the kind the author chose, Document or
 * Alert, then opens it in the workspace. The kind decides the content type (`newTemplateType`),
 * which the template keeps for life (decision 0034): a document renders PDF, Web and Email, an alert
 * Push and SMS. The name field selects the name on arrival so the author can rename it at once: it
 * learns the template is new from a one-shot cookie (`just-created.ts`), so the redirect goes to the
 * template's own address and the address bar never needs tidying (one history entry; Back returns to
 * the Library). Blank starts as "Untitled template"; an example keeps its own name. A refusal (a viewer
 * who can't create on the team, a kind no content type makes) is the answer instead, and nothing is
 * written.
 */
export async function createTemplate(
  input: { teamSlug: string } & StarterChoice,
): Promise<ActionResult> {
  return serverAction(input, {
    input: CreateTemplateInput,
    call: async (ctx, input) => {
      // The URL's team, resolved once to its id: an unknown team and one the viewer may not enter read the same.
      const space = await services().identity.space(ctx, {
        slug: input.teamSlug,
      });
      if (!space.ok) refuse(space);
      // All teams isn't a team to create in.
      const { teamId } = space.space;
      if (teamId === null) refuse(REQUEST_REFUSALS.teamGone);

      const type = await services().templates.newTemplateType(ctx, {
        teamId,
        family: input.family,
      });
      if (!type.ok) refuse(type);

      // The starter's sample dates are set from the backend's instant: the BFF reads no clock.
      const starter = conformToContentType(
        buildStarter(input, { scope: newId("st"), now: new Date(type.asOf) }),
        type,
      );
      const prepared = prepareDraftContent(draftContentOf(starter));
      // A starter that fails the document check is a bug in the starter, not a refusal.
      if (!prepared.ok)
        throw new Error(
          `The ${input.family} starter ${input.starterKey} fails the document check: ${prepared.message}`,
        );

      return services().templates.create(ctx, {
        teamId,
        contentTypeId: type.contentTypeId,
        draft: prepared.draft,
      });
    },
    after: async ({ templateId }, { input }) => {
      (await cookies()).set(JUST_CREATED_COOKIE, templateId, {
        path: "/",
        sameSite: "lax",
        maxAge: JUST_CREATED_MAX_AGE,
      });
      // The library lists now include it.
      revalidatePath("/[team]/library", "page");
      redirect(`/${input.teamSlug}/templates/${templateId}`);
    },
  });
}
