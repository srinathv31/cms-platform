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

function setup(table: object = TABLE) {
  const frame = document.createElement("div");
  frame.className = "ucomp-editor";
  const element = document.createElement("div");
  const host = document.createElement("div");
  frame.append(element, host);
  document.body.appendChild(frame);
  const editor = new Editor({ element, extensions: editorExtensions({ store: createVariableStore([]) }), content: doc(p("Before"), table) });
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

  it("at 12 columns, Insert column left and right are disabled and say why; rows can still be added", async () => {
    const wide = {
      type: "table",
      content: [0, 1].map(() => ({ type: "tableRow", content: Array.from({ length: 12 }, () => ({ type: "tableCell", content: [p("x")] })) })),
    };
    const { editor, frame } = setup(wide);
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 4);
    });
    await act(async () => {
      trigger(frame)!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const item = (label: string) => [...frame.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes(label));
    for (const label of ["Insert column left", "Insert column right"]) {
      const element = item(label);
      expect(element?.hasAttribute("data-disabled"), label).toBe(true);
      const reason = frame.querySelector(`#${CSS.escape(element?.getAttribute("aria-describedby") ?? "")}`);
      expect(reason?.textContent).toBe("Tables can have at most 12 columns.");
    }
    expect(item("Insert row below")?.hasAttribute("data-disabled")).toBe(false);
  });

  it("below 12 columns, Insert column is available and nothing is explained", async () => {
    const { editor, frame } = setup();
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 4);
    });
    await act(async () => {
      trigger(frame)!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const insert = [...frame.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes("Insert column right"));
    expect(insert?.hasAttribute("data-disabled")).toBe(false);
    expect(frame.textContent).not.toContain("at most 12 columns");
  });
});
