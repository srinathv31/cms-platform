"use client";

import { lazy, Suspense, useState } from "react";
import { GitCompareArrows, X } from "lucide-react";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";
import { ScrimDialogContent } from "@/components/app-shell/scrim-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { VersionState } from "@/domain/types";

// "Compare versions": a large dialog with the redline between any two versions of the template. The
// button is all the page loads up front; the panel (and the document renderer under it) is a separate
// chunk that arrives when the dialog opens.

export interface CompareOption {
  id: string;
  /** "v2", or "Draft" for the open draft. */
  label: string;
  state: VersionState;
}

const ComparePanel = lazy(() => import("./compare-panel"));

export function CompareVersions({ templateId, options }: { templateId: string; options: CompareOption[] }) {
  const [open, setOpen] = useState(false);
  // Newest first. With fewer than two versions there is nothing to compare, so there is no button.
  if (options.length < 2) return null;

  return (
    <>
      <Button variant="outline" className="gap-1.5 bg-surface" onClick={() => setOpen(true)}>
        <GitCompareArrows aria-hidden strokeWidth={1.75} />
        Compare versions
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <ScrimDialogContent className="flex h-[min(52rem,calc(100vh-2rem))] w-[min(68rem,calc(100vw-2rem))] flex-col rounded-3xl p-0">
          <div className="flex items-start justify-between gap-4 px-8 pt-8">
            <DialogTitle className="display-lg">Compare versions</DialogTitle>
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  className="-mt-1 -mr-3 size-9 rounded-full text-text-muted hover:bg-hover hover:text-text"
                />
              }
            >
              <X aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-5" />
            </DialogClose>
          </div>
          <DialogDescription className="sr-only">
            The changes from the earlier version to the later one: additions underlined in green, removals struck through in red.
          </DialogDescription>
          <Suspense fallback={<CompareSkeleton />}>
            <ComparePanel templateId={templateId} options={options} />
          </Suspense>
        </ScrimDialogContent>
      </Dialog>
    </>
  );
}

/** The panel's controls row and document, as grey blocks, while its code arrives. */
export function CompareSkeleton() {
  return (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[3.75rem] items-center gap-3 border-b border-hairline px-8">
        <Skeleton className="h-8 w-44 rounded-lg" />
        <Skeleton className="h-8 w-44 rounded-lg" />
      </div>
      <div className="flex flex-col gap-3 px-8 pt-8">
        <Skeleton className="mx-auto h-4 w-full max-w-[47.5rem]" />
        <Skeleton className="mx-auto h-4 w-4/5 max-w-[38rem]" />
        <Skeleton className="mx-auto mt-6 h-6 w-48" />
        <Skeleton className="mx-auto h-4 w-full max-w-[47.5rem]" />
      </div>
    </div>
  );
}
