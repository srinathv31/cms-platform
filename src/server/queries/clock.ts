import "server-only";
import { formatStamp } from "@/domain/dates";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type { ClockFacts } from "@/server/services/demo";

// The Demo pill's clock readout: the demo service's clock (`demo.clockReadout`), worded here.

export interface ClockReadout {
  /** "Sun, Oct 4, 2026, 3:42 PM UTC" */
  label: string;
  offsetDays: number;
}

/** The readout, worded from the backend's clock. */
export function clockReadout({ asOf, offsetDays }: ClockFacts): ClockReadout {
  return { label: formatStamp(new Date(asOf)), offsetDays };
}

export async function getClockReadout(): Promise<ClockReadout> {
  const result = await services().demo.clockReadout(
    await requireRequestContext(),
  );
  if (!result.ok) throw new Error(`The demo clock refused: ${result.code}.`);
  return clockReadout(result);
}
