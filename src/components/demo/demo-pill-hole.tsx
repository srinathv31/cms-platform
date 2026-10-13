import { connection } from "next/server";
import { Stream } from "@/components/primitives/stream";
import { DEMO_MODE } from "@/server/config";
import { ClockReadout, ClockReadoutSkeleton } from "./clock-readout";
import { DemoPill } from "./demo-pill";

/**
 * The demo tools: the pill and its drawer, only when the server runs in demo mode (decision 0051). The pill
 * is fixed to the corner, so nothing shifts when it streams in, and its fallback is empty.
 */
export function DemoPillHole() {
  return (
    <Stream fallback={null}>
      <DemoTools />
    </Stream>
  );
}

export async function DemoTools() {
  // Request time: `DEMO_MODE` is read when the server starts, and a prerender would bake the build's value
  // into the static shell.
  await connection();
  if (!DEMO_MODE) return null;
  return (
    <DemoPill
      clock={
        // Only the clock readout inside the drawer streams further.
        <Stream fallback={<ClockReadoutSkeleton />}>
          <ClockReadout />
        </Stream>
      }
    />
  );
}
