"use client";

// The PDF preview: the exact bytes from the render route, drawn by pdf.js (implementation plan §12,
// Q1). Canvas pages for the look, a text layer for selection and screen readers, pages virtualized,
// pdf.js and its worker loaded on the first preview only. The loading, swapping and rendering live in
// PdfController; this component renders the boxes and the states around them.

import { Download, FileText } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { downloadPdf } from "./download";
import { PdfController, type LoadedPdf } from "./pdf-controller";
import { PdfPage } from "./pdf-page";

export interface PdfViewerProps {
  /** The exact bytes from the render route. A new array re-renders in place, keeping the scroll position. null = nothing yet (show the page-shaped skeleton). */
  data: Uint8Array | null;
  /** Used by the fallback's Download button. */
  fileName: string;
  /** Called once the document has loaded. */
  onLoad?: (info: { numPages: number }) => void;
  className?: string;
  /** Classes for the column that holds the pages. Replaces its default padding (`p-6`) when given, so the host sets the paper's inset (see `WELL_INSET`). */
  contentClassName?: string;
}

type View = { kind: "waiting" } | { kind: "pages"; doc: LoadedPdf } | { kind: "failed" };

/** US Letter, the shape of the skeleton and the fallback before any page size is known. */
const LETTER_ASPECT = "612 / 792";

/** The padding round the pages when the host gives none. */
const DEFAULT_INSET = "p-6";

export function PdfViewer({ data, fileName, onLoad, className, contentClassName }: PdfViewerProps): JSX.Element {
  const [view, setView] = useState<View>({ kind: "waiting" });
  const [busy, setBusy] = useState(false);
  // No bytes: back to the skeleton (state adjusted during render, so there is no stale frame).
  if (data === null && view.kind !== "waiting") setView({ kind: "waiting" });
  const columnRef = useRef<HTMLDivElement>(null);

  const [controller] = useState(
    () =>
      new PdfController({
        ready: (doc) => setView({ kind: "pages", doc }),
        failed: () => setView({ kind: "failed" }),
        busy: setBusy,
      }),
  );
  useLayoutEffect(() => {
    controller.onShown(onLoad ? (doc) => onLoad({ numPages: doc.numPages }) : null);
  }, [controller, onLoad]);

  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    controller.attach(column);
    return () => controller.detach();
  }, [controller]);

  // New bytes load behind what is on screen; no bytes drop the document.
  useEffect(() => {
    if (data) controller.load(data);
    else controller.clear();
  }, [controller, data]);

  // The new document's slots are in the DOM: swap its drawn pages in before the browser paints.
  useLayoutEffect(() => {
    if (view.kind === "pages") controller.adopt(view.doc);
  }, [controller, view]);

  const register = useCallback((index: number, el: HTMLElement | null) => controller.register(index, el), [controller]);

  return (
    <div
      role="region"
      aria-label="PDF preview"
      aria-busy={busy || (view.kind === "waiting" && data !== null) || undefined}
      className={cn("bg-surface-sunken", className)}
    >
      <div ref={columnRef} className={cn("flex flex-col gap-5", contentClassName ?? DEFAULT_INSET)}>
        {view.kind === "pages" ? (
          view.doc.sizes.map((size, index) => (
            <PdfPage key={index} index={index} count={view.doc.numPages} size={size} register={register} />
          ))
        ) : view.kind === "failed" && data ? (
          <Fallback data={data} fileName={fileName} />
        ) : (
          <PageSkeleton />
        )}
      </div>
    </div>
  );
}

/** A blank sheet with a few lines, where the first page will be. */
function PageSkeleton() {
  return (
    <div
      aria-hidden
      className="flex w-full flex-col gap-3 bg-white px-[9%] pt-[11%] ring-1 ring-hairline"
      style={{ aspectRatio: LETTER_ASPECT }}
    >
      <Skeleton className="mb-3 h-5 w-1/2 rounded-xs bg-surface-sunken" />
      <Skeleton className="h-2.5 w-full rounded-xs bg-surface-sunken" />
      <Skeleton className="h-2.5 w-full rounded-xs bg-surface-sunken" />
      <Skeleton className="h-2.5 w-4/5 rounded-xs bg-surface-sunken" />
      <Skeleton className="mt-5 mb-1 h-3.5 w-1/3 rounded-xs bg-surface-sunken" />
      <Skeleton className="h-2.5 w-full rounded-xs bg-surface-sunken" />
      <Skeleton className="h-2.5 w-11/12 rounded-xs bg-surface-sunken" />
      <Skeleton className="h-2.5 w-3/5 rounded-xs bg-surface-sunken" />
    </div>
  );
}

/** When pdf.js can't show the file: the file itself, one click away. */
function Fallback({ data, fileName }: { data: Uint8Array; fileName: string }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-4 px-6" style={{ aspectRatio: LETTER_ASPECT }}>
      <FileText className="size-8 text-text-subtle" strokeWidth={1.5} aria-hidden />
      <p className="max-w-full truncate text-sm text-text-muted">
        <span className="sr-only">Preview unavailable. </span>
        {fileName}
      </p>
      <Button variant="outline" className="bg-surface" onClick={() => downloadPdf(data, fileName)}>
        <Download strokeWidth={1.75} aria-hidden />
        Download PDF
      </Button>
    </div>
  );
}
