// @vitest-environment happy-dom
// Review-comment mechanics in <DocumentEditor>: highlights from props, the Comment action (editable
// and read-only), ⌘⌥M, and the handle's thread methods before mount, while hidden and after.

import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { Activity, StrictMode, act, useEffect, useState, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadHighlights } from "../extensions/review-threads";
import { isApple } from "../lib/platform";
import type { JSONContent, Variable } from "../model/types";
import { doc, text } from "../testing/editor";
import type { CommentRequest, DocumentEditorHandle, ThreadAnchor } from "../types";
import { DocumentEditor } from "./document-editor";
import { EditorRoot } from "./editor-root";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VARIABLES: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];
const para = (id: string, value: string): JSONContent => ({ type: "paragraph", attrs: { id }, content: [text(value)] });
const CONTENT = doc(
  { type: "heading", attrs: { id: "h1", level: 2, requiredKey: "offer_details" }, content: [text("Offer details")] },
  para("p1", "Earn 2% cash back on every purchase."),
  para("p2", "Pay no annual fee in the first year."),
  para("p3", "Questions? Call us."),
);
const THREADS: ThreadAnchor[] = [
  { id: "t1", blockId: "p1", quote: "2% cash back", status: "open" },
  { id: "t2", blockId: "p3", quote: null, status: "open" },
  { id: "t3", blockId: "p2", quote: "annual fee", status: "resolved" },
];

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const BUBBLE_DELAY = 220; // BubbleMenu's update delay is 150 ms

interface HarnessProps {
  readOnly?: boolean;
  threads?: ThreadAnchor[];
  activeThreadId?: string | null;
  onRequestComment?: (anchor: CommentRequest) => void;
  attach?: Ref<DocumentEditorHandle>;
}

let root: Root | null = null;
let setProps: (props: Omit<HarnessProps, "attach">) => void = () => {};
let setMode: (mode: "visible" | "hidden") => void = () => {};

function Harness({ attach, ...initial }: HarnessProps) {
  const [props, set] = useState<Omit<HarnessProps, "attach">>(initial);
  const [mode, setActivity] = useState<"visible" | "hidden">("visible");
  useEffect(() => {
    setProps = (next) => set((prev) => ({ ...prev, ...next }));
    setMode = setActivity;
  }, []);
  return (
    <Activity mode={mode}>
      <EditorRoot variables={VARIABLES} readOnly={props.readOnly}>
        <DocumentEditor
          content={CONTENT}
          threads={props.threads}
          activeThreadId={props.activeThreadId}
          onRequestComment={props.onRequestComment}
          ref={attach}
        />
      </EditorRoot>
    </Activity>
  );
}

async function mount(props: HarnessProps = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <StrictMode>
        <Harness {...props} />
      </StrictMode>,
    );
  });
  // The live editor swaps in once the block handle's module has loaded (it loads on the client only).
  await vi.waitFor(async () => {
    await wait(10);
    expect(host.querySelector(".ProseMirror")).not.toBeNull();
  });
  await wait(20);
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

const liveEditor = (host: HTMLElement) => host.querySelector<HTMLElement & { editor?: Editor }>(".ucomp-doc.ProseMirror")?.editor ?? null;

/** Position of `needle` in the document (inside one text node). */
function at(editor: Editor, needle: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return found < 0;
  });
  return found;
}

/** Selects text the way a reader does: the page's selection, then ProseMirror's. */
async function selectText(editor: Editor, from: number, to: number, { focus = true } = {}) {
  await act(async () => {
    const start = editor.view.domAtPos(from);
    const end = editor.view.domAtPos(to);
    document.getSelection()?.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
    if (focus && editor.isEditable) editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  });
  await wait(BUBBLE_DELAY);
}

/** The toolbar's buttons by the name a person gets: the label when it has one, else its text (Comment shows its name). */
const toolbarButtons = () =>
  [...document.querySelectorAll<HTMLElement>('[role="toolbar"] button')].map(
    (b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "",
  );
const commentButton = () =>
  [...document.querySelectorAll<HTMLElement>('[role="toolbar"] button')].find((b) => b.textContent?.trim() === "Comment")!;

function pressCommentShortcut() {
  const apple = isApple();
  return act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "m", code: "KeyM", altKey: true, metaKey: apple, ctrlKey: !apple, bubbles: true }));
  });
}

