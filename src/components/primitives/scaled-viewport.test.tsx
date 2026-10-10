// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScaledBox, ScaledViewport, containScale } from "./scaled-viewport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let box = { width: 600, height: 400 };
let observed: (() => void) | null = null;

class FakeResizeObserver {
  constructor(callback: () => void) {
    observed = callback;
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  box = { width: 600, height: 400 };
  observed = null;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // happy-dom lays nothing out: give every element the box's size.
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

describe("ScaledViewport", () => {
  const inner = () => container.querySelector<HTMLElement>('[data-slot="scaled-viewport"] > div');

  it("lays its content out at the design width and scales it down to the box's width", () => {
    act(() => root.render(<ScaledViewport width={1200}>x</ScaledViewport>));
    const el = inner()!;
    expect(el.style.width).toBe("1200px");
    expect(el.style.transform).toBe("scale(0.5)");
    // Once scaled, the content is exactly as tall as the box.
    expect(el.style.height).toBe("800px");
    expect(container.querySelector("[data-scale]")?.getAttribute("data-scale")).toBe("0.500");
  });

  it("never scales up", () => {
    box = { width: 1600, height: 400 };
    act(() => root.render(<ScaledViewport width={1200}>x</ScaledViewport>));
    expect(inner()!.style.transform).toBe("scale(1)");
    expect(inner()!.style.height).toBe("400px");
  });

  it("follows the box when it is resized", () => {
    act(() => root.render(<ScaledViewport width={1200}>x</ScaledViewport>));
    box = { width: 300, height: 400 };
    act(() => observed?.());
    expect(inner()!.style.transform).toBe("scale(0.25)");
  });
});

describe("containScale", () => {
  const phone = { width: 400, height: 800 };

  it("fits both width and height, never above 1", () => {
    expect(containScale({ width: 600, height: 400 }, phone)).toBe(0.5);
    expect(containScale({ width: 200, height: 2000 }, phone)).toBe(0.5);
    expect(containScale({ width: 1000, height: 2000 }, phone)).toBe(1);
  });

  it("holds the height at the minimum, and lets the content run past the box's bottom", () => {
    expect(containScale({ width: 600, height: 320 }, phone, 0.6)).toBe(0.6);
    // Width still fits: a narrower box goes below the minimum rather than overflow sideways.
    expect(containScale({ width: 200, height: 320 }, phone, 0.6)).toBe(0.5);
  });
});

describe("ScaledBox", () => {
  const reserve = () => container.querySelector<HTMLElement>('[data-slot="scaled-reserve"]')!;
  const content = () => reserve().firstElementChild as HTMLElement;

  it("lays its content out at its own size and reserves the scaled size, with the room under it", () => {
    act(() =>
      root.render(
        <ScaledBox width={400} height={800} room={16}>
          x
        </ScaledBox>,
      ),
    );
    expect(content().style.width).toBe("400px");
    expect(content().style.height).toBe("800px");
    expect(content().style.transform).toBe("scale(0.5)");
    expect(reserve().style.width).toBe("200px");
    expect(reserve().style.height).toBe("416px");
    expect(reserve().getAttribute("data-scale")).toBe("0.500");
  });

  it("takes its scale from the caller when given one, and follows the box", () => {
    act(() =>
      root.render(
        <ScaledBox width={400} height={800} scale={(b) => containScale(b, { width: 400, height: 1000 }, 0.3)}>
          x
        </ScaledBox>,
      ),
    );
    expect(content().style.transform).toBe("scale(0.4)");
    box = { width: 600, height: 200 };
    act(() => observed?.());
    expect(content().style.transform).toBe("scale(0.3)");
    expect(reserve().style.height).toBe("240px");
  });
});
