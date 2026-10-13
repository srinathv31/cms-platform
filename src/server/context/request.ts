import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { REQUEST_REFUSALS, refuse, type Refused } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { now } from "@/server/clock";
import { newId } from "@/server/ids";
import { getViewer } from "@/server/viewer";

// The request context: who is asking, what time it is, and how to trace and authorize the request further.
// Every entry point a person reaches (a page, a server action, an on-demand GET route, autosave) reads it once
// and hands it to the service interfaces (src/server/services), which take it as their first argument and
// never read a cookie, the persona or the clock themselves. It is the only reader of `getViewer()` and
// `now()` for the code that has moved behind the services; the rest moves in step 2b of the seam.
//
// It fails closed. Without a signed-in viewer there is no context: `findRequestContext()` answers null and
// each entry point refuses in its own shape, an action with `signed_out`, a read route with 401, a page with
// Not found (decision 0052). It never stands in a default person. (Today's persona cookie still falls back
// to Maya inside `getViewer()`, handoff review S2; that fallback is the sign-in stand-in's, not the context's,
// and goes with real sign-in.)
//
// Read once per request: React's `cache` shares it across the server components of one render, so every
// read model in a page sees the same viewer and the same instant. A server action or a route handler reads it
// once at its top and passes it down.

/**
 * How the backend is told who is calling, beyond the viewer the BFF resolved. The local implementation runs
 * in this process and trusts the viewer it is handed (`in_process`). An HTTP implementation for the Java API
 * fills this slot with the user's token for the API's scope, or a token from an on-behalf-of exchange: the
 * sign-in work decides which (decision 0070).
 */
export type Credential = { kind: "in_process" };

/** One request, as the services see it. */
export interface RequestContext {
  /** Who is asking. Never a stand-in: no viewer, no context. */
  viewer: Viewer;
  /** The request's instant on the demo clock, read once. A transition is dated by it. */
  now: Date;
  /** Traces one request through the BFF and the backend's logs (`req_…`). */
  correlationId: string;
  /** What an HTTP implementation sends to authorize the call as the viewer. */
  credential: Credential;
}

/**
 * The request's context, or null when nobody is signed in. The viewer is read first (a cookie, so a
 * request-time read under Cache Components), then the clock. Cached per request.
 */
export const findRequestContext = cache(
  async (): Promise<RequestContext | null> => {
    // The sign-in stand-in (the persona cookie) always names someone today; real sign-in can answer nobody.
    const viewer: Viewer | null = await getViewer();
    if (!viewer) return null;
    return {
      viewer,
      now: await now(),
      correlationId: newId("req", 12),
      credential: { kind: "in_process" },
    };
  },
);

/** For a page or a read model: the context, or the Not found page when nobody is signed in. */
export async function requireRequestContext(): Promise<RequestContext> {
  const context = await findRequestContext();
  if (!context) notFound();
  return context;
}

/** For an action or a route: the context, or the `signed_out` refusal to answer with. */
export async function requestContextOrRefusal(): Promise<
  { ok: true; context: RequestContext } | Refused
> {
  const context = await findRequestContext();
  return context ? { ok: true, context } : refuse(REQUEST_REFUSALS.signedOut);
}
