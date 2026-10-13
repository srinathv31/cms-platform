// Who is asking, and where they may go. The sign-in stand-in (the persona cookie today, Better Auth later,
// decision 0054) turns a session into a user id; `viewer` loads that user with their memberships and roles.
// `space` resolves a URL's `[team]` slug to the team's id once, at the edge (decision 0053): below it, every
// service takes the id.
//
// Typed for step 2b: the request context still loads the viewer through src/server/viewer.ts, and spaces
// resolve in src/server/queries/spaces.ts.

import type { Viewer } from "@/domain/types";
import type { ShellData } from "@/server/queries/spaces";
import type { ReadResult, RequestContext } from "./types";

/** A space as a URL names it: one team, or "All teams" (`teamId` null) for the platform roles. */
export interface SpaceFacts {
  /** null in the All teams space. */
  teamId: string | null;
  slug: string;
  name: string;
}

export interface IdentityService {
  /** The user a session names, as a `Viewer`; null when there is no such user (signed out). */
  viewer(input: { userId: string }): Promise<Viewer | null>;

  /** The space a `[team]` slug names, if the viewer may see it: 404 `space_unavailable` otherwise. */
  space(
    ctx: RequestContext,
    input: { slug: string },
  ): Promise<ReadResult<{ space: SpaceFacts }>>;

  /** The sidebar: every space the viewer may switch to, with its card. */
  shell(ctx: RequestContext): Promise<ShellData>;
}
