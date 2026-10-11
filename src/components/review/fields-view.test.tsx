// @vitest-environment happy-dom
import { act, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ChannelFields } from "@/domain/channel-fields";
import { diffChannelFields } from "@/domain/redline";
import type { Person, ThreadView } from "@/domain/review-types";
import type { JSONContent } from "@/domain/types";
import type { CommentRequest, DocumentEditorHandle } from "@/editor/types";
import { FieldsView } from "./fields-view";

// A document's email subject and preheader on the review screen take comments as a block of the body does: a
// marker in the gutter for a thread on one, a button that starts one, and a handle the screen's focus and
// comment calls go through (the body keeps its own).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JORDAN: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 212 };
const line = (text: string): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const channelFields: ChannelFields = { email: { subject: line("Your terms are ready"), preheader: line("What to know before you spend.") } };
const FIELDS = diffChannelFields(null, { channels: ["email"], channelFields }).fields;

function thread(id: string, blockId: string, patch: Partial<ThreadView> = {}): ThreadView {
  return {
    id,
    blockId,
    quote: null,
    status: "open",
    originVersionNumber: 1,
    originRound: 1,
    originLabel: "v1",
    comments: [{ id: `${id}-c`, author: JORDAN, body: "Text", kind: "comment", createdAt: "2027-02-18T10:00:00Z" }],
    orphaned: false,
    ...patch,
  };
}

const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0 }) as DOMRect;
/** Where each field's frame is on screen (happy-dom lays nothing out): the subject first, 60px apart. */
const TOP: Record<string, number> = { "email.subject": 100, "email.preheader": 160 };

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = TOP[this.getAttribute("data-block-id") ?? ""];
    return top === undefined ? rect(0, 0) : rect(top, 50);
  });
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (this.hasAttribute("data-block-id") ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

interface Handlers {
  onActivate: Mock<(threadId: string) => void>;
  onRequestComment: Mock<(anchor: CommentRequest) => void>;
  onRequestBlockComment: Mock<(blockId: string) => void>;
}

/** Mounts the details with the gutter's first measure done (the markers find the handle a frame after mount). */
async function mount(threads: ThreadView[], over: { activeBlockId?: string | null; commenting?: boolean } = {}) {
  const handleRef = createRef<DocumentEditorHandle | null>() as RefObject<DocumentEditorHandle | null>;
  const handlers: Handlers = { onActivate: vi.fn(), onRequestComment: vi.fn(), onRequestBlockComment: vi.fn() };
  const commenting = over.commenting ?? true;
  act(() =>
    root.render(
      <FieldsView
        layout="details"
        fields={FIELDS}
        variables={[]}
        changesOnly={false}
        footer={null}
        handleRef={handleRef}
        anchors={threads}
        threads={threads}
        activeThreadId={null}
        activeBlockId={over.activeBlockId ?? null}
        onActivate={handlers.onActivate}
        onRequestComment={commenting ? handlers.onRequestComment : undefined}
        onRequestBlockComment={commenting ? handlers.onRequestBlockComment : undefined}
      />,
    ),
  );
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
  });
  return { handleRef, ...handlers };
}

const markers = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[data-slot="gutter-markers"] [data-marker]'));
const frame = (id: string) => container.querySelector<HTMLElement>(`.ucomp-doc > [data-block-id="${id}"]`)!;
const hover = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
  });

describe("FieldsView, as a document's email details", () => {
  it("draws the subject and the preheader as the details block above the body, framed by their ids", async () => {
    await mount([]);
    expect(container.querySelector('[data-fields-document="details"]')).not.toBeNull();
    expect([...container.querySelectorAll(".ucomp-doc > [data-block-id]")].map((el) => el.getAttribute("data-block-id"))).toEqual([
      "email.subject",
      "email.preheader",
    ]);
  });

  it("marks a thread on the subject in the gutter, counting its comments, in a group of its own", async () => {
    await mount([thread("t1", "email.subject"), thread("t2", "email.subject")]);
    expect(markers().map((m) => m.dataset.marker)).toEqual(["email.subject"]);
    expect(markers()[0].getAttribute("aria-label")).toBe("2 comments on this field");
    expect(container.querySelector('[role="toolbar"]')?.getAttribute("aria-label")).toBe("Comments on the email details");
  });

  it("marks the preheader too, below the subject's, and leaves out resolved threads and threads on blocks of the body", async () => {
    await mount([
      thread("t1", "email.preheader"),
      thread("done", "email.subject", { status: "resolved" }),
      thread("body", "b_intro"),
    ]);
    expect(markers().map((m) => m.dataset.marker)).toEqual(["email.preheader"]);
  });

  it("opens the thread when its marker is chosen", async () => {
    const { onActivate } = await mount([thread("t1", "email.subject")]);
    act(() => markers()[0].click());
    expect(onActivate).toHaveBeenCalledWith("t1");
  });

  it("starts a comment on the whole field from the hover button beside it", async () => {
    const { onRequestBlockComment } = await mount([]);
    expect(container.querySelector('[data-slot="block-comment"]')).toBeNull();
    hover(frame("email.subject"));
    const add = container.querySelector<HTMLButtonElement>('[data-slot="block-comment"] button')!;
    expect(add.getAttribute("aria-label")).toBe("Comment on this field");
    act(() => add.click());
    expect(onRequestBlockComment).toHaveBeenCalledWith("email.subject");
  });

  it("offers no way to start one to someone who can't comment, and keeps the markers that are there", async () => {
    await mount([thread("t1", "email.subject")], { commenting: false });
    hover(frame("email.preheader"));
    expect(container.querySelector('[data-slot="block-comment"]')).toBeNull();
    expect(markers()).toHaveLength(1);
  });

  it("answers the screen's handle for a field: where it is, and a comment on it", async () => {
    const { handleRef, onRequestComment } = await mount([thread("t1", "email.preheader")]);
    const handle = handleRef.current!;
    expect(handle.getBlockRect("email.preheader")?.top).toBe(160);
    expect(handle.getThreadRect("t1")?.top).toBe(160);
    expect(handle.getBlockRect("b_intro"), "a block of the body isn't here").toBeNull();
    handle.requestComment("email.subject");
    expect(onRequestComment).toHaveBeenCalledWith({ blockId: "email.subject" });
  });

  it("tints the field a thread is being read or written on", async () => {
    await mount([], { activeBlockId: "email.subject" });
    expect(frame("email.subject").hasAttribute("data-active")).toBe(true);
    expect(frame("email.preheader").hasAttribute("data-active")).toBe(false);
  });
});
