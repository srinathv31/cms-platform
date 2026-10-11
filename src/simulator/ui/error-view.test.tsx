// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIM_PAGE_FAILED, SimError } from "./error-view";

// Coral's error boundary (src/app/(simulator)/error.tsx): a page under /sim that threw, in Coral's own look,
// going back to /sim rather than to a Stencil space's Library.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const error = () => Object.assign(new Error("SQLITE_BUSY"), { digest: "4101045379" });
const control = (name: string) =>
  [...container.querySelectorAll<HTMLElement>("button, a")].find((el) => el.textContent?.trim() === name) ?? null;

describe("SimError", () => {
  it("says the page didn't load, as the page's title", async () => {
    await act(async () => root.render(<SimError error={error()} retry={() => {}} />));
    expect(container.querySelector("h1")?.textContent).toBe(SIM_PAGE_FAILED);
  });

  it("goes back to Coral's home, not to a Stencil Library", async () => {
    await act(async () => root.render(<SimError error={error()} retry={() => {}} />));
    const back = control("Back to offers");
    expect(back?.tagName).toBe("A");
    expect(back?.getAttribute("href")).toBe("/sim");
    expect(control("Back to library")).toBeNull();
  });

  it("retries with Try again, and not twice while the route is fetched again", async () => {
    let settle!: () => void;
    const retry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    await act(async () => root.render(<SimError error={error()} retry={retry as unknown as () => void} />));
    const tryAgain = control("Try again")!;
    await act(async () => tryAgain.click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(tryAgain.getAttribute("aria-busy")).toBe("true");
    await act(async () => tryAgain.click());
    expect(retry).toHaveBeenCalledTimes(1);
    await act(async () => settle());
  });

  it("shows the digest and not the error's message", async () => {
    await act(async () => root.render(<SimError error={error()} retry={() => {}} />));
    expect(container.textContent).toContain("Error ID 4101045379");
    expect(container.textContent).not.toContain("SQLITE");
  });

  it("shows no digest when Next gave none", async () => {
    await act(async () => root.render(<SimError error={new Error("boom")} retry={() => {}} />));
    expect(container.textContent).not.toContain("Error ID");
  });
});
