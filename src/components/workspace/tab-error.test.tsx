// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The template workspace's error boundary (src/app/(product)/[team]/templates/[templateId]/error.tsx): a tab
// that threw, in the document's cell under the header and the tab bar the layout keeps.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useParams: () => ({ team: "coral-offers", templateId: "UC-ABC123" }) }));

const { TAB_FAILED, TabError } = await import("./tab-error");
const { WS } = await import("./workspace-grid");

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

describe("TabError", () => {
  it("takes the document's cell of the workspace grid", async () => {
    await act(async () => root.render(<TabError error={error()} retry={() => {}} />));
    const cell = container.querySelector('[data-slot="tab-error"]');
    expect(cell?.className).toContain(WS.doc);
  });

  it("says the tab didn't load, as an alert", async () => {
    await act(async () => root.render(<TabError error={error()} retry={() => {}} />));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(TAB_FAILED);
  });

  it("offers Try again in outline (the tab bar keeps the black button) and retries with it", async () => {
    const retry = vi.fn();
    await act(async () => root.render(<TabError error={error()} retry={retry} />));
    const tryAgain = control("Try again")!;
    expect(tryAgain.className).not.toContain("bg-primary");
    await act(async () => tryAgain.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("links back to the space's Library", async () => {
    await act(async () => root.render(<TabError error={error()} retry={() => {}} />));
    const back = control("Back to library");
    expect(back?.tagName).toBe("A");
    expect(back?.getAttribute("href")).toBe("/coral-offers/library");
  });

  it("shows the digest and not the error's message", async () => {
    await act(async () => root.render(<TabError error={error()} retry={() => {}} />));
    expect(container.textContent).toContain("Error ID 4101045379");
    expect(container.textContent).not.toContain("SQLITE");
  });
});
