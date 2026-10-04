import { Skeleton } from "@/components/ui/skeleton";
import { getClockReadout } from "@/server/queries/clock";

/** Current demo date/time and how far it has been advanced. Streams (reads the clock from the DB). */
export async function ClockReadout() {
  const { label, offsetDays } = await getClockReadout();
  return (
    <div>
      <div className="text-[15px] leading-6 font-medium">{label}</div>
      <div className="text-sm leading-5 text-text-muted">
        {offsetDays === 0 ? "Real time" : `+${offsetDays} ${offsetDays === 1 ? "day" : "days"} from today`}
      </div>
    </div>
  );
}

export function ClockReadoutSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="my-1 h-4 w-48" />
      <Skeleton className="my-[3px] h-3.5 w-28" />
    </div>
  );
}
