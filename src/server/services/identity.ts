// Who is asking, and where they may go. The sign-in stand-in (the persona cookie today, Better Auth later,
// decision 0054) yields a credential; `viewer` answers whom it names, with their memberships and roles. `space`
// resolves a URL's `[team]` slug to the team's id once, at the edge (decision 0053): below it, every service
// takes the id.
//
// Typed for step 2b: the request context still loads the viewer through src/server/viewer.ts, and spaces
// resolve in src/server/queries/spaces.ts.

import type { Viewer } from "@/domain/types";
import type {
  Credential,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";

/** A space as a URL names it: one team, or "All teams" (`teamId` null) for the platform roles. */
export interface SpaceFacts {
  /** null in the All teams space. */
  teamId: string | null;
  slug: string;
  name: string;
}

export interface IdentityService {
  /** The person a credential names, as a `Viewer`; null when it names nobody (signed out). */
  viewer(credential: Credential): Promise<Viewer | null>;

  /**
   * The space a `[team]` slug names, if the viewer may see it: 404 `space_unavailable` otherwise. A refusal, not
   * a throw, so a route can answer it and a page can turn it into Not found.
   */
  space(
    ctx: RequestContext,
    input: { slug: string },
  ): Promise<ReadResult<{ space: SpaceFacts }>>;

  /** The sidebar: every space the viewer may switch to, with its card. */
  shell(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"2b-0: the sidebar's facts">>>;
}
