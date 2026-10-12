import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOBILE_BREAKPOINT } from "./use-mobile";

// The app shell turns its sidebar into a drawer below one width (decision 0045). React decides which sidebar to render
// from `useIsMobile`, and a server-rendered page can only ask CSS, so `globals.css` repeats the width in two variants.
// The two must be the same number: a gap would show the column and the drawer's button together, or neither.
// A `shadcn add sidebar` that overwrites the hook brings back 768 and fails this.

const css = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

describe("the shell's breakpoint", () => {
  it("is 800px", () => {
    expect(MOBILE_BREAKPOINT).toBe(800);
  });

  it("is the number in globals.css's `narrow:` and `wide:` variants", () => {
    expect(css).toContain(
      `@custom-variant narrow (@media (max-width: ${MOBILE_BREAKPOINT - 1}px));`,
    );
    expect(css).toContain(
      `@custom-variant wide (@media (min-width: ${MOBILE_BREAKPOINT}px));`,
    );
  });

  it("is the one tokens.css gives the canvas a narrow padding below", () => {
    const tokens = readFileSync(
      new URL("../styles/tokens.css", import.meta.url),
      "utf8",
    );
    expect(tokens).toContain(`@media (max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  });
});
