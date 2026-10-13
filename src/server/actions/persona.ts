"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh, revalidatePath } from "next/cache";
import type { Route } from "next";
import { z } from "zod";
import { demoToolsRefusal } from "@/domain/demo";
import { ALL_SPACE } from "@/domain/permissions";
import { RESERVED_SLUGS } from "@/domain/platform-config/limits";
import type { ActionResult } from "@/domain/review-types";
import { DEMO_MODE } from "@/server/config";
import { services } from "@/server/services";
import { PERSONA_COOKIE } from "@/server/viewer";
import { serverAction } from "./kit";

const YEAR = 60 * 60 * 24 * 365;

/** First path segment of an in-app path ("/coral-offers/library" → "coral-offers"). */
function firstSegment(path: string): string | null {
  if (!path.startsWith("/")) return null;
  return path.split("?")[0]!.split("/").filter(Boolean)[0] ?? null;
}

const SwitchInput = z.object({
  personaId: z.string().min(1).max(64),
  currentPath: z.string().max(2048),
});

/**
 * Demo persona switch. There is no login: this counts as the persona's sign-in, behind the demo service
 * (`demo.switchPersona`), which runs the scheduled jobs FIRST (a member past a deadline lost access before
 * signing in), then restarts their inactivity clock, and says where they land. Then the persona cookie is set.
 * Stay on the same URL if the new persona may enter the space it names, otherwise go to their first space.
 * A demo tool, so it checks no permission: it checks the demo flag (`DEMO_MODE`, decision 0051; off, it
 * answers `demo_mode_off` and sets nothing), and a persona that isn't one is refused (`invalid_input`).
 */
export async function switchPersona(
  personaId: string,
  currentPath: string,
): Promise<ActionResult> {
  const off = demoToolsRefusal(DEMO_MODE);
  if (off) return off;

  return serverAction(
    { personaId, currentPath },
    {
      input: SwitchInput,
      call: (ctx, { personaId, currentPath }) => {
        const segment = firstSegment(currentPath);
        // The URL's first segment names a space (All teams included) unless it is one of the app's own routes.
        const slug =
          segment !== null &&
          (segment === ALL_SPACE || !RESERVED_SLUGS.has(segment))
            ? segment
            : null;
        return services().demo.switchPersona(ctx, { userId: personaId, slug });
      },
      after: async (landing, { input }) => {
        (await cookies()).set(PERSONA_COOKIE, input.personaId, {
          path: "/",
          sameSite: "lax",
          maxAge: YEAR,
        });
        revalidatePath("/", "layout");

        const home = (
          landing.homeSlug ? `/${landing.homeSlug}/library` : "/request-access"
        ) as Route;
        const segment = firstSegment(input.currentPath);
        if (segment === null) return refresh();
        if (segment === "request-access") {
          // Anyone may request access, but someone who already has a team lands in it.
          if (landing.homeSlug) redirect(home);
          return refresh();
        }
        if (landing.space) return refresh();
        redirect(home);
      },
    },
  ).then((result) => (result.ok ? { ok: true } : result));
}