describe("highlights from props", () => {
  it("draws open threads (live and in the first paint) and moves the active mark with activeThreadId", async () => {
    const host = await mount({ threads: THREADS, activeThreadId: "t1" });
    const editor = liveEditor(host)!;
    expect(threadHighlights(editor.state).map((h) => `${h.threadId}${h.active ? "*" : ""}:${h.kind}`)).toEqual(["t1*:text", "t2:block"]);
    expect(host.querySelector('mark[data-thread="t1"][data-active]')?.textContent).toBe("2% cash back");
    expect(host.querySelector('[data-thread="t3"]')).toBeNull();

    await act(async () => setProps({ activeThreadId: "t2" }));
    expect(host.querySelector("[data-active]")?.getAttribute("data-thread-block")).toBe("t2");

    // An equal list with a new identity changes nothing; a resolved thread loses its highlight.
    await act(async () => setProps({ threads: THREADS.map((t) => ({ ...t })) }));
    expect(threadHighlights(editor.state)).toHaveLength(2);
    await act(async () => setProps({ threads: THREADS.map((t) => (t.id === "t1" ? { ...t, status: "resolved" as const } : t)) }));
    expect(host.querySelector('[data-thread="t1"]')).toBeNull();
  });
});

describe("the Comment action", () => {
  it("editable: selected text gets Comment after the format buttons; it asks for a comment on that text", async () => {
    const onRequestComment = vi.fn();
    const host = await mount({ onRequestComment });
    const editor = liveEditor(host)!;
    const from = at(editor, "2% cash back");
    await selectText(editor, from, from + "2% cash back".length);
    expect(toolbarButtons()).toEqual(["Bold", "Italic", "Underline", "Link", "Comment"]);
    const comment = commentButton();
    // An icon and its name, not an icon alone.
    expect(comment.textContent?.trim()).toBe("Comment");
    expect(comment.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(comment.getAttribute("aria-keyshortcuts")).toBe(isApple() ? "Meta+Alt+M" : "Control+Alt+M");
    await act(async () => comment.click());
    expect(onRequestComment).toHaveBeenCalledExactlyOnceWith({ blockId: "p1", quote: "2% cash back" });
  });

  it("no Comment without onRequestComment, or for a selection across blocks", async () => {
    const host = await mount();
    const editor = liveEditor(host)!;
    const from = at(editor, "cash back");
    await selectText(editor, from, from + 4);
    expect(toolbarButtons()).toEqual(["Bold", "Italic", "Underline", "Link"]);

    const onRequestComment = vi.fn();
    await act(async () => setProps({ onRequestComment }));
    await selectText(editor, from, at(editor, "annual fee"));
    expect(toolbarButtons()).toEqual(["Bold", "Italic", "Underline", "Link"]);
    await pressCommentShortcut();
    expect(onRequestComment).not.toHaveBeenCalled();
  });

  it("a required heading takes no formatting but can take a comment", async () => {
    const onRequestComment = vi.fn();
    const host = await mount({ onRequestComment });
    const editor = liveEditor(host)!;
    await selectText(editor, 1, 6);
    expect(toolbarButtons()).toEqual(["Comment"]);
  });

  it("read-only: selecting text shows a toolbar with Comment only, which goes when the selection leaves", async () => {
    const onRequestComment = vi.fn();
    const host = await mount({ readOnly: true, onRequestComment });
    const editor = liveEditor(host)!;
    expect(editor.isEditable).toBe(false);
    const from = at(editor, "annual fee");
    await selectText(editor, from, from + "annual fee".length);
    expect(toolbarButtons()).toEqual(["Comment"]);
    expect(document.querySelector('[role="toolbar"]')?.getAttribute("aria-label")).toBe("Comment on text");
    // No editing affordances: no block handle, table control or menus.
    expect(host.querySelector(".ucomp-block-handle")).toBeNull();

    expect(commentButton().querySelector("svg")).not.toBeNull();
    await act(async () => commentButton().click());
    expect(onRequestComment).toHaveBeenCalledExactlyOnceWith({ blockId: "p2", quote: "annual fee" });

    await selectText(editor, from, from + 6);
    expect(toolbarButtons()).toEqual(["Comment"]);
    await act(async () => {
      document.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(toolbarButtons()).toEqual([]);
  });

  it("read-only without onRequestComment: no toolbar at all", async () => {
    const host = await mount({ readOnly: true });
    const editor = liveEditor(host)!;
    const from = at(editor, "annual fee");
    await selectText(editor, from, from + "annual fee".length);
    expect(toolbarButtons()).toEqual([]);
  });

  it("⌘⌥M asks for a comment on the selected text, or on the caret's block", async () => {
    const onRequestComment = vi.fn();
    const host = await mount({ onRequestComment });
    const editor = liveEditor(host)!;
    const from = at(editor, "every purchase");
    await selectText(editor, from, from + "every purchase".length);
    await pressCommentShortcut();
    await act(async () => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at(editor, "Call"))));
    });
    await pressCommentShortcut();
    expect(onRequestComment.mock.calls).toEqual([[{ blockId: "p1", quote: "every purchase" }], [{ blockId: "p3" }]]);
  });

  it("⌘⌥M does nothing when the document doesn't hold the focus or the selection", async () => {
    const onRequestComment = vi.fn();
    const host = await mount({ onRequestComment });
    const editor = liveEditor(host)!;
    const from = at(editor, "every purchase");
    await selectText(editor, from, from + 5);
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    await act(async () => outside.focus());
    await pressCommentShortcut();
    expect(onRequestComment).not.toHaveBeenCalled();
  });
});

