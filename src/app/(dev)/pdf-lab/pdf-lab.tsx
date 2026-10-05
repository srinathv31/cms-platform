"use client";

import { FileUp, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PdfViewer } from "@/components/preview/pdf/pdf-viewer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Width = "600" | "800" | "fill";
const WIDTHS: { value: Width; label: string }[] = [
  { value: "600", label: "600" },
  { value: "800", label: "800" },
  { value: "fill", label: "Fill" },
];

interface Source {
  data: Uint8Array;
  fileName: string;
}

export function PdfLab() {
  const [source, setSource] = useState<Source | null>(null);
  const [width, setWidth] = useState<Width>("600");
  const [pages, setPages] = useState<number | null>(null);
  const [loads, setLoads] = useState(0);
  const [mounted, setMounted] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // ?src=<same-origin URL>: fetch it once on arrival.
  useEffect(() => {
    const src = new URLSearchParams(window.location.search).get("src");
    if (!src) return;
    const url = new URL(src, window.location.href);
    if (url.origin !== window.location.origin) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => response.arrayBuffer())
      .then((buffer) => setSource({ data: new Uint8Array(buffer), fileName: url.pathname.split("/").pop() || "document.pdf" }))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setSource({ data: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
  };

  return (
    <div className="flex h-dvh flex-col bg-app p-3">
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-4xl border border-hairline bg-canvas">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-hairline px-10 pt-8 pb-5">
          <div className="mr-auto flex flex-col gap-1">
            <span className="caps-label">Dev</span>
            <h1 className="display-lg text-text">PDF lab</h1>
          </div>

          <ToggleGroup
            aria-label="Container width"
            variant="outline"
            size="sm"
            spacing={0}
            value={[width]}
            onValueChange={(value) => {
              const next = value[0] as Width | undefined;
              if (next) setWidth(next);
            }}
            className="bg-surface"
          >
            {WIDTHS.map((w) => (
              <ToggleGroupItem
                key={w.value}
                value={w.value}
                className="px-3 font-normal text-text-muted aria-pressed:bg-selected aria-pressed:text-text"
              >
                {w.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <label className="flex items-center gap-2.5 text-sm text-text-muted">
            <Switch checked={mounted} onCheckedChange={setMounted} aria-label="Viewer mounted" />
            Mounted
          </label>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 bg-surface font-normal"
            disabled={!source}
            onClick={() => source && setSource({ ...source, data: source.data.slice() })}
          >
            <RotateCw className="size-4" strokeWidth={1.75} aria-hidden />
            Same bytes, new array
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 bg-surface font-normal"
            onClick={() => inputRef.current?.click()}
          >
            <FileUp className="size-4" strokeWidth={1.75} aria-hidden />
            Open PDF
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            aria-label="PDF file"
            className="sr-only"
            data-testid="pdf-file"
            onChange={(event) => {
              void onFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </header>

        <div className="flex items-center gap-4 border-b border-hairline px-10 py-2.5 font-mono text-xs text-text-muted">
          <span data-testid="lab-file">{source?.fileName ?? "No file"}</span>
          <span data-testid="lab-bytes">{source ? `${source.data.byteLength.toLocaleString()} bytes` : ""}</span>
          <span data-testid="lab-pages">{pages === null ? "" : `${pages} pages`}</span>
          <span data-testid="lab-loads">{loads ? `onLoad × ${loads}` : ""}</span>
        </div>

        {/* The scroll root, like the app's canvas: an element, not the window. */}
        <div data-testid="lab-scroll" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto py-8" style={{ width: width === "fill" ? "100%" : `${width}px` }}>
            {mounted ? (
              <PdfViewer
                data={source?.data ?? null}
                fileName={source?.fileName ?? "document.pdf"}
                onLoad={({ numPages }) => {
                  setPages(numPages);
                  setLoads((n) => n + 1);
                }}
                className="rounded-2xl"
              />
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
