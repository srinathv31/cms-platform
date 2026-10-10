// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_WIDTH, MOBILE_FRAME_WIDTH, MOBILE_WIDTH, WebOutput } from "./web-output";

// The frame itself is the BufferedFrame's business; here it is a stand-in with the same name.
vi.mock("./buffered-frame", () => ({
  BufferedFrame: ({ title }: { title: string }) => <iframe title={title} />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
const box = { width: 600, height: 400 };

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // happy-dom lays nothing out: give every element the pane's size.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => box.width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => box.height);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WebOutput", () => {
  it("shows Desktop as an 800px browser window scaled to the pane", () => {
    expect(DESKTOP_WIDTH).toBe(800);
    act(() => root.render(<WebOutput html="<p>x</p>" device="desktop" host="coraloffers.example" />));
    const desktop = container.querySelector('[data-device="desktop"]')!;
    expect(desktop.querySelector('[data-slot="browser-chrome"]')?.textContent).toContain("coraloffers.example");
    expect(desktop.querySelector("iframe")?.getAttribute("title")).toBe("Web preview");
    const scaled = desktop.querySelector<HTMLElement>('[data-slot="scaled-viewport"] > div')!;
    expect(scaled.style.width).toBe(`${DESKTOP_WIDTH}px`);
    expect(scaled.style.transform).toBe(`scale(${600 / DESKTOP_WIDTH})`);
  });

  it("shows Mobile as a plain 390px column, with no browser chrome and no scaling", () => {
    act(() => root.render(<WebOutput html="<p>x</p>" device="mobile" />));
    const mobile = container.querySelector('[data-device="mobile"]')!;
    expect(mobile.querySelector("iframe")?.getAttribute("title")).toBe("Web preview");
    expect(container.querySelector('[data-slot="browser-chrome"]')).toBeNull();
    expect(container.querySelector('[data-slot="scaled-viewport"]')).toBeNull();
    // The frame is the viewport plus its bezel (8px of padding and a 1px border a side), so the
    // document inside it is exactly 390px: 408px of frame, not 406 (which left 388).
    expect(MOBILE_FRAME_WIDTH).toBe(MOBILE_WIDTH + 18);
    expect((mobile as HTMLElement).style.width).toBe(`${MOBILE_FRAME_WIDTH}px`);
    expect(mobile.className).toContain("p-2");
    expect(mobile.className).toContain("border");
    expect(mobile.className).not.toContain("box-content");
  });

  it("keeps the browser chrome out of the accessibility tree", () => {
    act(() => root.render(<WebOutput html="<p>x</p>" device="desktop" host="coraloffers.example" />));
    expect(container.querySelector('[data-slot="browser-chrome"]')?.getAttribute("aria-hidden")).toBe("true");
  });
});
