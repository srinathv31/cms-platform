"use client";

// Notion-style block handle on the OFFICIAL DragHandle (@tiptap/extension-drag-handle-react):
// a + that inserts a block below and opens the `/` menu, and a ⋮⋮ grip that drags the block.
// Centered on each block's first line. Never rendered in read-only mode.

import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { isNodeRangeSelection } from "@tiptap/extension-node-range";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { GripVertical, Plus } from "lucide-react";
import { useEffect, useRef } from "react";

// Stable reference: the React DragHandle re-registers its plugin when this object changes.
const POSITION = { placement: "left", strategy: "absolute" } as const;

const BUTTON =
  "flex size-6 items-center justify-center rounded-md text-text-subtle transition-colors duration-100 hover:bg-hover hover:text-text-muted";

type Current = { node: PMNode | null; pos: number };

export function BlockHandle({ editor }: { editor: Editor }) {
  const current = useRef<Current>({ node: null, pos: -1 });
  const bar = useRef<HTMLDivElement>(null);

  // Typing hides the handle until the pointer really moves. (Chrome replays a synthetic
  // mousemove when layout shifts under a still pointer, which would otherwise pop the handle
  // back up mid-sentence; synthetic moves have no movement delta.)
  useEffect(() => {
    if (editor.isDestroyed) return; // a stale editor while a hidden <Activity> reconnects
    const dom = editor.view.dom;
    const surface = dom.parentElement;
    const onKeyDown = () => bar.current?.setAttribute("data-typing", "");
    const onMouseMove = (event: MouseEvent) => {
      if (event.movementX !== 0 || event.movementY !== 0) bar.current?.removeAttribute("data-typing");
    };
    dom.addEventListener("keydown", onKeyDown);
    surface?.addEventListener("mousemove", onMouseMove);
    return () => {
      dom.removeEventListener("keydown", onKeyDown);
      surface?.removeEventListener("mousemove", onMouseMove);
    };
  }, [editor]);

  // The first line box of the hovered block, so the handle centers on line one of any block
  // (a heading, a list's first item, a table's header row, a callout's first paragraph).
  const firstLineRect = () => {
    const { pos } = current.current;
    if (pos < 0 || editor.isDestroyed) return null;
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return null;
    const block = dom.getBoundingClientRect();
    const line = dom.matches("p, h1, h2, h3") ? dom : dom.querySelector<HTMLElement>("p, h1, h2, h3");
    let top = block.top;
    let height = block.height;
    if (line) {
      const style = getComputedStyle(line);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
      top = line.getBoundingClientRect().top + Number.parseFloat(style.paddingTop || "0");
      height = lineHeight;
    }
    const rect = { x: block.left, y: top, left: block.left, top, width: block.width, height, right: block.right, bottom: top + height };
    return { getBoundingClientRect: () => rect };
  };

  const insertBelow = () => {
    const { node, pos } = current.current;
    if (!node || pos < 0 || editor.isDestroyed) return;
    const chain = editor.chain().focus(undefined, { scrollIntoView: false });
    if (node.type.name === "paragraph" && node.content.size === 0) {
      // Reuse the empty line under the pointer instead of adding another.
      chain.insertContentAt(pos + 1, "/").run();
      return;
    }
    const after = pos + node.nodeSize;
    chain
      .insertContentAt(after, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .setTextSelection(after + 2)
      .run();
  };

  // After a drop (or a cancelled drag) the DragHandle leaves the moved blocks selected as a
  // NodeRangeSelection. Typing over that would replace whole blocks, so settle the caret at the
  // end of the moved content instead.
  const settleSelection = () => {
    window.setTimeout(() => {
      if (editor.isDestroyed) return;
      const { selection, doc, tr } = editor.state;
      if (!isNodeRangeSelection(selection)) return;
      editor.view.dispatch(tr.setSelection(TextSelection.near(doc.resolve(selection.to), -1)));
    }, 0);
  };

  const hideWhenLeaving = (event: React.MouseEvent) => {
    if (editor.isDestroyed) return;
    const to = event.relatedTarget;
    if (to instanceof Node && editor.view.dom.contains(to)) return;
    editor.view.dispatch(editor.state.tr.setMeta("hideDragHandle", true));
  };

  return (
    <DragHandle
      editor={editor}
      className="ucomp-block-handle"
      computePositionConfig={POSITION}
      getReferencedVirtualElement={firstLineRect}
      onNodeChange={({ node, pos }) => {
        current.current = { node, pos };
      }}
      onElementDragEnd={settleSelection}
    >
      <div ref={bar} className="flex items-center gap-px pr-1.5 data-typing:invisible" onMouseLeave={hideWhenLeaving}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Insert block below"
          className={BUTTON}
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertBelow}
        >
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        <div aria-label="Drag to move block" role="img" className={`${BUTTON} cursor-grab active:cursor-grabbing`}>
          <GripVertical className="size-4" strokeWidth={1.75} aria-hidden />
        </div>
      </div>
    </DragHandle>
  );
}
