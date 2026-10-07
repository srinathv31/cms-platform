// @vitest-environment happy-dom
import { act, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_THREAD, type Person, type ThreadView } from "@/domain/review-types";
import type { DocumentEditorHandle } from "@/editor/types";
import { GutterMarkers, markerThreads, nextMarkerIndex } from "./gutter-markers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JORDAN: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 212 };

function thread(id: string, blockId: string, patch: Partial<ThreadView> = {}, comments = 1): ThreadView {
  return {
    id,
    blockId,
    quote: null,
    status: "open",
    originVersionNumber: 1,
    comments: Array.from({ length: comments }, (_, i) => ({
      id: `${id}-${i}`,
      author: JORDAN,
      body: "Text",
      kind: "comment" as const,
      createdAt: "2027-02-18T10:00:00Z",
    })),
    orphaned: false,
    ...patch,
  };
}

const THREADS: ThreadView[] = [
  thread("doc", DOCUMENT_THREAD),
  thread("t1", "b1", {}, 2),
  thread("t2", "b1"),
  thread("t3", "b3"),
  thread("t4", "b5"),
  thread("done", "b2", { status: "resolved" }),
  thread("gone", "b9", { orphaned: true }),
];

/** Boxes by thread, in viewport coordinates (the layer's own box is at 0 in happy-dom). */
const TOPS: Record<string, number> = { t1: 120, t2: 180, t3: 300, t4: 520 };
const rect = (top: number, height = 20) => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0 }) as DOMRect;

function handle(): { ref: RefObject<DocumentEditorHandle | null>; notify: () => void; subscribe: ReturnType<typeof vi.fn> } {
  let listener: (() => void) | null = null;
  const subscribe = vi.fn((fn: () => void) => {
    listener = fn;
    return () => {
      listener = null;
    };
  });
  const ref = createRef<DocumentEditorHandle | null>() as { current: DocumentEditorHandle | null };
  ref.current = {
    focus: () => {},
    focusThread: () => {},
    getBlockRect: () => null,
    getThreadRect: (id) => (id in TOPS ? rect(TOPS[id]) : null),
    subscribeBlockRects: subscribe,
    requestComment: () => {},
  };
  return { ref, notify: () => listener?.(), subscribe };
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const markers = () => Array.from(container.querySelectorAll<HTMLButtonElement>("[data-marker]"));
const tabStops = () => markers().filter((m) => m.tabIndex === 0);
const key = (el: HTMLElement, name: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });

function render(over: Partial<React.ComponentProps<typeof GutterMarkers>> = {}) {
  const h = handle();
  const props = { editor: h.ref, threads: THREADS, activeThreadId: null, onActivate: vi.fn(), ...over };
  act(() => root.render(<div style={{ position: "relative" }}><GutterMarkers {...props} /></div>));
  return { ...h, props };
}

describe("markerThreads", () => {
  it("groups open threads on blocks, and leaves out the change request, resolved and orphaned ones", () => {
    const groups = markerThreads(THREADS);
    expect(groups.map((g) => [g.blockId, g.threads.map((t) => t.id)])).toEqual([
      ["b1", ["t1", "t2"]],
      ["b3", ["t3"]],
      ["b5", ["t4"]],
    ]);
  });
});

