// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page and global error boundaries (src/app/(product)/error.tsx, src/app/global-error.tsx): what they
// say, their two ways out, and the digest. The error's own message never shows.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let params: Record<string, string> = { team: "coral-offers" };
vi.mock("next/navigation", () => ({ useParams: () => params }));

const { GlobalErrorView, PAGE_FAILED, PageError } = await import("./route-error");

/** A server error as Next hands it to the client: a generic message, and the digest its log line carries. */
const serverError = () => Object.assign(new Error("Unexpected token in JSON: card ending 4242"), { digest: "4215074262" });

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  params = { team: "coral-offers" };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}

const button = (name: string) =>
  [...container.querySelectorAll<HTMLElement>("button, a")].find((el) => el.textContent?.trim() === name) ?? null;

describe("PageError", () => {
  it("says the page didn't load, as the page's title", async () => {
    await render(<PageError error={serverError()} retry={() => {}} />);
    expect(container.querySelector("h1")?.textContent).toBe(PAGE_FAILED);
  });

  it("makes Try again the one black button, and Back to library an outline link to the space's Library", async () => {
    await render(<PageError error={serverError()} retry={() => {}} />);
    expect(button("Try again")?.className).toContain("bg-primary");
    const back = button("Back to library");
    expect(back?.tagName).toBe("A");
    expect(back?.getAttribute("href")).toBe("/coral-offers/library");
    expect(back?.className).not.toContain("bg-primary");
  });

  it("goes back to / outside a space", async () => {
    params = {};
    await render(<PageError error={serverError()} retry={() => {}} />);
    expect(button("Back to library")?.getAttribute("href")).toBe("/");
  });

  it("retries when Try again is pressed", async () => {
    const retry = vi.fn();
    await render(<PageError error={serverError()} retry={retry} />);
    await act(async () => button("Try again")!.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the digest for support, and never the error's message", async () => {
    await render(<PageError error={serverError()} retry={() => {}} />);
    expect(container.textContent).toContain("Error ID 4215074262");
    expect(container.textContent).not.toContain("JSON");
    expect(container.textContent).not.toContain("4242");
  });

  it("shows no digest line for an error without one (a client error)", async () => {
    await render(<PageError error={new Error("boom")} retry={() => {}} />);
    expect(container.textContent).not.toContain("Error ID");
    expect(container.textContent).not.toContain("boom");
  });
});

describe("GlobalErrorView", () => {
  it("stands in for the frame: the canvas panel with the page's error, Try again and the way back", async () => {
    const retry = vi.fn();
    await render(<GlobalErrorView error={serverError()} retry={retry} />);
    expect(container.querySelector("main h1")?.textContent).toBe(PAGE_FAILED);
    expect(button("Back to library")?.getAttribute("href")).toBe("/coral-offers/library");
    expect(container.textContent).toContain("Error ID 4215074262");
    await act(async () => button("Try again")!.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
