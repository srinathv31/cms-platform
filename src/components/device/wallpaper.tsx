"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

// The phone's wallpaper, drawn from the brand tokens (`--device-wall-*`), so a rebrand repaints it: a
// teal field, a warm coral bloom behind where notifications sit (it gives the glass something to frost),
// a cool glow at the top left and two soft ribbons. No photograph and no platform wallpaper. It is laid
// out on a 400 × 870 canvas and fills the screen's width, anchored to the top like the screen's content,
// so a short frame crops its bottom rather than squashing it.

const W = 400;
const H = 870;

export function Wallpaper({ className }: { className?: string }) {
  const id = useId();
  const ref = (name: string) => `${id}-${name}`;
  const url = (name: string) => `url(#${ref(name)})`;
  return (
    <svg
      aria-hidden
      data-slot="wallpaper"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMin slice"
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
    >
      <defs>
        <linearGradient id={ref("field")} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" style={{ stopColor: "var(--device-wall-top)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--device-wall-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--device-wall-low)" }} />
        </linearGradient>
        <radialGradient id={ref("bloom")}>
          <stop offset="0" style={{ stopColor: "var(--device-wall-bloom)", stopOpacity: 0.95 }} />
          <stop offset="0.45" style={{ stopColor: "var(--device-wall-bloom)", stopOpacity: 0.45 }} />
          <stop offset="1" style={{ stopColor: "var(--device-wall-bloom)", stopOpacity: 0 }} />
        </radialGradient>
        <radialGradient id={ref("glow")}>
          <stop offset="0" style={{ stopColor: "var(--device-wall-glow)", stopOpacity: 0.9 }} />
          <stop offset="1" style={{ stopColor: "var(--device-wall-glow)", stopOpacity: 0 }} />
        </radialGradient>
        <radialGradient id={ref("mint")}>
          <stop offset="0" style={{ stopColor: "var(--device-wall-mint)", stopOpacity: 0.7 }} />
          <stop offset="1" style={{ stopColor: "var(--device-wall-mint)", stopOpacity: 0 }} />
        </radialGradient>
        <radialGradient id={ref("shade")}>
          <stop offset="0" style={{ stopColor: "var(--device-wall-shade)", stopOpacity: 0.85 }} />
          <stop offset="1" style={{ stopColor: "var(--device-wall-shade)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={ref("ribbon")} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" style={{ stopColor: "var(--device-wall-glow)", stopOpacity: 0 }} />
          <stop offset="0.5" style={{ stopColor: "var(--device-wall-glow)", stopOpacity: 0.5 }} />
          <stop offset="1" style={{ stopColor: "var(--device-wall-bloom)", stopOpacity: 0.1 }} />
        </linearGradient>
        <linearGradient id={ref("ribbon-low")} x1="1" y1="0" x2="0" y2="0.5">
          <stop offset="0" style={{ stopColor: "var(--device-wall-mint)", stopOpacity: 0 }} />
          <stop offset="0.6" style={{ stopColor: "var(--device-wall-mint)", stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: "var(--device-wall-mint)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={url("field")} />
      <ellipse cx="40" cy="90" rx="260" ry="220" fill={url("mint")} />
      <ellipse cx="330" cy="330" rx="300" ry="260" fill={url("bloom")} />
      <ellipse cx="300" cy="220" rx="170" ry="150" fill={url("glow")} />
      <ellipse cx="90" cy="760" rx="340" ry="250" fill={url("shade")} />
      <path
        d="M-60 430C40 330 150 520 260 430S420 300 470 340L470 430C400 410 340 520 240 560S60 520-60 560Z"
        fill={url("ribbon")}
      />
      <path d="M470 610C360 560 260 720 140 690S-30 640-80 700L-80 780C20 740 120 800 240 790S400 690 470 700Z" fill={url("ribbon-low")} />
    </svg>
  );
}
