// Who is asking, and where they may go. The sign-in stand-in (the persona cookie today, Better Auth later,
// decision 0054) yields a credential; `viewer` answers whom it names, with their memberships and roles. `space`
// resolves a URL's `[team]` slug to the team's id once, at the edge (decision 0053): below it, every service,
// permission check and query takes the id, and nothing compares a slug with a team id. `shell` lists every space
// the viewer may switch to, for the sidebar. The domain decides both (src/domain/spaces.ts).

import type { ShellFacts, SpaceFacts } from "@/domain/spaces";
import type { Viewer } from "@/domain/types";
import type { Credential, ReadResult, RequestContext } from "./types";

export type { ShellFacts, SpaceActions, SpaceFacts } from "@/domain/spaces";

export interface IdentityService {
  /**
   * The person a credential names, as a `Viewer`: their memberships by team name (then id), each with its roles
   * by name. null when it names nobody (signed out).
   */
  viewer(credential: Credential): Promise<Viewer | null>;

  /**
   * The space a `[team]` slug names (`spaceNamed`). Refuses 404 `space_unavailable` for a slug no team has and
   * for a team (or All teams) the viewer may not enter: the two read the same (decision 0052). A refusal, not a
   * throw, so a route can answer it and a page can turn it into Not found.
   */
  space(
    ctx: RequestContext,
    input: { slug: string },
  ): Promise<ReadResult<{ space: SpaceFacts }>>;

  /**
   * The app's frame (`shellOf`): every space the viewer may switch to, All teams first for the platform roles,
   * then their teams by name (every team, for the platform roles), empty for someone with no team yet; and
   * whether they may ask for access.
   */
  shell(ctx: RequestContext): Promise<ReadResult<ShellFacts>>;
}
