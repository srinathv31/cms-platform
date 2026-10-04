import "server-only";
import { now } from "@/server/clock";

/** The demo clock for server components. `now()` itself defers to request time. */
export async function demoNow(): Promise<Date> {
  return now();
}
