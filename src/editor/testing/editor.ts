// Test helpers for headless editors (happy-dom). Not part of the public API; used by *.test.ts.
// Keys go through ProseMirror's own handleKeyDown chain, text through handleTextInput: the same
// paths a browser takes.

import { Editor, type Extensions, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { SlashRender } from "../extensions/slash-command";
import { editorExtensions } from "../schema";
import { createVariableStore } from "../state/variable-store";

export const text = (value: string): JSONContent => ({ type: "text", text: value });
export const p = (value = ""): JSONContent => (value ? { type: "paragraph", content: [text(value)] } : { type: "paragraph" });
export const h2 = (title: string, requiredKey: string | null = null): JSONContent => ({
  type: "heading",
  attrs: { level: 2, requiredKey },
  content: [text(title)],
});
export const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

/** A disclosure with three required sections and a line of text in each. */
export const SECTIONS_DOC = doc(
  p("Intro"),
  h2("Offer details", "offer_details"),
  p("Offer body"),
  h2("Rates and fees", "rates_and_fees"),
  p("Rates body"),
  h2("Legal notices", "legal_notices"),
  p("Legal body"),
);

const mounted: Editor[] = [];

/** Destroys every editor made by `mountEditor` (call in afterEach). */
export function destroyEditors() {
  mounted.splice(0).forEach((editor) => editor.destroy());
}

/** A client editor (the document's extensions) attached to the page, so decorations and focus work. */
export function mountEditor(content: JSONContent = SECTIONS_DOC, options: { slashRender?: SlashRender; extensions?: Extensions } = {}): Editor {
  const host = document.createElement("div");
  const element = document.createElement("div");
  host.appendChild(element);
  document.body.appendChild(host);
  const editor = new Editor({
    element,
    extensions: options.extensions ?? editorExtensions({ store: createVariableStore([]), slashRender: options.slashRender ?? null }),
    content,
  });
  mounted.push(editor);
  return editor;
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Blocks as compact strings: "h2*:Title" for required headings, "p:text", "callout[p:a|p:b]"… */
export function blocks(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === "heading") out.push(`h${node.attrs.level}${node.attrs.requiredKey ? "*" : ""}:${node.textContent}`);
    else if (node.type.name === "paragraph") out.push(`p:${node.textContent}`);
    else {
      const inner: string[] = [];
      node.descendants((child) => {
        if (child.isTextblock) inner.push(`p:${child.textContent}`);
        return !child.isTextblock;
      });
      out.push(`${node.type.name}[${inner.join("|")}]`);
    }
  });
  // The trailing empty line TipTap keeps at the end isn't interesting.
  if (out.at(-1) === "p:" && out.length > 1) out.pop();
  return out;
}

/** Position before the top-level block at `index` (its content starts at +1). */
export function blockPos(editor: Editor, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
  return pos;
}

export function caret(editor: Editor, index: number, offset = 0) {
  const pos = blockPos(editor, index) + 1 + offset;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

export function select(editor: Editor, from: number, to: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
}

export function press(editor: Editor, key: string, mods: { shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean } = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) ?? false;
}

/** Text input the way ProseMirror delivers it: handlers first, else the default insert. */
export function type(editor: Editor, value: string) {
  const { view } = editor;
  const { from, to } = view.state.selection;
  const deflt = () => view.state.tr.insertText(value, from, to);
  if (!view.someProp("handleTextInput", (f) => f(view, from, to, value, deflt))) view.dispatch(deflt());
}

/** The required note's text, and the heading it shows on. */
export const note = (editor: Editor) => editor.view.dom.querySelector("[data-required-note]")?.getAttribute("data-required-note") ?? null;
export const noted = (editor: Editor) => editor.view.dom.querySelector("[data-required-note]")?.textContent ?? null;
