import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PreviewDevice } from "@/components/workspace/session/session-store";
import { BrowserChrome, MOBILE_FRAME_WIDTH } from "./web-output";
import { WELL_INSET } from "./well";

// What the Web and Email outputs show before their first render arrives: the output's own shape, in
// the same frames and places (the PDF has its own, in PdfViewer), so nothing moves when it lands.

/** A few lines of document: a heading, then paragraphs. */
function DocumentLines({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-3", className)}>
      <Skeleton className="mb-2 h-5 w-1/2 bg-surface-sunken" />
      <Skeleton className="h-2.5 w-full bg-surface-sunken" />
      <Skeleton className="h-2.5 w-full bg-surface-sunken" />
      <Skeleton className="h-2.5 w-4/5 bg-surface-sunken" />
      <Skeleton className="mt-5 mb-1 h-3.5 w-1/3 bg-surface-sunken" />
      <Skeleton className="h-2.5 w-full bg-surface-sunken" />
      <Skeleton className="h-2.5 w-11/12 bg-surface-sunken" />
      <Skeleton className="h-2.5 w-3/5 bg-surface-sunken" />
    </div>
  );
}

export function WebSkeleton({ device, host }: { device: PreviewDevice; host?: string }) {
  if (device === "mobile") {
    return (
      <div aria-hidden className={cn("h-full min-h-80", WELL_INSET)}>
        <div
          style={{ width: MOBILE_FRAME_WIDTH }}
          className="mx-auto h-full max-w-full rounded-[2rem] border border-hairline-strong bg-surface p-2"
        >
          <div className="h-full rounded-3xl bg-surface p-5">
            <DocumentLines />
          </div>
        </div>
      </div>
    );
  }
  // The browser window of the loaded page: its chrome, then a page whose column sits in the middle.
  return (
    <div aria-hidden className={cn("h-full min-h-80", WELL_INSET)}>
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-hairline bg-surface">
        <BrowserChrome host={host} />
        <div className="min-h-0 flex-1 p-8">
          <DocumentLines className="mx-auto max-w-[55%]" />
        </div>
      </div>
    </div>
  );
}

export function EmailSkeleton() {
  return (
    <div aria-hidden className={WELL_INSET}>
      <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
        <div className="border-b border-hairline px-5 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 shrink-0 rounded-full bg-surface-sunken" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-2/5 bg-surface-sunken" />
              <Skeleton className="h-2.5 w-1/4 bg-surface-sunken" />
            </div>
          </div>
          <Skeleton className="mt-4 h-5 w-3/4 bg-surface-sunken" />
          <Skeleton className="mt-2 h-2.5 w-1/2 bg-surface-sunken" />
        </div>
        <div className="bg-surface-tinted p-5">
          <div className="rounded-lg border border-hairline bg-surface p-7">
            <DocumentLines />
          </div>
        </div>
      </div>
    </div>
  );
}
