// @vitest-environment happy-dom
// Hiding and re-showing the editor with React's <Activity> (what Next does to a route on browser
// Back / Forward): effects clean up on hide, TipTap destroys the editor, and on show the effects
// run again, in Next before the new editor's view exists. Nothing may touch a view that isn't
// mounted (TipTap's `editor.view` throws then), and the editor must come back working.
//
// Two tests: the editor's chrome rendered against an editor whose view isn't mounted yet (the
// exact state those effects meet; deterministic), and full hide/show cycles of DocumentEditor and
// InlineVariableField inside <Activity>.

import { Editor as ReactEditor } from "@tiptap/react";
import { Activity, StrictMode, act, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { JSONContent, Variable } from "../model/types";
import { editorExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import { createEditorRootRuntime } from "../state/editor-root";
import { BlockHandle } from "./block-handle";
import { ChipPopover } from "./chip-popover";
import { doc, h2, p, text } from "../testing/editor";
import { DocumentEditor } from "./document-editor";
import { EditorRoot } from "./editor-root";
import { FormatBubble } from "./format-bubble";
import { InlineVariableField } from "./inline-variable-field";
import { SlashMenu, createSlashMenuController } from "./slash-menu";
import { TableMenu } from "./table-menu";
import { VariablePicker, createVariablePickerController } from "./variable-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VARIABLES: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];
const CONTENT = doc(h2("Offer details", "offer_details"), p("Hello there"), { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("Cell")] }] }] });
const SUBJECT: JSONContent = doc({ type: "paragraph", content: [text("Hi "), { type: "variable", attrs: { key: "first_name" } }] });

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

let setMode: (mode: "visible" | "hidden") => void = () => {};
let root: Root | null = null;
let errors: unknown[] = [];

function Harness() {
  const [mode, set] = useState<"visible" | "hidden">("visible");
  useEffect(() => {
    setMode = set;
  }, []);
  return (
    <Activity mode={mode}>
      <EditorRoot variables={VARIABLES}>
        <InlineVariableField label="Email subject" value={SUBJECT} />
        <DocumentEditor content={CONTENT} />
      </EditorRoot>
    </Activity>
  );
}

async function mount() {
  errors = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host, {
      onUncaughtError: (error) => errors.push(error),
      onCaughtError: (error) => errors.push(error),
      onRecoverableError: (error) => errors.push(error),
    });
    // Strict Mode (as in Next's dev server) re-runs effects when an Activity is revealed.
    root.render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
  });
  await wait(20);
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

type DomEditor = { getText: () => string; commands: { setTextSelection: (p: number) => boolean }; on: (event: "destroy", fn: () => void) => void };
const liveDoc = (host: HTMLElement) => host.querySelector<HTMLElement & { editor?: DomEditor }>(".ucomp-doc.ProseMirror");
const liveField = (host: HTMLElement) => host.querySelector<HTMLElement>(".ucomp-field-input.ProseMirror");

/**
 * Hide, and re-show right as TipTap destroys the hidden editor (its cleanup timer), before React
 * has re-rendered the hidden tree: the re-shown effects see the destroyed editor (no view), the
 * sequence Next produces on browser Back / Forward.
 */
async function hideAndShow(host: HTMLElement, times = 1) {
  for (let i = 0; i < times; i++) {
    const editors = [liveDoc(host)?.editor, (liveField(host) as { editor?: unknown } | null)?.editor].filter(Boolean) as Array<{
      on: (event: "destroy", fn: () => void) => void;
    }>;
    const destroyed = new Promise<void>((resolve) => editors[0]?.on("destroy", () => queueMicrotask(resolve)));
    await act(async () => setMode("hidden"));
    await destroyed;
    flushSync(() => setMode("visible"));
    await wait(30);
  }
}

describe("hidden and re-shown with <Activity>", () => {
  it("re-shows without errors, with a live document and inline field", async () => {
    const host = await mount();
    expect(liveDoc(host)).not.toBeNull();
    expect(liveField(host)).not.toBeNull();
    await hideAndShow(host, 3);
    expect(errors).toEqual([]);
    expect(liveDoc(host)).not.toBeNull();
    expect(liveField(host)).not.toBeNull();
    expect(liveDoc(host)?.textContent).toContain("Hello there");
    expect(liveField(host)?.textContent).toContain("First name");
  });

  it("the block handle and the toolbar's keys are wired to the new editor", async () => {
    const host = await mount();
    await hideAndShow(host);
    const dom = liveDoc(host)!;
    // Typing hides the block handle (a listener on the live document's element).
    const bar = host.querySelector(".ucomp-block-handle > div");
    expect(bar).not.toBeNull();
    await act(async () => {
      dom.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    expect(bar?.hasAttribute("data-typing")).toBe(true);
    // The table control's Alt+F10 listener is attached too (caret in the table).
    await act(async () => {
      dom.editor!.commands.setTextSelection(dom.editor!.getText().indexOf("Cell") + 4);
    });
    await wait(10);
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Table options"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(trigger);
    expect(errors).toEqual([]);
  });
});

describe("the editor's chrome before its view is mounted", () => {
  it("renders without touching the view, and wires up once the view mounts", async () => {
    const runtime = createEditorRootRuntime({ variables: VARIABLES });
    const slash = createSlashMenuController();
    const picker = createVariablePickerController();
    const chip = createChipPopoverStore();
    // No element: the view doesn't exist yet (`editor.view.dom` would throw).
    const editor = new ReactEditor({
      element: null,
      extensions: editorExtensions({ store: runtime.variables, slashRender: slash.render, pickerRender: picker.render }),
      content: CONTENT,
    });
    expect(() => editor.view.dom).toThrow();

    const host = document.createElement("div");
    const frame = document.createElement("div");
    frame.className = "ucomp-editor";
    const surface = document.createElement("div");
    frame.append(surface, host);
    document.body.appendChild(frame);
    errors = [];
    await act(async () => {
      root = createRoot(host, { onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) });
      root.render(
        <>
          <ChipPopover editor={editor} root={runtime} chip={chip} />
          <BlockHandle editor={editor} slash={slash} />
          <TableMenu editor={editor} />
          <FormatBubble editor={editor} />
          <SlashMenu controller={slash} editor={editor} />
          <VariablePicker controller={picker} editor={editor} root={runtime} />
        </>,
      );
    });
    expect(errors).toEqual([]);

    // The view arrives: listeners attach to it.
    await act(async () => {
      editor.mount(surface);
    });
    const dom = editor.view.dom;
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 4); // in the table cell
    });
    const trigger = frame.querySelector<HTMLButtonElement>('[aria-label="Table options"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(trigger);
    expect(errors).toEqual([]);

    // And when the view goes again (destroy), nothing throws either.
    await act(async () => {
      editor.destroy();
    });
    await act(async () => root?.render(<FormatBubble editor={editor} />));
    expect(errors).toEqual([]);
  });
});
