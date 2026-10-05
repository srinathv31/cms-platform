import "server-only";
import { getClockOffsetDays } from "@/server/clock";
import { demoNow } from "./dynamic";
import { stamp } from "./format";

export interface ClockReadout {
  /** "Sun, Oct 4, 2026, 3:42 PM UTC" */
  label: string;
  offsetDays: number;
}

export async function getClockReadout(): Promise<ClockReadout> {
  const date = await demoNow();
  const offsetDays = await getClockOffsetDays();
  return { label: stamp(date), offsetDays };
}
