"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Lays its children out at a fixed design width, then shrinks them to fit the space available
 * (never past 1:1). CSS `zoom` scales the layout box as well as the paint, so the height follows.
 * The factor is exposed as `data-scale` for measuring.
 */
export function FitWidth({
  width,
  max = 1,
  className,
  children,
}: {
  width: number;
  max?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.min(max, el.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, max]);

  return (
    <div ref={ref} className={cn("flex w-full justify-center", className)}>
      <div
        data-fit=""
        data-scale={scale?.toFixed(3)}
        style={{ width, zoom: scale ?? 1, visibility: scale === null ? "hidden" : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
