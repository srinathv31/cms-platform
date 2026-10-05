"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import type { PreviewDevice } from "@/components/workspace/session/session-store";
import { cn } from "@/lib/utils";
import { BufferedFrame } from "./buffered-frame";
import { WELL_INSET } from "./well";

/**
 * The viewport a Desktop web page is laid out in, whatever the pane's width. A narrow desktop window
 * rather than a wide one, so the page is scaled less and its text stays readable: the browser frame's
 * viewport is about 530px wide on a 1440px window (scale 0.66) and 430px on a 1280px one (0.54).
 * At 1024px it was 0.52 and 0.42.
 */
export const DESKTOP_WIDTH = 800;
/** The viewport of a phone, shown 1:1. */
export const MOBILE_WIDTH = 390;

/** The phone's bezel: 8px of padding and a 1px border on each side, around the 390px viewport. */
const MOBILE_BEZEL = 2 * (8 + 1);
/** The phone frame's whole width: the viewport plus its bezel, so the document inside is exactly 390px wide. */
export const MOBILE_FRAME_WIDTH = MOBILE_WIDTH + MOBILE_BEZEL;

/**
 * The Web channel's HTML, in a sandboxed frame, at the width of the device it stands for.
 *
 * Desktop is a real 800px viewport inside a browser window (a thin chrome strip with three dots and
 * the address), scaled down to the pane's width, so the page lays out as it would on a desktop screen
 * and the difference from Mobile reads at a glance. Mobile is a 390px column at 1:1 in a phone frame
 * (the frame is the viewport plus its bezel, so the document is exactly 390px). The document scrolls
 * inside the frame either way, so the well itself doesn't.
 */
export function WebOutput({ html, device, host }: { html: string; device: PreviewDevice; host?: string }) {
  if (device === "mobile") {
    return (
      <div className={cn("h-full min-h-80", WELL_INSET)}>
        <div
          data-device="mobile"
          style={{ width: MOBILE_FRAME_WIDTH }}
          className="mx-auto h-full max-w-full rounded-[2rem] border border-hairline-strong bg-surface p-2"
        >
          <BufferedFrame html={html} title="Web preview" className="h-full overflow-hidden rounded-3xl" />
        </div>
      </div>
    );
  }
  return (
    <div className={cn("h-full min-h-80", WELL_INSET)}>
      <div
        data-device="desktop"
        className="flex h-full flex-col overflow-hidden rounded-lg border border-hairline bg-surface"
      >
        <BrowserChrome host={host} />
        <ScaledViewport width={DESKTOP_WIDTH} className="min-h-0 flex-1">
          <BufferedFrame html={html} title="Web preview" className="h-full" />
        </ScaledViewport>
      </div>
    </div>
  );
}

/**
 * The strip along the top of a browser window: three muted dots and an address pill. Decoration (the
 * preview has no real address), so it is hidden from assistive tech.
 */
export function BrowserChrome({ host, className }: { host?: string; className?: string }) {
  return (
    <div
      aria-hidden
      data-slot="browser-chrome"
      className={cn("flex h-8 shrink-0 items-center gap-3 border-b border-hairline bg-surface-tinted px-3", className)}
    >
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="size-2 rounded-full bg-hairline-strong" />
        <span className="size-2 rounded-full bg-hairline-strong" />
        <span className="size-2 rounded-full bg-hairline-strong" />
      </div>
      <div className="mx-auto flex h-5 w-full max-w-56 min-w-0 items-center justify-center gap-1 rounded-md bg-surface px-2 text-[11px] leading-none text-text-subtle">
        <Lock strokeWidth={1.75} className="size-2.5 shrink-0" />
        <span className="truncate">{host}</span>
      </div>
      {/* The same width as the dots, so the pill sits in the middle. */}
      <div className="w-9 shrink-0" />
    </div>
  );
}

/**
 * Lays its children out at `width` CSS pixels and scales them down (never up) to fit the box's own
 * width, with a CSS transform: the text stays vector-crisp and scrolling still works inside (a wheel
 * over the scaled frame scrolls the frame's document). The inner box is `height / scale` tall, so
 * once scaled it fills the box exactly. Until the box has been measured (before first paint) nothing
 * is drawn.
 */
export function ScaledViewport({
  width,
  className,
  children,
}: {
  width: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setBox((now) => (now && now.width === next.width && now.height === next.height ? now : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = box && box.width > 0 ? Math.min(1, box.width / width) : 1;
  return (
    <div ref={ref} data-slot="scaled-viewport" data-scale={box ? scale.toFixed(3) : undefined} className={cn("relative overflow-hidden", className)}>
      {box ? (
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width, height: box.height / scale, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
