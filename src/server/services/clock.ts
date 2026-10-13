// The backend's clock. Every instant a transition is dated by comes from it, through the request context
// (`now`, read once per request). Locally it is the demo clock: the real time plus `settings.clock_offset_days`.
// The Java API keeps its own, with a test-only offset in demo and test environments (decision 0068).
//
// Typed for step 2b: the request context still reads src/server/clock.ts.

export interface ClockService {
  /** The current instant on the backend's clock. */
  now(): Promise<Date>;
}
