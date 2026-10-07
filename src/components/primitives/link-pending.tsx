"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

// Dev never prefetches, so a click can wait seconds on a compile; these acknowledge it. As the useLinkStatus
// docs suggest, nothing changes for 100ms, so a prefetched link (production) never shows them. Then a slow
// ease-in fade (a short wait stays faint) to a steady state, and a gentle pulse. Reduced motion keeps the
// fade but not the pulse; its `!` beats the global rule that cuts every animation to 0.01ms.
const PENDING =
  "animate-[enter_450ms_ease-in_100ms_backwards,exit_900ms_ease-in-out_550ms_infinite_alternate] motion-reduce:animate-[enter_450ms_ease-in_100ms_backwards]!";

/** A dot in the link: fixed size and always rendered, so it never shifts the layout. 0 → 1, pulsing to 0.4. */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  const state = pending ? `${PENDING} fade-in fade-out-40` : "opacity-0";
  return <span aria-hidden data-slot="link-pending" className={cn("size-1.5 shrink-0 rounded-full bg-text-muted", state, className)} />;
}

/** The link's label text, dimmed instead: 1 → 0.55, pulsing to 0.35. Opacity only, so its box never moves. */
export function LinkPendingLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span data-slot="link-pending-label" className={cn(pending && `${PENDING} opacity-55 fade-out-35`)}>{children}</span>;
}
