"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { m, useMotionValue, useReducedMotion } from "motion/react";
import { Share } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The SHARE ring — the one signature element (design-reference.md, "The signature").
 *
 * An SVG <textPath> on a circle. `textLength` is set to the circumference so the
 * glyphs close the full 360° with an even rhythm and no seam. The artwork is drawn
 * in a 100-unit viewBox, so every size (64 / 76 / 88 / …) is the same drawing,
 * scaled: type, tracking and glyph all keep their proportions.
 *
 * Motion (hover or keyboard focus only, never under reduced motion):
 *   - the text ring turns once every 14s, easing in and out of the turn,
 *   - the badge scales to 1.04,
 *   - the glyph lifts 1px.
 */

const VIEW = 100;
/** Letters stand on this circle (outer edge of the caps ≈ BASELINE + cap height). */
const BASELINE_R = 36.5;
/** Type size in viewBox units (≈ 10.3px at 76px). */
const FONT_SIZE = 13.5;
/** Seconds per full turn while active. */
const SECONDS_PER_TURN = 14;
/** How quickly the turn eases in / out (seconds, exponential time constant). */
const EASE_TAU = 0.45;
/** Center glyph as a share of the badge. */
const GLYPH_RATIO = 0.3;

const CIRCUMFERENCE = 2 * Math.PI * BASELINE_R;
/** Circle that starts at 12 o'clock and runs clockwise, so letters read upright along the top. */
const RING_PATH = [
  `M ${VIEW / 2} ${VIEW / 2 - BASELINE_R}`,
  `A ${BASELINE_R} ${BASELINE_R} 0 1 1 ${VIEW / 2} ${VIEW / 2 + BASELINE_R}`,
  `A ${BASELINE_R} ${BASELINE_R} 0 1 1 ${VIEW / 2} ${VIEW / 2 - BASELINE_R}`,
].join(" ");

const NBSP = "\u00A0";

/**
 * Browsers spread the extra tracking between glyphs but not after the last one, so with
 * textLength = circumference the last gap (dot to first letter) comes out one tracking step
 * short. Shortening textLength by that step closes the ring with the same gap everywhere.
 * The step is (circumference / glyph count) minus the average semibold-caps advance in
 * viewBox units: 7.34 at FONT_SIZE with 0.04em tracking, measured in the browser for Figtree
 * ("SHARE · " × 3 = 176.08 units over 24 glyphs). Re-measure if the UI font changes.
 */
const AVG_ADVANCE = 7.34;
/** Glyph advances are rounded to 1/64px per character, which makes the ring run ~0.4 units long. */
const SEAM_BIAS = 0.45;

export interface ShareRingProps
  extends Omit<React.ComponentPropsWithoutRef<"button">, "children" | "type"> {
  /** The word repeated around the ring. Default "SHARE". */
  text?: string;
  /** How many times the word repeats. Default 3. */
  repeat?: number;
  /** Center glyph. Default: lucide `Share`, outline. Sized by the ring; pass a bare icon. */
  icon?: React.ReactNode;
  /** Outer diameter in px. Default 76. */
  size?: number;
  /** Accessible name. Default "Share — integration details". */
  label?: string;
  /** Shared-layout id so the go-live reprise can morph into the header position. */
  layoutId?: string;
}

