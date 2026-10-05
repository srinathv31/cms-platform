"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { m } from "motion/react";
import { duration, ease } from "@/components/motion/presets";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ImportOriginalRef, ImportOriginalView } from "@/domain/import-types";
import { DocxSource } from "./docx-source";
import { OriginalFailed } from "./original-failed";
import { PdfSource } from "./pdf-source";
import { TxtSource } from "./txt-source";

/** Each original's view as fetched in this tab: it never changes, so coming back to the tab is instant. */
const viewCache = new Map<string, ImportOriginalView>();

type Loaded = { status: "loading" } | { status: "ready"; view: ImportOriginalView } | { status: "failed" };

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "860 bytes", "24 KB", "1.2 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/**
 * The widened rail's Original view (Compare with original, docs/decisions/track-c.md): the file the
 * template was imported from, beside the draft. A 32px row names it (file name, size, who, when),
 * the import report sits under it (what came across, what was left out), and the source fills a
 * well that scrolls on its own: a .docx as a document, a .pdf as its pages, a .txt as written.
 *
 * The file name row comes from the workspace's ref, so it is there at once; the rest is fetched from
 * `/api/imports/{uploadId}/view` the first time the view is shown. While it loads, one placeholder
 * stands where the report and the source go, and is swapped out whole, so nothing that was on screen
 * moves when they arrive.
 */
export function OriginalView({ original }: { original: ImportOriginalRef }) {
  const { uploadId } = original;
  const [loaded, setLoaded] = useState<Loaded>(() => {
    const cached = viewCache.get(uploadId);
    return cached ? { status: "ready", view: cached } : { status: "loading" };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (viewCache.has(uploadId)) return;
    let live = true;
    fetch(`/api/imports/${encodeURIComponent(uploadId)}/view`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const view = (await response.json()) as ImportOriginalView;
        viewCache.set(uploadId, view);
        if (live) setLoaded({ status: "ready", view });
      })
      .catch(() => {
        if (live) setLoaded({ status: "failed" });
      });
    return () => {
      live = false;
    };
  }, [uploadId, attempt]);

  const retry = () => {
    setLoaded({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  return (
    // The view fades in when the rail switches to it, as the Preview view does.
    <m.div
      data-slot="original"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: duration.fast, ease: ease.outSoft }}
      className="mt-3 flex min-h-0 flex-1 flex-col"
    >
      <div data-slot="original-file" className="flex h-8 shrink-0 items-center gap-2 text-[13px] text-text-muted">
        <FileText aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-text-subtle" />
        <span className="min-w-0 truncate text-[14px] font-medium text-text">{original.filename}</span>
        <span className="shrink-0">
          {formatFileSize(original.size)} · {original.uploadedByName} · {shortDate.format(new Date(original.uploadedAt))}
        </span>
      </div>
      {loaded.status === "ready" ? (
        <Source key="ready" view={loaded.view} />
      ) : loaded.status === "failed" ? (
        <Well key="failed">
          <OriginalFailed onRetry={retry} />
        </Well>
      ) : (
        <Placeholder key="loading" />
      )}
    </m.div>
  );
}

/** The report, then the source in the well. */
function Source({ view }: { view: ImportOriginalView }) {
  const { detected, dropped } = view.lines;
  // Older cached views have no third group.
  const kept = view.lines.kept ?? [];
  const { source } = view;
  return (
    <>
      {detected.length > 0 || dropped.length > 0 || kept.length > 0 ? (
        <section aria-label="Import report" className="mt-3 grid shrink-0 grid-cols-2 gap-x-8 gap-y-3 text-[13px] leading-5 text-text-muted">
          <ReportList title="Detected" lines={detected} />
          <ReportList title="Dropped" lines={dropped} />
          <ReportList title="Kept as text" lines={kept} wide />
        </section>
      ) : null}
      <Well>
        {source.kind === "docx" ? (
          <DocxSource html={source.html} />
        ) : source.kind === "txt" ? (
          <TxtSource text={source.text} />
        ) : (
          <PdfSource fileUrl={source.fileUrl} fileName={view.ref.filename} />
        )}
      </Well>
    </>
  );
}

/** One group of the report. `wide` runs under both columns (the kept lines are long). An empty group takes no room. */
function ReportList({ title, lines, wide = false }: { title: string; lines: string[]; wide?: boolean }) {
  if (lines.length === 0) return wide ? null : <div />;
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <h3 className="caps-label mb-1">{title}</h3>
      <ul aria-label={title} className="[overflow-wrap:anywhere]">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The tinted well the preview's output sits in (preview-pane.tsx), scrolling on its own. It takes Tab
 * (`tabIndex`), so the keyboard can scroll it. The sources inside bring the 40px that lets the file
 * scroll clear of the Demo pill.
 */
function Well({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label="Original file"
      data-slot="original-well"
      tabIndex={0}
      className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-hairline bg-surface-tinted outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </div>
  );
}

/** Two report lines and a sheet, in one box that is replaced whole when the view arrives. */
function Placeholder() {
  return (
    <div aria-busy aria-label="Loading the original" className="mt-3 flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 py-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-xl border border-hairline bg-surface-tinted p-4">
        <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface px-8 py-8">
          <Skeleton className="mb-2 h-5 w-1/2" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="mt-4 h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </div>
    </div>
  );
}