describe("the handle's thread methods", () => {
  it("are safe before the editor mounts: focusThread applies once it's there, requestComment goes straight out", async () => {
    const onRequestComment = vi.fn();
    const listener = vi.fn();
    const seen: Array<string | null> = [];
    let unsubscribe: (() => void) | null = null;
    let first = true;
    const attach = (ref: DocumentEditorHandle | null) => {
      if (!ref || !first) return;
      first = false;
      const handle = ref as Required<DocumentEditorHandle>;
      // The ref arrives in the commit, before TipTap has created (or mounted) its editor.
      expect(document.querySelector(".ucomp-doc.ProseMirror")).toBeNull();
      handle.focusThread("t2");
      handle.requestComment("p3");
      const rect = handle.getBlockRect("p1");
      seen.push(rect === null ? null : typeof rect.top);
      expect(handle.getBlockRect("nope")).toBeNull();
      expect(handle.getThreadRect("nope")).toBeNull();
      unsubscribe = handle.subscribeBlockRects(listener);
    };
    const host = await mount({ threads: THREADS, onRequestComment, attach });
    const editor = liveEditor(host)!;
    expect(onRequestComment).toHaveBeenCalledExactlyOnceWith({ blockId: "p3" });
    expect(threadHighlights(editor.state).find((h) => h.active)?.threadId).toBe("t2");
    expect(seen).toHaveLength(1);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe!();
  });

  it("keep working while the editor is hidden (<Activity>) and re-shown", async () => {
    let handle: Required<DocumentEditorHandle> | null = null;
    const host = await mount({ threads: THREADS, attach: (h) => void (handle = (h as Required<DocumentEditorHandle>) ?? handle) });
    const destroyed = new Promise<void>((resolve) => liveEditor(host)!.on("destroy", () => queueMicrotask(resolve)));
    await act(async () => setMode("hidden"));
    await destroyed;
    expect(() => {
      handle!.focusThread("t1");
      handle!.getBlockRect("p1");
      handle!.getThreadRect("t1");
      handle!.subscribeBlockRects(() => {})();
    }).not.toThrow();
    await act(async () => setMode("visible"));
    await wait(30);
    const editor = liveEditor(host)!;
    expect(threadHighlights(editor.state).find((h) => h.active)?.threadId).toBe("t1");
    expect(host.querySelector('mark[data-thread="t1"][data-active]')?.textContent).toBe("2% cash back");
  });

  it("subscribeBlockRects fires (once a frame) when blocks are added or move", async () => {
    let handle: Required<DocumentEditorHandle> | null = null;
    const host = await mount({ attach: (h) => void (handle = (h as Required<DocumentEditorHandle>) ?? handle) });
    const editor = liveEditor(host)!;
    const listener = vi.fn();
    const unsubscribe = handle!.subscribeBlockRects(listener);
    await wait(40);
    listener.mockClear();
    await act(async () => {
      editor.commands.insertContentAt(0, { type: "paragraph", content: [text("New first line")] });
      editor.commands.insertContentAt(0, { type: "paragraph", content: [text("Another")] });
    });
    await wait(40);
    expect(listener).toHaveBeenCalledTimes(1);
    // Typing inside a block (no move, no resize) doesn't.
    listener.mockClear();
    await act(async () => {
      editor.commands.insertContentAt(at(editor, "Call"), "x");
    });
    await wait(40);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
