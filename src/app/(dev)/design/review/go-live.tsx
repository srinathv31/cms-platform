"use client";

import { useEffectEvent, useEffect, useRef, useState, type RefObject } from "react";
import { m } from "motion/react";
import { ease } from "@/components/motion/presets";
import { ShareRing } from "@/components/signature/share-ring";
import { VERSION } from "./fixtures";

/*
 * The go-live moment: the version has just become Active. Quiet, about 1.5 seconds:
 *
 *    0 ms     the canvas washes over (240 ms) and the ring stamps in at 152px: it lands from 1.14x and a
 *             six degree twist, like a seal pressed onto the page; a hairline ripple leaves it
 *  160 ms     one line under it, "v3 is Active", fades in
 * 1000 ms     the status flips behind the wash (the badge, the stepper), the line and the wash lift (300 ms)
 *             and the ring flies to the header's ring slot, shrinking to 76px (520 ms, a soft in-out)
 * 1520 ms     the ring is in the slot: the overlay is removed and the header's own ring takes over at
 *             the same size and place, so nothing pops
 *
 * The ring is a plain ShareRing at 152px and is only ever scaled DOWN, so the lettering stays crisp.
 * Reduced motion never mounts this: the end state (Active, the ring in its slot) appears at once.
 */

export const RING = 152;
export const SLOT = 76;
const HOLD_MS = 1000;
const FLY_MS = 520;

const IN = { duration: 0.42, ease: ease.outSoft } as const;
const FLY = { duration: FLY_MS / 1000, ease: [0.65, 0, 0.35, 1] } as const;

export function GoLive({
  slotRef,
  onFlip,
  onDone,
}: {
  /** The header's ring slot: where the ring lands. */
  slotRef: RefObject<HTMLElement | null>;
  /** The moment the status should flip. */
  onFlip: () => void;
  onDone: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fly, setFly] = useState<{ x: number; y: number; scale: number } | null>(null);
  const flip = useEffectEvent(onFlip);
  const done = useEffectEvent(onDone);

  useEffect(() => {
    const toSlot = setTimeout(() => {
      const from = box.current?.getBoundingClientRect();
      const to = slotRef.current?.getBoundingClientRect();
      setFly(
        from && to
          ? { x: to.left + to.width / 2 - (from.left + from.width / 2), y: to.top + to.height / 2 - (from.top + from.height / 2), scale: to.width / from.width }
          : { x: 0, y: 0, scale: SLOT / RING },
      );
      flip();
    }, HOLD_MS);
    const landed = setTimeout(() => done(), HOLD_MS + FLY_MS);
    return () => {
      clearTimeout(toSlot);
      clearTimeout(landed);
    };
  }, [slotRef]);

  const flying = fly !== null;

  return (
    <div data-go-live="" className="pointer-events-none absolute inset-0 z-40 grid place-items-center">
      <p role="status" className="sr-only">
        v{VERSION} is Active
      </p>
      <m.div
        aria-hidden
        className="absolute inset-0 bg-canvas/92"
        initial={{ opacity: 0 }}
        animate={{ opacity: flying ? 0 : 1 }}
        transition={flying ? { duration: 0.3, ease: ease.outSoft } : { duration: 0.24, ease: ease.outSoft }}
      />
      <div aria-hidden className="relative flex -translate-y-6 flex-col items-center">
        <div ref={box} className="relative" style={{ width: RING, height: RING }}>
          <m.span
            className="absolute inset-0 rounded-full border border-hairline-strong"
            initial={{ opacity: 0, scale: 1 }}
            animate={{ opacity: [0, 0.7, 0], scale: 1.75 }}
            transition={{ duration: 0.9, delay: 0.22, ease: "easeOut", times: [0, 0.2, 1] }}
          />
          <m.div
            initial={{ opacity: 0, scale: 1.14, rotate: -6 }}
            animate={
              fly
                ? { opacity: 1, scale: fly.scale, rotate: 0, x: fly.x, y: fly.y }
                : { opacity: 1, scale: 1, rotate: 0, x: 0, y: 0 }
            }
            transition={flying ? FLY : IN}
          >
            <ShareRing size={RING} tabIndex={-1} label={`v${VERSION} is Active`} />
          </m.div>
        </div>
        <m.p
          className="display-lg mt-7 text-text"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: flying ? 0 : 1, y: 0 }}
          transition={flying ? { duration: 0.2 } : { duration: 0.32, delay: 0.16, ease: ease.outSoft }}
        >
          v{VERSION} is Active
        </m.p>
      </div>
    </div>
  );
}