describe("GutterMarkers", () => {
  it("draws one marker per block with open threads, counting the comments on it, top to bottom", () => {
    render();
    expect(markers().map((m) => m.dataset.marker)).toEqual(["b1", "b3", "b5"]);
    expect(markers()[0].getAttribute("aria-label")).toBe("3 comments on this block");
    expect(markers()[1].getAttribute("aria-label")).toBe("1 comment on this block");
    expect(markers()[0].textContent).toBe("3");
  });

  it("says 'in unchanged blocks' for a marker that stands for collapsed blocks, with the count in the right number", () => {
    render({ collapsedKeys: new Set(["b1", "b3"]) });
    expect(markers()[0].getAttribute("aria-label")).toBe("3 comments in unchanged blocks");
    expect(markers()[1].getAttribute("aria-label")).toBe("1 comment in unchanged blocks");
    expect(markers()[2].getAttribute("aria-label")).toBe("1 comment on this block");
  });

  it("puts focus back on the thread's marker when choosing it re-keys the marker", () => {
    const h = handle();
    const onActivate = vi.fn();
    const show = (threads: ThreadView[], activeThreadId: string | null) =>
      act(() => root.render(<div style={{ position: "relative" }}><GutterMarkers editor={h.ref} threads={threads} activeThreadId={activeThreadId} onActivate={onActivate} /></div>));
    // t3 is hidden at first (its marker is on the line "collapsed:x"); activating reveals it on its own block.
    const hidden = THREADS.map((t) => (t.id === "t3" ? { ...t, blockId: "collapsed:x" } : t));
    show(hidden, null);
    const marker = markers().find((m) => m.dataset.marker === "collapsed:x")!;
    act(() => marker.focus());
    expect(document.activeElement).toBe(marker);
    act(() => marker.click());
    expect(onActivate).toHaveBeenCalledWith("t3");
    show(THREADS, "t3"); // the marker is now keyed "b3": the focused button is gone
    const moved = markers().find((m) => m.dataset.marker === "b3")!;
    expect(document.activeElement).toBe(moved);
  });

  it("puts a marker at the height of the thread's first line", () => {
    render();
    // t1 sits at 120 and is 20 tall: its line's centre is 130, and the 24px marker is centred on it.
    expect(markers()[0].style.top).toBe("118px");
    expect(markers()[1].style.top).toBe("298px");
  });

  it("sits the compact markers 4px from the text, clear of a whole-block wash, and the normal ones 8px", () => {
    render();
    expect(markers()[0].style.left).toBe("8px");
    expect(markers()[0].style.width).toBe("24px");
    render({ compact: true });
    expect(markers()[0].style.left).toBe("4px");
    expect(markers()[0].style.width).toBe("20px");
  });

  it("measures again when the editor says blocks moved", () => {
    const { notify, subscribe } = render();
    expect(subscribe).toHaveBeenCalled();
    TOPS.t3 = 340;
    act(() => notify());
    expect(markers()[1].style.top).toBe("338px");
    TOPS.t3 = 300;
  });

  it("activates the block's first thread, then the next on a second press", () => {
    const onActivate = vi.fn();
    render({ onActivate });
    act(() => markers()[0].click());
    expect(onActivate).toHaveBeenLastCalledWith("t1");
    render({ onActivate, activeThreadId: "t1" });
    act(() => markers()[0].click());
    expect(onActivate).toHaveBeenLastCalledWith("t2");
  });

  it("marks the active thread's marker as pressed", () => {
    render({ activeThreadId: "t3" });
    expect(markers().map((m) => m.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });
});

describe("GutterMarkers: one tab stop for the whole group", () => {
  it("makes the first marker the only tab stop", () => {
    render();
    expect(tabStops().map((m) => m.dataset.marker)).toEqual(["b1"]);
  });

  it("makes the active thread's marker the tab stop", () => {
    render({ activeThreadId: "t4" });
    expect(tabStops().map((m) => m.dataset.marker)).toEqual(["b5"]);
  });

  it("moves between markers with the arrow keys, Home and End, and the tab stop follows focus", () => {
    render();
    act(() => markers()[0].focus());
    key(markers()[0], "ArrowDown");
    expect(document.activeElement).toBe(markers()[1]);
    expect(tabStops().map((m) => m.dataset.marker)).toEqual(["b3"]);
    key(markers()[1], "End");
    expect(document.activeElement).toBe(markers()[2]);
    key(markers()[2], "ArrowDown");
    expect(document.activeElement).toBe(markers()[2]);
    key(markers()[2], "ArrowUp");
    expect(document.activeElement).toBe(markers()[1]);
    key(markers()[1], "Home");
    expect(document.activeElement).toBe(markers()[0]);
  });

  it("is one group with a name, for assistive technology", () => {
    render();
    const group = container.querySelector('[role="toolbar"]')!;
    expect(group.getAttribute("aria-label")).toBe("Comments in the document");
    expect(group.querySelectorAll("button")).toHaveLength(3);
  });

  it("draws nothing when there is nothing to mark", () => {
    render({ threads: THREADS.filter((t) => t.status === "resolved") });
    expect(markers()).toHaveLength(0);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });
});

describe("nextMarkerIndex", () => {
  it("steps, jumps and stays inside the group", () => {
    expect(nextMarkerIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextMarkerIndex("ArrowUp", 0, 3)).toBe(0);
    expect(nextMarkerIndex("ArrowDown", 2, 3)).toBe(2);
    expect(nextMarkerIndex("End", 0, 3)).toBe(2);
    expect(nextMarkerIndex("Home", 2, 3)).toBe(0);
    expect(nextMarkerIndex("Enter", 1, 3)).toBeNull();
    expect(nextMarkerIndex("ArrowDown", 0, 0)).toBeNull();
  });
});
