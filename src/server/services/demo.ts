// The demo tools, on only with DEMO_MODE (decision 0051): reset the data, move the clock, switch persona. They
// check no permission; the flag is the gate. The BFF checks it before it calls them (so it answers before it reads
// its input), and the local implementation checks it again for its commands, since the flag is its configuration
// too. A backend without demo support answers `demo_mode_off`.
//
// Moving the clock and switching persona run the backend's scheduled jobs (the access deadlines and the passed
// sunsets) at the backend's clock, as a scheduled run would, so the demo shows their effects at once.

import type { PersonaLandingFacts } from "@/domain/demo";
import type { PlatformRole, TeamRole } from "@/domain/types";
import type { ActionResult, ReadResult, RequestContext } from "./types";

/** The demo clock: how far it has been moved, and the backend's instant. */
export interface ClockFacts {
  /** Whole days the clock has been moved forward (0: real time). */
  offsetDays: number;
  /** ISO: the backend's clock now, the offset included. */
  asOf: string;
}

/** A persona the switcher offers. */
export interface PersonaFacts {
  id: string;
  name: string;
  initials: string;
  /** The avatar's hue, 0–360. */
  hue: number;
  platformRole: PlatformRole | null;
  /** Their active memberships that hold a role, by team name (then id), each with its roles (`sortRoles`). */
  teams: { teamId: string; teamName: string; roles: TeamRole[] }[];
}

/**
 * Where a persona lands after the switch, as the backend decides it for them (`personaLanding`): the space the
 * current URL's slug names when they may enter it (as `identity.space` would answer them), else null; and the slug
 * of their first space (`identity.shell`'s first), where they go instead, null with no space yet.
 */
export type PersonaLanding = PersonaLandingFacts;

export interface DemoService {
  /**
   * Drops and reseeds the data, at the real time with the clock back at offset 0. Refuses `demo_mode_off`, then
   * `reset_needs_local_file` for a database that isn't a local file.
   */
  reset(ctx: RequestContext): Promise<ActionResult>;

  /**
   * Moves the clock forward by `days` (1 to 3,650, `DEMO_ADVANCE_MAX_DAYS`) and runs the scheduled jobs at the
   * clock it moved to, so every deadline the move crossed takes effect, dated when it fell due. Answers the new
   * offset. Refuses `demo_mode_off`, then `invalid_input`.
   */
  advanceClock(
    ctx: RequestContext,
    input: { days: number },
  ): Promise<ActionResult<{ offsetDays: number }>>;

  /** What the Demo pill shows: the clock's offset and its instant. */
  clockReadout(ctx: RequestContext): Promise<ReadResult<ClockFacts>>;

  /** The personas the switcher offers, in its order (the seed's). Also read outside the demo, for the profile menu. */
  personas(
    ctx: RequestContext,
  ): Promise<ReadResult<{ personas: PersonaFacts[] }>>;

  /**
   * Signs in as the persona `userId` names (the demo's sign-in): runs the scheduled jobs first (a member past a
   * deadline lost access before signing in), then stamps their last sign-in at the backend's clock (their
   * inactivity clock restarts). Answers where they land for the space `slug` names (the current URL's first
   * segment, or null). Refuses `demo_mode_off`, then `invalid_input` for anyone who isn't a persona, and writes
   * nothing then.
   */
  switchPersona(
    ctx: RequestContext,
    input: { userId: string; slug: string | null },
  ): Promise<ActionResult<PersonaLanding>>;
}
