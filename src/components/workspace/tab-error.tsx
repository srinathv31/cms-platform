"use client";

import Link from "next/link";
import { ErrorDigest, RetryButton, useLibraryHref, type RouteErrorProps } from "@/components/app-shell/route-error";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WS } from "./workspace-grid";

export const TAB_FAILED = "This tab didn't load.";

/**
 * A workspace tab that threw (src/app/(product)/[team]/templates/[templateId]/error.tsx). It takes the
 * document's cell of the workspace grid; the header and the tab bar above it belong to the layout and stay.
 * Try again is outline: the tab bar keeps the workspace's one black button (Edit or Submit for review).
 */
export function TabError({ error, retry }: RouteErrorProps) {
  const library = useLibraryHref();
  return (
    <div data-slot="tab-error" className={cn(WS.doc, "flex flex-col items-start gap-4")}>
      <p role="alert" className="text-[15px] leading-6 text-text">
        {TAB_FAILED}
      </p>
      <div className="flex items-center gap-2">
        <RetryButton retry={retry} variant="outline" size="lg" className="bg-surface px-3.5" />
        <Button variant="ghost" size="lg" className="px-3.5" nativeButton={false} render={<Link href={library} />}>
          Back to library
        </Button>
      </div>
      <ErrorDigest digest={error.digest} />
    </div>
  );
}
