import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Viewer } from "@/domain/types";
import { DEMO_MODE } from "./config";
import { services } from "./services";

// The sign-in stand-in. There is no real login yet: the persona switcher sets this cookie, and the request
// context (src/server/context/request.ts) asks `getViewer()` who it names. The cookie yields a credential, and
// the backend says whom it names (`identity.viewer`). It fails closed: a missing or unknown cookie is nobody,
// signed out, unless the demo tools are on (DEMO_MODE, decision 0051), where it is Maya so a fresh browser lands
// somewhere (handoff review S2). Real sign-in (decision 0054) replaces this file and context/sign-in.ts.
export const PERSONA_COOKIE = "ucomp_persona";
export const DEFAULT_PERSONA = "maya";

function viewerFor(userId: string): Promise<Viewer | null> {
  return services().identity.viewer({ kind: "in_process", userId });
}

/**
 * The person the persona cookie names, or null when nobody is signed in: no cookie, or one naming no user.
 * With the demo tools on, that is Maya instead. Per-request cached; read only by the request context.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const id = (await cookies()).get(PERSONA_COOKIE)?.value;
  const named = id ? await viewerFor(id) : null;
  if (named) return named;
  if (!DEMO_MODE) return null;
  const fallback = await viewerFor(DEFAULT_PERSONA);
  if (!fallback)
    throw new Error("Database is not seeded. Run `npm run db:reset`.");
  return fallback;
});
