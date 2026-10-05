"use client";

import { useEffect, useState } from "react";
import { PdfViewer } from "@/components/preview/pdf/pdf-viewer";
import { WELL_INSET } from "@/components/preview/well";
import { OriginalFailed } from "./original-failed";

/** The bytes of each original fetched in this tab: the file never changes, so a second look is instant. */
const bytesCache = new Map<string, Uint8Array>();

/**
 * A .pdf original: its real pages, drawn by the preview's PdfViewer from the file route. The viewer
 * shows its page-shaped skeleton until the bytes are here.
 */
export function PdfSource({ fileUrl, fileName }: { fileUrl: string; fileName: string }) {
  const [data, setData] = useState<Uint8Array | null>(() => bytesCache.get(fileUrl) ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (bytesCache.has(fileUrl)) return;
    let live = true;
    fetch(fileUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const bytes = new Uint8Array(await response.arrayBuffer());
        bytesCache.set(fileUrl, bytes);
        if (live) setData(bytes);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [fileUrl, attempt]);

  if (failed) {
    return (
      <OriginalFailed
        onRetry={() => {
          setFailed(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return <PdfViewer data={data} fileName={fileName} className="min-h-full bg-transparent" contentClassName={WELL_INSET} />;
}
