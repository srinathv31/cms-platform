// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedlineHandle, redlineBlockElement, revealInContainer } from "./dom-handle";
import { RedlineDocument } from "./redline-document";
import { REDLINE_DOC, REDLINE_VARIABLES } from "./redline-fixtures";

function mount() {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<RedlineDocument doc={REDLINE_DOC} variables={REDLINE_VARIABLES} />);
  document.body.append(host);
  return host;
}

/** happy-dom lays nothing out: give an element a box, as the browser would. */
function layOut(element: Element | null, box: { top: number; height: number }) {
  if (!element) throw new Error("no element");
  Object.defineProperty(element, "getClientRects", { value: () => [{}] });
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => ({ top: box.top, bottom: box.top + box.height, height: box.height, left: 0, right: 100, width: 100, x: 0, y: box.top, toJSON: () => ({}) }),
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("redlineBlockElement", () => {
  it("finds a block's frame by id, and nothing for an unknown id or no root", () => {
    const host = mount();
    expect(redlineBlockElement(host, "p-3")?.getAttribute("data-redline")).toBe("changed");
    expect(redlineBlockElement(host, "nope")).toBeNull();
    expect(redlineBlockElement(null, "p-3")).toBeNull();
  });
});

describe("createRedlineHandle", () => {
  const handle = (host: HTMLElement, onRequestComment = vi.fn()) =>
    ({
      onRequestComment,
      handle: createRedlineHandle({
        root: () => host,
        blockOfThread: (id) => ({ t1: "p-3", composer: "p-1", t2: "gone" })[id] ?? null,
        onRequestComment,
      }),
    });

  it("reports a block's box, and a thread's as its block's", () => {
    const host = mount();
    layOut(redlineBlockElement(host, "p-3"), { top: 300, height: 54 });
    const { handle: h } = handle(host);
    expect(h.getBlockRect("p-3")?.top).toBe(300);
    expect(h.getThreadRect("t1")?.top).toBe(300);
    Object.defineProperty(redlineBlockElement(host, "p-1"), "getClientRects", { value: () => [] });
    expect(h.getThreadRect("composer")).toBeNull(); // p-1 isn't laid out (a hidden tab)
    expect(h.getThreadRect("t2")).toBeNull(); // its block isn't in the redline
    expect(h.getThreadRect("unknown")).toBeNull();
    expect(h.getBlockRect("missing")).toBeNull();
  });

  it("asks for a comment on a block through the host's callback, and ignores an empty id", () => {
    const host = mount();
    const { handle: h, onRequestComment } = handle(host);
    h.requestComment("p-4");
    h.requestComment("");
    expect(onRequestComment).toHaveBeenCalledTimes(1);
    expect(onRequestComment).toHaveBeenCalledWith({ blockId: "p-4" });
  });

  it("scrolls a thread's block into view and is safe for one it can't find", () => {
    const host = mount();
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    document.body.append(scroller);
    scroller.append(host);
    Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
    Object.defineProperty(scroller, "clientHeight", { value: 600 });
    Object.defineProperty(scroller, "scrollTop", { value: 100, writable: true });
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    layOut(scroller, { top: 0, height: 600 });
    layOut(redlineBlockElement(host, "p-3"), { top: 900, height: 60 });
    const { handle: h } = handle(host);
    h.focusThread("t1");
    // Centered in the band the sticky bars leave free (64px under the top, 40px above the bottom: 496px high):
    // the block's top (900) less the band's top (64) less (496 - 60) / 2 = 218, on top of the 100 already scrolled.
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 718 }));
    scrollTo.mockClear();
    h.focusThread("unknown");
    h.focusThread("t2");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("subscribes, and stops", () => {
    const host = mount();
    const { handle: h } = handle(host);
    const off = h.subscribeBlockRects(() => {});
    expect(typeof off).toBe("function");
    off();
    expect(createRedlineHandle({ root: () => null, blockOfThread: () => null }).subscribeBlockRects(() => {})()).toBeUndefined();
  });
});

describe("revealInContainer", () => {
  it("leaves a block that is already well inside the view alone", () => {
    const host = mount();
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    document.body.append(scroller);
    scroller.append(host);
    Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
    Object.defineProperty(scroller, "clientHeight", { value: 600 });
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    layOut(scroller, { top: 0, height: 600 });
    const block = redlineBlockElement(host, "p-3")!;
    layOut(block, { top: 200, height: 60 });
    revealInContainer(block);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
