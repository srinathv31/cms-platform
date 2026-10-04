import { Stream } from "@/components/primitives/stream";
import { ClockReadout, ClockReadoutSkeleton } from "./clock-readout";
import { DemoPill } from "./demo-pill";

/** The pill is static; only the clock readout inside the drawer streams. */
export function DemoPillHole() {
  return (
    <DemoPill
      clock={
        <Stream fallback={<ClockReadoutSkeleton />}>
          <ClockReadout />
        </Stream>
      }
    />
  );
}
