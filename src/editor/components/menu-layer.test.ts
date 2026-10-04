// @vitest-environment happy-dom
// makeRoomBelow (components/menu-layer.ts): menus open below the caret, scrolling first when the
// page can make room, flipping (opening at once) when it can't.

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRoomBelow } from "./menu-layer";

const caretAt = (top: number) => new DOMRect(100, top, 2, 20);

function page({ viewport = 800, scrollable = 2000 }: { viewport?: number; scrollable?: number }) {
  const context = document.createElement("div");
  document.body.appendChild(context);
  const scroller = document.scrollingElement as HTMLElement;
  Object.defineProperty(window, "innerHeight", { value: viewport, configurable: true });
  Object.defineProperty(scroller, "scrollHeight", { value: scrollable, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: viewport, configurable: true });
  Object.defineProperty(scroller, "scrollTop", { value: 0, configurable: true, writable: true });
  const scrollBy = vi.fn();
  scroller.scrollBy = scrollBy as unknown as typeof scroller.scrollBy;
  return { context, scrollBy };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("makeRoomBelow", () => {
  it("opens at once when the menu fits below the caret", () => {
    const { context, scrollBy } = page({});
    const ready = vi.fn();
    makeRoomBelow(context, caretAt(200), 300, 6, ready);
    expect(ready).toHaveBeenCalledOnce();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("scrolls by just enough first, then opens", () => {
    vi.useFakeTimers();
    const { context, scrollBy } = page({});
    const ready = vi.fn();
    makeRoomBelow(context, caretAt(650), 300, 6, ready);
    // 650 + 20 + 6 + 300 + 8 − 800 = 184
    expect(scrollBy).toHaveBeenCalledWith({ top: 184, behavior: "smooth" });
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(ready).toHaveBeenCalledOnce();
  });

  it("opens at once (and flips) when the page can't scroll far enough", () => {
    const { context, scrollBy } = page({ scrollable: 850 });
    const ready = vi.fn();
    makeRoomBelow(context, caretAt(650), 300, 6, ready);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledOnce();
  });

  it("never scrolls the caret's line out of view", () => {
    const { context, scrollBy } = page({ viewport: 300 });
    const ready = vi.fn();
    makeRoomBelow(context, caretAt(200), 280, 6, ready);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledOnce();
  });
});
