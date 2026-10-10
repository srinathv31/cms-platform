"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

// Content laid out at a fixed size in CSS px, then scaled down evenly with a CSS transform to fit its box. A
// transform doesn't lay the content out again, so text wraps and truncates exactly as it does at 1:1, and
// it stays vector-crisp (no will-change: the browser rasterises it at the final scale). Two shapes:
//
// - ScaledViewport fills its box: the content is a fixed width and, once scaled, exactly as tall as the
//   box (Web's Desktop page, an 800px window scaled to the pane).
// - ScaledBox keeps the content's own size and proportions, and reserves its scaled size in the layout
//   (the phone kit: a phone at its real size, scaled to fit the preview's well).
//
// Both measure their box with a ResizeObserver before paint. The content is drawn from the first render,
// hidden until the box is measured, so anything that reads its layout (the phone kit's truncation) can.

/** A box's inner size, in CSS px. */
export interface BoxSize {
  width: number;
  height: number;
}

/** The element's client size, kept up to date as it resizes. Null until the first measure, which runs before paint. */
export function useBoxSize(ref: RefObject<HTMLElement | null>): BoxSize | null {
  const [box, setBox] = useState<BoxSize | null>(null);
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
  }, [ref]);
  return box;
}

/**
 * The scale that fits `size` inside `box`, never above 1. Width always fits. Height fits down to
 * `minScale`: in a box shorter than that, the content keeps `minScale` and runs past the box's bottom, so a
 * scroller around it scrolls instead of the content becoming unreadably small.
 */
export function containScale(box: BoxSize, size: BoxSize, minScale = 0): number {
  return Math.max(0, Math.min(1, box.width / size.width, Math.max(minScale, box.height / size.height)));
}

/** Hidden, and taking no room, until the box has been measured. */
const UNMEASURED: CSSProperties = { visibility: "hidden", overflow: "hidden" };

/**
 * Lays its children out at `width` CSS pixels and scales them down (never up) to fit the box's own
 * width. The inner box is `height / scale` tall, so once scaled it fills the box exactly. Scrolling still
 * works inside (a wheel over a scaled frame scrolls the frame's document).
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
  const box = useBoxSize(ref);
  const scale = box && box.width > 0 ? Math.min(1, box.width / width) : 1;
  return (
    <div
      ref={ref}
      data-slot="scaled-viewport"
      data-scale={box ? scale.toFixed(3) : undefined}
      style={box ? undefined : UNMEASURED}
      className={cn("relative overflow-hidden", className)}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width, height: box ? box.height / scale : "100%", transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Lays its children out at `width` × `height` CSS pixels and scales them to fit the box: by
 * `containScale` unless `scale` says otherwise. The scaled size is reserved in the layout, centred across
 * the box and at its top, so nothing overlaps it and no gap is left under it. `room` adds that many px of
 * empty space under the content, inside what is reserved: when the content runs past the box's bottom, it
 * is the space a scroller keeps below it at the end.
 */
export function ScaledBox({
  width,
  height,
  scale: scaleFor,
  room = 0,
  className,
  children,
}: {
  width: number;
  height: number;
  /** The scale for a measured box. Default: `containScale`, never below 0. */
  scale?: (box: BoxSize) => number;
  room?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useBoxSize(ref);
  const scale = box ? (scaleFor ? scaleFor(box) : containScale(box, { width, height })) : 1;
  return (
    <div ref={ref} data-slot="scaled-box" className={cn("min-w-0", className)}>
      <div
        data-slot="scaled-reserve"
        data-scale={box ? scale.toFixed(3) : undefined}
        className="relative mx-auto"
        style={box ? { width: width * scale, height: height * scale + room } : { ...UNMEASURED, width: 0, height: 0 }}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
