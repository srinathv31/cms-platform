import { cn } from "@/lib/utils";
import { pt } from "./geometry";

// The phone's system chrome: the status bar along the top and the home indicator along the bottom.
// Generic glyphs drawn here (no SF Symbols, no Material assets), decoration only, hidden from assistive
// tech. `ink` picks the colour for what is behind: the wallpaper, or an app's own background.

/** What the chrome sits on: the wallpaper (white ink) or an app's background (the label colour). */
export type ChromeInk = "wall" | "app";

const INK: Record<ChromeInk, string> = {
  wall: "text-(--device-wall-ink)",
  app: "text-(--device-label)",
};

/**
 * The status bar: the time on the left (none on a lock screen, which has its own clock), signal, Wi-Fi and
 * battery on the right, either side of the camera cutout (`cutout` points wide, centred).
 */
export function StatusBar({
  time,
  ink,
  cutout,
  height = 54,
  className,
}: {
  time: string | null;
  ink: ChromeInk;
  cutout: number;
  height?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      data-slot="status-bar"
      style={{ height: pt(height) }}
      className={cn("pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center", INK[ink], className)}
    >
      <div className="flex flex-1 justify-center" style={{ paddingTop: pt(3), paddingLeft: pt(10) }}>
        {time ? (
          <span
            className="font-semibold tabular-nums"
            style={{ fontSize: pt(17), lineHeight: pt(22), letterSpacing: pt(-0.43) }}
          >
            {time}
          </span>
        ) : null}
      </div>
      <div className="shrink-0" style={{ width: pt(cutout) }} />
      <div className="flex flex-1 items-center justify-center" style={{ gap: pt(6), paddingTop: pt(3), paddingRight: pt(8) }}>
        <Signal />
        <Wifi />
        <Battery />
      </div>
    </div>
  );
}

/** Four bars, rising. */
function Signal() {
  return (
    <svg viewBox="0 0 18 12" style={{ width: pt(18), height: pt(12) }} fill="currentColor">
      <rect x="0" y="7.5" width="3.2" height="4.5" rx="1" />
      <rect x="4.9" y="5" width="3.2" height="7" rx="1" />
      <rect x="9.8" y="2.5" width="3.2" height="9.5" rx="1" />
      <rect x="14.7" y="0" width="3.2" height="12" rx="1" />
    </svg>
  );
}

/** A fan of three arcs over a point. */
function Wifi() {
  return (
    <svg viewBox="0 0 16 12" style={{ width: pt(16), height: pt(12) }}>
      <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        <path d="M.85 4.95A10.1 10.1 0 0 1 15.15 4.95" />
        <path d="M3.4 7.6A6.5 6.5 0 0 1 12.6 7.6" />
      </g>
      <path d="M8 12.2 5.6 9.8a3.4 3.4 0 0 1 4.8 0Z" fill="currentColor" />
    </svg>
  );
}

/** A battery, mostly full. */
function Battery() {
  return (
    <svg viewBox="0 0 27 13" style={{ width: pt(27), height: pt(13) }} fill="currentColor">
      <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" strokeOpacity="0.4" />
      <rect x="2" y="2" width="17" height="9" rx="2.4" />
      <path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" fillOpacity="0.45" />
    </svg>
  );
}

/** The bar along the bottom edge. */
export function HomeIndicator({ ink }: { ink: ChromeInk }) {
  return (
    <span
      aria-hidden
      style={{ width: pt(139), height: pt(5), bottom: pt(8) }}
      className={cn("pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-full bg-current", INK[ink])}
    />
  );
}
