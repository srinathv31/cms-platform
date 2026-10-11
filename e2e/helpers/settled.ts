import type { Page } from "@playwright/test";

/**
 * Waits until the page has stopped changing, so a check that reads colours, sizes or layout shifts reads the
 * screen a person ends up with. It stands in for the fixed sleeps that used to follow a load, a click or a resize.
 *
 * Settled means all of these, read on every animation frame:
 *   - web fonts are loaded;
 *   - no finite animation, CSS transition or view transition is running (an endless one, such as a spinner, is
 *     ignored: it never ends);
 *   - the size of the page and the box of every element are the same as on the last `STILL_FRAMES` frames.
 *
 * It does not wait for anything to appear: wait for that first (a web-first assertion on the thing, a
 * skeleton gone), then call this to let its entrance finish.
 *
 * It cannot settle while something moves for as long as it is there: the Share ring turns while the pointer is over
 * it. Move the pointer away first, or don't call it.
 */

/** Consecutive frames the layout must hold still: about 130 ms at 60 Hz, long enough for a late section or focus ring to land. */
const STILL_FRAMES = 8;
/** The elements whose boxes are compared; a screen has far fewer, and the cap keeps a frame cheap. */
const MAX_ELEMENTS = 2000;

interface Seen {
  print: string;
  still: number;
}

export async function settled(page: Page, options: { timeout?: number } = {}) {
  await page.evaluate(() => {
    delete (window as unknown as { __settled?: Seen }).__settled;
    return document.fonts.ready;
  });
  await page.waitForFunction(
    ({ still, max }) => {
      const w = window as unknown as { __settled?: Seen };
      const running = document
        .getAnimations()
        .some((animation) => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity);
      const parts = [`${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`];
      let count = 0;
      for (const el of document.body.querySelectorAll("*")) {
        if (++count > max) break;
        const r = el.getBoundingClientRect();
        parts.push(`${Math.round(r.x * 2)},${Math.round(r.y * 2)},${Math.round(r.width * 2)},${Math.round(r.height * 2)}`);
      }
      const print = parts.join(";");
      const previous = w.__settled;
      const frames = previous && previous.print === print && !running ? previous.still + 1 : 0;
      w.__settled = { print, still: frames };
      return document.fonts.status === "loaded" && frames >= still;
    },
    { still: STILL_FRAMES, max: MAX_ELEMENTS },
    { polling: "raf", timeout: options.timeout ?? 20_000 },
  );
}