export function ShareRing({
  text = "SHARE",
  repeat = 3,
  icon,
  size = 76,
  label = "Share — integration details",
  layoutId,
  className,
  style,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: ShareRingProps) {
  const pathId = useId();
  const reduceMotion = useReducedMotion();

  const ringText =
    Array.from({ length: repeat }, () => `${text.toUpperCase().replaceAll(" ", NBSP)}${NBSP}·${NBSP}`).join("") ||
    "";

  const glyphCount = ringText.length;
  const seamStep = Math.max(0, CIRCUMFERENCE / glyphCount - AVG_ADVANCE + SEAM_BIAS);
  const textLength = CIRCUMFERENCE - seamStep;

  // Rest angle puts the middle of the first word at 12 o'clock, so the ring reads
  // symmetric at rest. The text is `repeat` equal slots; in each, the word takes the
  // first part and " · " the rest (about 1.8 glyph widths), so the word's center sits at
  // L / (L + 1.8) / 2 of the slot.
  const wordLength = text.length;
  const restAngle = -(360 / repeat) * (0.5 * wordLength) / (wordLength + 1.8);
  const rotate = useMotionValue(restAngle);

  // ── Hover / focus-driven rotation (eased in and out, no React re-renders) ──
  const spin = useRef({ raf: 0, last: 0, speed: 0, target: 0, hover: false, focus: false });

  const run = useCallback(() => {
    const s = spin.current;
    if (s.raf) return;
    s.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - s.last) / 1000, 0.05);
      s.last = now;
      s.speed += (s.target - s.speed) * (1 - Math.exp(-dt / EASE_TAU));
      rotate.set(rotate.get() + s.speed * dt);
      if (s.target === 0 && s.speed < 0.25) {
        s.speed = 0;
        s.raf = 0;
        return;
      }
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
  }, [rotate]);

  const sync = useCallback(() => {
    const s = spin.current;
    const active = (s.hover || s.focus) && !reduceMotion;
    s.target = active ? 360 / SECONDS_PER_TURN : 0;
    if (active) run();
  }, [reduceMotion, run]);

  useEffect(() => {
    const s = spin.current;
    return () => {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, []);

  useEffect(() => {
    // Reduced-motion preference can flip while hovered.
    sync();
  }, [sync]);

  const glyphSize = Math.round(size * GLYPH_RATIO);

  return (
    <button
      type="button"
      aria-label={label}
      data-slot="share-ring"
      className={cn(
        "group/ring relative inline-block shrink-0 rounded-full align-middle outline-offset-4",
        className,
      )}
      style={{ width: size, height: size, ...style }}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (e.pointerType === "touch") return;
        spin.current.hover = true;
        sync();
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        spin.current.hover = false;
        sync();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        spin.current.focus = e.currentTarget.matches(":focus-visible");
        sync();
      }}
      onBlur={(e) => {
        onBlur?.(e);
        spin.current.focus = false;
        sync();
      }}
      {...props}
    >
      <m.span
        layoutId={layoutId}
        className={cn(
          "absolute inset-0 grid place-items-center rounded-full bg-surface-sunken text-text",
          "transition-transform duration-(--dur-slow) ease-(--ease-out-soft)",
          "motion-safe:group-hover/ring:scale-[1.04] motion-safe:group-focus-visible/ring:scale-[1.04]",
        )}
      >
        <m.span aria-hidden className="absolute inset-0 will-change-transform" style={{ rotate }}>
          <svg
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            className="block size-full overflow-visible"
            focusable="false"
          >
            <defs>
              <path id={pathId} d={RING_PATH} />
            </defs>
            <text
              className="fill-current font-sans"
              style={{
                fontSize: FONT_SIZE,
                fontWeight: 600,
                letterSpacing: "0.04em",
                whiteSpace: "pre",
              }}
            >
              <textPath
                href={`#${pathId}`}
                textLength={textLength}
                lengthAdjust="spacing"
                startOffset={0}
              >
                {ringText}
              </textPath>
            </text>
          </svg>
        </m.span>
        <span
          aria-hidden
          className={cn(
            "relative grid place-items-center [&>svg]:size-full [&>svg]:[stroke-width:1.75]",
            "transition-transform duration-(--dur-slow) ease-(--ease-out-soft)",
            "motion-safe:group-hover/ring:-translate-y-px motion-safe:group-focus-visible/ring:-translate-y-px",
          )}
          style={{ width: glyphSize, height: glyphSize }}
        >
          {icon ?? <Share />}
        </span>
      </m.span>
    </button>
  );
}
