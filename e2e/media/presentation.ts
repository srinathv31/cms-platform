import { glide, moveTo } from "./demo";
import type { Pacing } from "./pacing";

// The pacing of a recording (the `demo` project): a viewer needs to see the mouse travel, the press, the
// text arrive and the drag lift off. It is installed by the fixture in ./stage.ts and by nothing else.

export const presentation: Required<Pacing> = {
  async click(target, options) {
    await moveTo(target.page(), target, options?.position);
    await target.click({ delay: 140, ...options });
  },

  type: (page, text) => page.keyboard.type(text, { delay: 45 }),

  /** The same gesture as the plain drag, slowly enough to watch: glide to the row, lift off, glide over the target. */
  async dragRow(page, from, to) {
    await glide(page, from);
    await page.mouse.down();
    await page.waitForTimeout(160);
    await page.mouse.move(from.x - 12, from.y - 8, { steps: 6 });
    await glide(page, to);
    await page.waitForTimeout(240);
    await page.mouse.up();
  },
};
