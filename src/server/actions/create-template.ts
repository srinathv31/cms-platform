"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { teams } from "@/server/db/schema/ucomp";
import { now } from "@/server/clock";
import { inTransaction } from "@/server/effects";
import { getViewer } from "@/server/viewer";
import { newId } from "@/server/ids";
import {
  conformToContentType,
  disclosureContentType,
  freshTemplateId,
  insertNewTemplate,
} from "@/server/templates/create";
import { buildStarter, isStarterKey, type StarterKey } from "@/server/starters";
import { assertCan } from "@/domain/permissions";
import { JUST_CREATED_COOKIE, JUST_CREATED_MAX_AGE } from "@/components/workspace/just-created";
import { createDraft } from "@/domain/lifecycle";

// New template, from a starter. It sits apart from the other template actions (templates.ts)
// because it is the only one that builds starters: the starter bodies, and the editor schema they
// are normalized with, load only where New template is offered, not with every Edit button.

const CreateTemplateInput = z.object({
  teamSlug: z.string().min(1).max(64),
  starterKey: z.string(),
});

/**
 * Creates a template and its first draft from a starter, then opens it in the workspace. The name
 * field selects the name on arrival so the author can rename it at once: it learns the template is
 * new from a one-shot cookie (`just-created.ts`), so the redirect goes to the template's own address
 * and the address bar never needs tidying (one history entry; Back returns to the Library).
 * Blank starts as "Untitled template"; an example keeps its own name.
 */
export async function createTemplate(input: { teamSlug: string; starterKey: StarterKey }): Promise<void> {
  const viewer = await getViewer();

  // The team is looked up only to know which team the permission is checked on. An unknown team
  // has no id, so the check fails the same way as a team the viewer can't write to.
  const parsed = CreateTemplateInput.safeParse(input);
  const team = parsed.success
    ? await db.query.teams.findFirst({ where: eq(teams.slug, parsed.data.teamSlug) })
    : undefined;
  assertCan(viewer, "template.create", { teamId: team?.id ?? null });

  if (!parsed.success || !team) throw new Error("Unknown team");
  if (!isStarterKey(parsed.data.starterKey)) throw new Error("Unknown starter");
  const starterKey = parsed.data.starterKey;

  const at = await now();
  const contentType = await disclosureContentType();
  const templateId = await freshTemplateId();

  const starter = conformToContentType(buildStarter(starterKey, { scope: templateId, now: at }), contentType);
  const created = createDraft({ starter, createdBy: viewer.userId, now: at });
  const versionId = newId("v");

  // Retried while the file is busy, like every lifecycle write (`inTransaction`).
  await inTransaction(db, async (tx) => {
    await insertNewTemplate(tx, {
      templateId,
      teamId: team.id,
      contentTypeId: contentType.id,
      versionId,
      created,
      at,
      actorId: viewer.userId,
    });
  });

  (await cookies()).set(JUST_CREATED_COOKIE, templateId, {
    path: "/",
    sameSite: "lax",
    maxAge: JUST_CREATED_MAX_AGE,
  });
  // The library lists now include it.
  revalidatePath("/[team]/library", "page");
  redirect(`/${team.slug}/templates/${templateId}`);
}
