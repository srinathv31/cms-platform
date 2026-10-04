// @vitest-environment happy-dom
// The table control (components/table-menu.tsx): shown only while the caret is in a table of an
// editable document, and reachable with Alt+F10.

import { Editor } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "../schema";
import { createVariableStore } from "../state/variable-store";
import { doc, p } from "../testing/editor";
import { TableMenu } from "./table-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

const TABLE = {
  type: "table",
  content: [
    { type: "tableRow", content: [{ type: "tableHeader", content: [p("Fee")] }, { type: "tableHeader", content: [p("Amount")] }] },
    { type: "tableRow", content: [{ type: "tableCell", content: [p("Annual")] }, { type: "tableCell", content: [p("$95")] }] },
  ],
};

function setup() {
  const frame = document.createElement("div");
  frame.className = "ucomp-editor";
  const element = document.createElement("div");
  const host = document.createElement("div");
  frame.append(element, host);
  document.body.appendChild(frame);
  const editor = new Editor({ element, extensions: editorExtensions({ store: createVariableStore([]) }), content: doc(p("Before"), TABLE) });
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(<TableMenu editor={editor} />);
  });
  cleanup = () => {
    act(() => root.unmount());
    editor.destroy();
  };
  return { editor, frame };
}

const trigger = (frame: HTMLElement) => frame.querySelector<HTMLButtonElement>('[aria-label="Table options"]');

describe("TableMenu", () => {
  it("appears with the caret in a table and goes when it leaves", () => {
    const { editor, frame } = setup();
    expect(trigger(frame)).toBeNull();
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 4);
    });
    expect(trigger(frame)).not.toBeNull();
    expect(trigger(frame)?.getAttribute("aria-keyshortcuts")).toBe("Alt+F10");
    act(() => {
      editor.commands.setTextSelection(2);
    });
    expect(trigger(frame)).toBeNull();
  });

  it("Alt+F10 in the table moves focus to it; Esc returns to the cell", async () => {
    const { editor, frame } = setup();
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 4);
    });
    act(() => {
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(trigger(frame));
    act(() => {
      trigger(frame)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    // TipTap focuses on the next frame.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it("isn't shown in a read-only document", () => {
    const { editor, frame } = setup();
    act(() => {
      editor.setEditable(false);
      editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 4);
    });
    expect(trigger(frame)).toBeNull();
  });
});
