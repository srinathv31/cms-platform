// @vitest-environment happy-dom
// The block handle's way to the block menu from the keyboard (components/block-handle.tsx): Alt+F10
// in the text puts the focused "Block options" button beside the caret's block; in a table cell it
// stays the table control's, unless the caret is in a numbered list inside the cell.

import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Editor } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "../schema";
import { createVariableStore } from "../state/variable-store";
import { byRole } from "../testing/editor";
import { BlockHandle } from "./block-handle";
import { createSlashMenuController } from "./slash-menu";
import { TableMenu } from "./table-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const li = (text: string, ...nested: JSONContent[]): JSONContent => ({ type: "listItem", content: [p(text), ...nested] });
const DOC: JSONContent = {
  type: "doc",
  content: [
    p("Intro"),
    { type: "orderedList", content: [li("One", { type: "orderedList", content: [li("Inner")] })] },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p("Plain cell")] },
            { type: "tableCell", content: [{ type: "orderedList", content: [li("Cell item")] }] },
          ],
        },
      ],
    },
  ],
};

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function setup() {
  const frame = document.createElement("div");
  frame.className = "ucomp-editor";
  const surface = document.createElement("div");
  const host = document.createElement("div");
  frame.append(surface, host);
  document.body.appendChild(frame);
  const editor = new Editor({ element: surface, extensions: editorExtensions({ store: createVariableStore([]) }), content: DOC });
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(
      <>
        <BlockHandle editor={editor} slash={createSlashMenuController()} />
        <TableMenu editor={editor} />
      </>,
    );
  });
  cleanup = () => {
    act(() => root.unmount());
    editor.destroy();
  };
  return { editor, frame };
}

function caretIn(editor: Editor, text: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === text) at = pos + 1;
    return at < 0;
  });
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  });
}

async function altF10(editor: Editor) {
  await act(async () => {
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true, cancelable: true }));
    await wait(20);
  });
}

const blockButton = (frame: HTMLElement) => frame.querySelector<HTMLButtonElement>('button[aria-label="Block options"]');
const tableButton = (frame: HTMLElement) => frame.querySelector<HTMLButtonElement>('[aria-label="Table options"]');

describe("Alt+F10", () => {
  it("in a nested numbered list: the block's button, focused; Enter opens the menu for that list", async () => {
    const { editor, frame } = setup();
    caretIn(editor, "Inner");
    await altF10(editor);
    const button = blockButton(frame);
    expect(button).not.toBeNull();
    expect(document.activeElement).toBe(button);
    await act(async () => {
      button!.click(); // Enter on a button
      await wait(20);
    });
    const menu = byRole(frame, "menu", "Block options");
    expect(menu?.textContent).toContain("Numbered list · level 2");
  });

  it("in a plain paragraph: the block's button too (its numbering items say why they're off)", async () => {
    const { editor, frame } = setup();
    caretIn(editor, "Intro");
    await altF10(editor);
    expect(document.activeElement).toBe(blockButton(frame));
  });

  it("in a table cell: the table control's, as before", async () => {
    const { editor, frame } = setup();
    caretIn(editor, "Plain cell");
    await altF10(editor);
    expect(blockButton(frame)).toBeNull();
    expect(document.activeElement).toBe(tableButton(frame));
  });

  it("in a numbered list inside a table cell: the block menu's, and only it", async () => {
    const { editor, frame } = setup();
    caretIn(editor, "Cell item");
    await altF10(editor);
    expect(document.activeElement).toBe(blockButton(frame));
  });
});
