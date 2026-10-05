"use client";

import { useSyncExternalStore } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { peekJustImported } from "@/components/workspace/just-imported";
import { WS } from "@/components/workspace/workspace-grid";

const noSubscribe = () => () => {};

/**
 * The Content skeleton's rail. Arriving from an import, the rail opens widened on the Original view
 * (rail.tsx), so its stand-in is already widened too: the header and the tab bar beside it are laid
 * out at their final width from the first paint and don't move when the page arrives. Any other time
 * it is `narrow`, the normal rail's skeleton. Below the rail's breakpoint it stays shut (no `data-open`): the rail doesn't open on arrival there. The cookie is only peeked at here; the rail takes it.
 */
export function ArrivalRailSkeleton({ narrow }: { narrow: React.ReactNode }) {
  // Server and hydration: the normal skeleton. A client navigation (how an import arrives) asks the
  // cookie. It is set just before that navigation and taken on arrival, so any waiting one is this page's.
  const arriving = useSyncExternalStore(noSubscribe, () => peekJustImported() !== null, () => false);
  if (!arriving) return narrow;
  return (
    <div aria-hidden data-slot="rail" data-preview="" data-view="original" className={WS.rail}>
      <div className={WS.railInner}>
        <div className="flex h-11 items-center gap-6 border-b border-hairline">
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-3.5 w-16" />
        </div>
        <div className="mt-3 flex h-8 items-center gap-2">
          <Skeleton className="h-3.5 w-48" />
        </div>
        <div className="mt-3 flex flex-col gap-2 py-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="mt-4 h-96 w-full rounded-xl" />
      </div>
    </div>
  );
}
