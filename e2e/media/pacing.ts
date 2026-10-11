import type { Locator, Page } from "@playwright/test";

// What the demo project changes about how the helpers act on the page. The functional helpers in
// helpers/scenario.ts (`tap`, `typeSlowly`, `dragRowTo`) do the plain thing: click, type, drag, with no
// pauses. In the `demo` project the fixture in ./stage.ts fills this object with the presentation versions
// (./presentation.ts) for the length of each test, and empties it again. Nothing here is set in `chromium`,
// so a functional test carries no recording code and no delay.

export type ClickOptions = Parameters<Locator["click"]>[0];

export interface Point {
  x: number;
  y: number;
}

export interface Pacing {
  /** Instead of a plain click: glide the mouse to the target, press and release slowly enough to see. */
  click?(target: Locator, options?: ClickOptions): Promise<void>;
  /** Instead of typing at test speed. */
  type?(page: Page, text: string): Promise<void>;
  /** Instead of the plain drag of a panel row from `from` to `to`. */
  dragRow?(page: Page, from: Point, to: Point): Promise<void>;
}

/** Empty unless the demo project's fixture has filled it. */
export const pacing: Pacing = {};
