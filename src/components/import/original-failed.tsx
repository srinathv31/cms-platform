"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The original couldn't be fetched: one sentence and Try again, in the well (like the preview's error). */
export function OriginalFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="grid min-h-full place-items-center px-8 py-12">
      <div className="flex max-w-80 flex-col items-center gap-4 text-center">
        <CircleAlert aria-hidden strokeWidth={1.5} className="size-7 text-text-subtle" />
        <p className="text-[14px] leading-6 text-text">Couldn&apos;t load the original.</p>
        <Button variant="outline" className="bg-surface" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
