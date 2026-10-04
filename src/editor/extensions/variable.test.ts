// @vitest-environment happy-dom
// The `variable` node (extensions/variable.ts) on its own: what it serializes to, the keys that
// remove it whole, `{{key}}` typed in full, and insertVariable between blocks. Insertion through
// the root (click, drop, `{{` picker) is covered in state/editor-root.test.ts.

import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import type { Variable } from "../model/types";
import { baseExtensions, editorExtensions } from "../schema";
import { createVariableStore } from "../state/variable-store";
import { blocks, destroyEditors, doc, mountEditor, p, press, text } from "../testing/editor";

const VARIABLES: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });

const servers: Editor[] = [];
afterEach(() => {
  destroyEditors();
  servers.splice(0).forEach((e) => e.destroy());
});

const client = (content: JSONContent) =>
  mountEditor(content, { extensions: editorExtensions({ store: createVariableStore(VARIABLES) }) });

const line = (editor: Editor) => {
  let out = "";
  editor.state.doc.child(0).forEach((node) => {
    out += node.isText ? node.text : `{{${node.attrs.key}}}`;
  });
  return out;
};

describe("variable node", () => {
  it("serializes to <span data-variable> with the label, {{key}} as text, and only a key in JSON", () => {
    const editor = new Editor({ element: document.createElement("div"), extensions: baseExtensions({ variables: VARIABLES }), content: doc({ type: "paragraph", content: [text("Hi "), chip("first_name"), chip("promo")] }) });
    servers.push(editor);
    expect(editor.getHTML()).toContain('<span data-variable="first_name">First name</span><span data-variable="promo">promo</span>');
    expect(editor.getText()).toBe("Hi {{first_name}}{{promo}}");
    expect(editor.getJSON().content?.[0].content?.[1]).toEqual({ type: "variable", attrs: { key: "first_name" } });
  });

  it("Delete right before a chip removes it whole", () => {
    const editor = client(doc({ type: "paragraph", content: [text("Hi "), chip("first_name"), text("!")] }));
    editor.commands.setTextSelection(4);
    press(editor, "Delete");
    expect(line(editor)).toBe("Hi !");
  });

  it("a selected chip goes with Delete or Backspace", () => {
    const editor = client(doc({ type: "paragraph", content: [text("Hi "), chip("first_name"), text("!")] }));
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 4)));
    press(editor, "Delete");
    expect(line(editor)).toBe("Hi !");
  });

  it("typing {{key}} in full makes a chip for a known key; an unknown one stays text", () => {
    const editor = client(doc(p("Hi ")));
    const typeChar = (char: string) => {
      const { from } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, from, char, () => editor.state.tr.insertText(char, from)));
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from));
    };
    editor.commands.setTextSelection(4);
    for (const char of "{{first_name}}") typeChar(char);
    expect(line(editor)).toBe("Hi {{first_name}}");
    for (const char of " {{nope}}") typeChar(char);
    expect(editor.state.doc.textContent).toBe("Hi  {{nope}}");
  });

  it("insertVariable between blocks gives the chip its own line", () => {
    const editor = client(doc({ type: "horizontalRule" }, p("After")));
    editor.chain().insertVariable("first_name", { from: 0, to: 0 }).run();
    expect(blocks(editor)).toEqual(["p:", "horizontalRule[]", "p:After"]);
    expect(editor.state.doc.child(0).firstChild?.type.name).toBe("variable");
  });
});
