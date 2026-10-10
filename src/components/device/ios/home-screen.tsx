"use client";

import type { CSSProperties } from "react";
import { Search } from "lucide-react";
import { pt } from "../geometry";
import { cutoutWidth } from "../phone-frame";
import { HomeIndicator, StatusBar } from "../status-bar";
import { glass } from "./glass";
import { fixedText } from "./type";

// An abstract iPhone home screen for the banner to land on: a widget and rows of blank glass tiles with
// label bars down the screen, then the search pill and the dock at the bottom. No real apps, no glyphs,
// nothing to read: decoration only.

const TILE = 62;
const TILE_CORNER = TILE * 0.2237;
/** Between rows: a tile and its label are 75pt, so a row every 100pt, as on a 402pt iPhone. */
const ROW_GAP = 25;

/** Tile tints in a fixed, irregular order, so the grid reads as different apps without being any. */
const TINTS = ["--device-tile", "--device-tile-warm", "--device-tile", "--device-tile-deep"] as const;
const PATTERN = [0, 1, 3, 0, 2, 3, 1, 0, 3, 0, 1, 2, 1, 3, 0, 2, 0, 2, 3, 1];

/** One row of four tiles. */
const ROW: CSSProperties = { gridTemplateColumns: `repeat(4, ${pt(TILE)})` };

function Tile({ tint, label = true }: { tint: (typeof TINTS)[number]; label?: boolean }) {
  return (
    <span className="flex flex-col items-center" style={{ gap: pt(7) }}>
      <span
        style={{
          width: pt(TILE),
          height: pt(TILE),
          borderRadius: pt(TILE_CORNER),
          background: `var(${tint})`,
          boxShadow: `inset 0 0 0 ${pt(0.5)} var(--device-glass-rim), inset 0 ${pt(1)} 0 0 var(--device-glass-specular)`,
        }}
      />
      {label ? <span className="rounded-full bg-(--device-tile-label)" style={{ width: pt(34), height: pt(6) }} /> : null}
    </span>
  );
}

/**
 * It appears at once, without the view's fade: its glass would lose its blur while a fading wrapper made
 * it a Backdrop Root (see glass.ts), and the banner's drop is the motion here.
 */
export function HomeScreen({ time }: { time: string }) {
  return (
    <div aria-hidden className="absolute inset-0 flex flex-col">
      <StatusBar time={time} ink="wall" cutout={cutoutWidth("ios")} />
      {/* Six rows from the top, as a full first page has them: the widget's two, then four of tiles. */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ paddingTop: pt(70), paddingInline: pt(27), rowGap: pt(ROW_GAP) }}
      >
        <div className="grid w-full shrink-0 justify-between" style={{ ...ROW, rowGap: pt(ROW_GAP) }}>
          {/* A 2 × 2 widget: a glass panel with a few bars where its content would be. */}
          <span
            className="col-span-2 row-span-2 flex flex-col justify-end"
            style={{ ...glass("quiet", { blur: 20 }), borderRadius: pt(22), padding: pt(14), gap: pt(7), marginBottom: pt(13) } as CSSProperties}
          >
            <span className="rounded-full bg-(--device-tile-label)" style={{ width: pt(44), height: pt(8) }} />
            <span className="rounded-full bg-(--device-tile-label)" style={{ width: pt(92), height: pt(14) }} />
            <span className="rounded-full bg-(--device-tile-label) opacity-70" style={{ width: pt(70), height: pt(8) }} />
          </span>
          {PATTERN.slice(0, 4).map((tint, i) => (
            <Tile key={i} tint={TINTS[tint]!} />
          ))}
        </div>
        {[4, 8, 12, 16].map((start) => (
          <div key={start} className="grid w-full shrink-0 justify-between" style={ROW}>
            {PATTERN.slice(start, start + 4).map((tint, i) => (
              <Tile key={i} tint={TINTS[tint]!} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 justify-center" style={{ paddingBlock: pt(12) }}>
        <span
          className="flex items-center font-semibold text-(--device-wall-ink)"
          style={{ ...glass("quiet", { blur: 20 }), ...fixedText(13, 18), height: pt(30), paddingInline: pt(12), gap: pt(4), borderRadius: pt(15) }}
        >
          <Search strokeWidth={2.25} style={{ width: pt(13), height: pt(13) }} />
          Search
        </span>
      </div>
      <div className="shrink-0" style={{ padding: `0 ${pt(10)} ${pt(10)}` }}>
        <div
          className="flex items-start justify-around"
          style={{ ...glass("quiet", { blur: 24 }), background: "var(--device-dock)", borderRadius: pt(36), padding: `${pt(14)} ${pt(8)}` }}
        >
          {[0, 3, 1, 0].map((tint, i) => (
            <Tile key={i} tint={TINTS[tint]!} label={false} />
          ))}
        </div>
      </div>
      <HomeIndicator ink="wall" />
    </div>
  );
}
