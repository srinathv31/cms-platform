// @vitest-environment happy-dom
// Saving the picker's inline "New variable" form hands focus back to the document at once. The form held
// focus and unmounts with the picker, and TipTap's own focus waits for the next frame, so without this a key
// typed in between lands on <body> and is lost (the period that went missing in demo step 2.4).
//
// The test saves the form and checks, before any timer or frame can run, that the document has focus, the caret
// sits right after the chip, and a key goes to the document and lands.

import type { Editor } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doc, p, press, type } from "../testing/editor";
import { DocumentEditor } from "./document-editor";
import { EditorRoot } from "./editor-root";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom's Web Animations reject when the unmounting picker cancels its entrance. Without `animate` on
// elements, Motion drives the entrance itself.
delete (Element.prototype as { animate?: unknown }).animate;

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

type LiveDoc = HTMLElement & { editor?: Editor };

async function mountDocument(): Promise<{ dom: LiveDoc; editor: Editor }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <EditorRoot variables={[]}>
        <DocumentEditor content={doc(p("Offer ends"))} />
      </EditorRoot>,
    );
  });
  // The live editor swaps in once the block handle's module has loaded (it loads on the client only).
  let dom: LiveDoc | null = null;
  await vi.waitFor(() => {
    dom = host.querySelector<LiveDoc>(".ucomp-doc.ProseMirror");
    expect(dom?.editor).toBeDefined();
  });
  return { dom: dom!, editor: dom!.editor! };
}

/** What a browser does with a key: it goes to the focused element, or to <body> when nothing has focus. */
function pressKey(key: string): Element {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  return target;
}

describe("saving the inline New variable form", () => {
  it("returns focus to the document before the next frame, and a key typed at once lands", async () => {
    const { dom, editor } = await mountDocument();

    // " until {{Offer end date" opens the picker; its only item is Create, which Enter chooses.
    await act(async () => {
      dom.focus();
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    await act(async () => type(editor, " until {{Offer end date"));
    await act(async () => void press(editor, "Enter"));
    const form = document.querySelector<HTMLFormElement>(
      'form[aria-label="New variable"]',
    );
    expect(form).not.toBeNull();
    const label = form!.querySelector<HTMLInputElement>("input");
    expect(document.activeElement).toBe(label);

    // Enter in the form saves. Synchronous: no timer and no animation frame has run when it returns.
    act(() => {
      label!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      document.querySelector('form[aria-label="New variable"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(dom);
    const { selection } = editor.state;
    expect(selection.empty).toBe(true);
    expect(selection.$from.nodeBefore?.type.name).toBe("variable");
    expect(selection.$from.nodeBefore?.attrs.key).toBe("offer_end_date");

    // The next key goes to the document, and the text lands after the chip.
    expect(dom.contains(pressKey("."))).toBe(true);
    type(editor, ".");
    expect(editor.state.selection.$from.parent.textContent).toBe(
      "Offer ends until .",
    );
    expect(editor.state.selection.$from.nodeBefore?.text).toBe(".");
    await act(async () => {}); // the chip's node view renders in a microtask
  });
});
