import "server-only";
import { cache } from "react";
import { REQUEST_REFUSALS, refuse, type Refused } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { newId } from "@/server/ids";
import { getViewer } from "@/server/viewer";
import { signInRequired } from "./sign-in";

// The request context: who is asking, and how to trace and authorize the request further. Every entry point a
// person reaches (a page, a server action, an on-demand GET route, autosave) reads it once and hands it to the
// service interfaces (src/server/services), which take it as their first argument and never read a cookie or
// the persona themselves. It is the only reader of `getViewer()` (src/server/viewer.ts, the sign-in stand-in).
//
// It carries no time. The backend dates its own writes by its own clock, and a read that decides anything by
// time answers the instant it decided at (`asOf`), which the BFF words its dates from (decision 0072).
//
// It fails closed. Without a signed-in viewer there is no context: `findRequestContext()` answers null and each
// entry point refuses in its own shape: an action with `signed_out`, a read route with 401, a page by sending
// the person to sign in (`signInRequired()`, ./sign-in.ts). It never stands in a default person.
//
// React's `cache` shares it across the server components of one render. A server action or a route handler
// reads it once at its top and passes it down: outside a render, `cache` doesn't memoize.

/**
 * How the backend is told who is calling. The local implementation runs in this process and trusts the
 * viewer it is handed (`in_process`, with the user id the sign-in stand-in found). An HTTP implementation for
 * the Java API fills it with the user's token for the API's scope, or one from an on-behalf-of exchange: the
 * sign-in work decides which (decision 0070).
 */
export type Credential = { kind: "in_process"; userId: string };

/** One request, as the services see it. */
export interface RequestContext {
  /** Who is asking. Never a stand-in: no viewer, no context. */
  viewer: Viewer;
  /** Traces one request through the BFF and the backend's logs (`req_…`). */
  correlationId: string;
  /** What an HTTP implementation sends to authorize the call as the viewer. */
  credential: Credential;
}

/** The request's context, or null when nobody is signed in. Reads the persona cookie: request-time. */
export const findRequestContext = cache(
  async (): Promise<RequestContext | null> => {
    const viewer = await getViewer();
    if (!viewer) return null;
    return {
      viewer,
      correlationId: newId("req", 12),
      credential: { kind: "in_process", userId: viewer.userId },
    };
  },
);

/** For a page, a layout or a read model: the context, or off to sign in when nobody is signed in. */
export async function requireRequestContext(): Promise<RequestContext> {
  return (await findRequestContext()) ?? signInRequired();
}

/** For an action or a route: the context, or the `signed_out` refusal to answer with. */
export async function requestContextOrRefusal(): Promise<
  { ok: true; context: RequestContext } | Refused
> {
  const context = await findRequestContext();
  return context ? { ok: true, context } : refuse(REQUEST_REFUSALS.signedOut);
}
