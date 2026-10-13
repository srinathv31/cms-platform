// The demo tools, on only with DEMO_MODE (decision 0051): reset the data, move the clock, switch persona.
// They check no permission; the flag is the gate, and the BFF checks it before it calls them. A backend
// without demo support answers `demo_mode_off`.
//
// Typed for step 2b: they still run in src/server/actions/demo.ts, src/server/actions/persona.ts and
// src/server/queries/personas.ts.

import type {
  ActionResult,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";

export interface DemoService {
  /** Drops and reseeds the data. Refuses `reset_needs_local_file` for a database that isn't a local file. */
  reset(ctx: RequestContext): Promise<ActionResult>;
  /** Moves the clock forward and runs the scheduled jobs the move crossed. */
  advanceClock(
    ctx: RequestContext,
    input: { days: number },
  ): Promise<ActionResult<{ offsetDays: number }>>;
  /** What the Demo pill shows: the clock's offset and its instant. */
  clockReadout(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P2: the demo clock's facts">>>;
  /** The personas the switcher offers. */
  personas(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P2: the personas' facts">>>;
  /** A persona was switched to: run the scheduled jobs, then stamp their last sign-in. */
  personaSwitched(
    ctx: RequestContext,
    input: { userId: string },
  ): Promise<ActionResult>;
}
