// @vitest-environment happy-dom
// The root runtime driving real (headless) editors: every insertion path is one document
// transaction that undo/redo covers, chips stay whole, and list changes reach the chips.

import { Editor, type JSONContent } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { SuggestionProps } from "@tiptap/suggestion";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VARIABLE_DRAG_TYPE } from "../extensions/field-binding";
import type { PickerItem, VariablePickerRender } from "../extensions/variable-picker";
import type { Variable } from "../model/types";
import { editorExtensions } from "../schema";
import { createChipPopoverStore } from "./chip-popover";
import { createEditorRootRuntime, type EditorRootRuntime } from "./editor-root";

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
];

const text = (value: string): JSONContent => ({ type: "text", text: value });
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });

const DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [text("Intro")] },
    { type: "heading", attrs: { level: 2, requiredKey: "offer_details" }, content: [text("Offer details")] },
    { type: "paragraph", content: [text("Hi "), chip("first_name"), text(", your APR is "), chip("purchase_apr"), text(".")] },
    { type: "heading", attrs: { level: 2, requiredKey: "legal_notices" }, content: [text("Legal notices")] },
    { type: "paragraph", content: [text("Thanks "), chip("first_name")] },
  ],
};

interface Setup {
  root: EditorRootRuntime;
  editor: Editor;
  picker: { props: SuggestionProps<PickerItem, PickerItem> | null };
}

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

function setup(content: JSONContent = DOC, variables = VARIABLES): Setup {
  const root = createEditorRootRuntime({ variables });
  root.registerField({ id: "body", label: "Document", kind: "body" }, content);
  const picker: Setup["picker"] = { props: null };
  const pickerRender: VariablePickerRender = () => ({
    onStart: (props) => void (picker.props = props),
    onUpdate: (props) => void (picker.props = props),
    onExit: () => void (picker.props = null),
  });
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions({
      store: root.variables,
      pickerRender,
      binding: { fieldId: "body", kind: "body", root, chip: createChipPopoverStore() },
    }),
    content,
  });
  editors.push(editor);
  return { root, editor, picker };
}

/** Inline content of the top-level block at `index` as compact tokens: text, or {{key}} for chips. */
function line(editor: Editor, index: number): string {
  let out = "";
  editor.state.doc.child(index).forEach((node) => {
    out += node.isText ? node.text : `{{${node.attrs.key}}}`;
  });
  return out;
}

function chipKeys(editor: Editor): string[] {
  const keys: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "variable") keys.push(node.attrs.key);
  });
  return keys;
}

/** Position right after the text `needle` in the top-level block at `index`. */
function after(editor: Editor, index: number, needle: string): number {
  let start = 1;
  for (let i = 0; i < index; i++) start += editor.state.doc.child(i).nodeSize;
  let found = -1;
  editor.state.doc.child(index).forEach((node, offset) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = start + offset + node.text!.indexOf(needle) + needle.length;
  });
  if (found < 0) throw new Error(`"${needle}" not found`);
  return found;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("usage through the root", () => {
  it("is seeded from JSON and kept current from the live document", () => {
    const { root, editor } = setup();
    expect(root.usage.getState().byKey.get("first_name")).toEqual({
      key: "first_name",
      count: 2,
      places: [
        { field: "Document", section: "Offer details", count: 1 },
        { field: "Document", section: "Legal notices", count: 1 },
      ],
    });
    const apr = root.usage.getState().byKey.get("purchase_apr");
    editor.commands.insertContentAt(after(editor, 0, "Intro"), [text(" "), chip("first_name")]);
    root.flushUsage();
    expect(root.usage.getState().byKey.get("first_name")?.count).toBe(3);
    expect(root.usage.getState().byKey.get("first_name")?.places[0]).toEqual({ field: "Document", section: null, count: 1 });
    // A row whose numbers didn't change keeps its object (its subscribers don't re-render).
    expect(root.usage.getState().byKey.get("purchase_apr")).toBe(apr);
  });
});

describe("chip insertion", () => {
  it("click-to-insert goes to the first required section before any field had focus", () => {
    const { root, editor } = setup();
    expect(root.insertVariable("purchase_apr")).toBe(true);
    expect(line(editor, 2)).toBe("{{purchase_apr}} Hi {{first_name}}, your APR is {{purchase_apr}}.");
    editor.commands.undo();
    expect(line(editor, 2)).toBe("Hi {{first_name}}, your APR is {{purchase_apr}}.");
    editor.commands.redo();
    expect(line(editor, 2)).toBe("{{purchase_apr}} Hi {{first_name}}, your APR is {{purchase_apr}}.");
  });

  it("adds a body line under a required heading that has none, in the same undo step", () => {
    const blank: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, requiredKey: "offer_details" }, content: [text("Offer details")] },
        { type: "heading", attrs: { level: 2, requiredKey: "legal_notices" }, content: [text("Legal notices")] },
      ],
    };
    const { root, editor } = setup(blank);
    root.insertVariable("first_name");
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    expect(line(editor, 1)).toBe("{{first_name}}");
    editor.commands.undo();
    // The heading's new line went with the chip (the editor's trailing line may stay).
    expect(editor.state.doc.child(1).textContent).toBe("Legal notices");
  });

  it("click-to-insert goes to the last caret of the last-focused field, with smart spaces", () => {
    const { root, editor } = setup();
    root.noteFocus("body");
    editor.commands.setTextSelection(after(editor, 0, "Intro"));
    root.insertVariable("first_name");
    expect(line(editor, 0)).toBe("Intro {{first_name}}");
    // Caret sits right after the chip.
    expect(editor.state.selection.from).toBe(after(editor, 0, "Intro") + 2);
    editor.commands.undo();
    expect(line(editor, 0)).toBe("Intro");
  });

  it("keeps each insertion its own undo step, even right after typing", () => {
    const { root, editor } = setup();
    root.noteFocus("body");
    editor.commands.setTextSelection(after(editor, 0, "Intro"));
    editor.commands.insertContent(" text");
    root.insertVariable("first_name");
    editor.commands.undo();
    expect(line(editor, 0)).toBe("Intro text");
  });

  it("spaces a chip only where it would touch a word, never before punctuation or at a line end", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [text("Hi, Maya.")] }],
    };
    const { root, editor } = setup(doc);
    root.noteFocus("body");
    const insertAt = (pos: number, key = "first_name") => {
      editor.commands.setTextSelection(pos);
      root.insertVariable(key);
    };
    insertAt(1 + "Hi, Maya".length); // before "."
    expect(line(editor, 0)).toBe("Hi, Maya {{first_name}}.");
    editor.commands.undo();
    insertAt(1 + "Hi,".length); // after "," before " "
    expect(line(editor, 0)).toBe("Hi,{{first_name}} Maya.");
    editor.commands.undo();
    insertAt(1 + "Hi, Ma".length); // inside a word
    expect(line(editor, 0)).toBe("Hi, Ma {{first_name}} ya.");
    // The caret sits right after the chip, before its trailing space.
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.from + 3)).toBe(" ya");
    editor.commands.undo();
    insertAt(1 + "Hi, Maya.".length); // line end
    expect(line(editor, 0)).toBe("Hi, Maya.{{first_name}}");
  });

  it("a selected chip stays; the new one goes after it", () => {
    const { root, editor } = setup();
    root.noteFocus("body");
    const pos = after(editor, 2, "Hi ");
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    root.insertVariable("purchase_apr");
    expect(line(editor, 2)).toBe("Hi {{first_name}} {{purchase_apr}}, your APR is {{purchase_apr}}.");
  });

  it("drop: a panel row's key lands where it's dropped, as one undo step", () => {
    const { editor } = setup();
    const at = after(editor, 0, "Intro");
    editor.view.posAtCoords = () => ({ pos: at, inside: -1 });
    const event = {
      clientX: 0,
      clientY: 0,
      dataTransfer: { getData: (type: string) => (type === VARIABLE_DRAG_TYPE ? "purchase_apr" : "") },
    } as unknown as DragEvent;
    const handled = editor.view.someProp("handleDrop", (f) => f(editor.view, event, Slice.empty, false));
    expect(handled).toBe(true);
    expect(line(editor, 0)).toBe("Intro {{purchase_apr}}");
    editor.commands.undo();
    expect(line(editor, 0)).toBe("Intro");
    editor.commands.redo();
    expect(line(editor, 0)).toBe("Intro {{purchase_apr}}");
  });

  it("drop ignores other drags (block moves, files)", () => {
    const { editor } = setup();
    const event = { dataTransfer: { getData: () => "" } } as unknown as DragEvent;
    const handled = editor.view.someProp("handleDrop", (f) => f(editor.view, event, Slice.empty, false));
    expect(handled).toBeFalsy();
  });

  it("{{ opens the picker; picking a variable replaces the trigger text", async () => {
    const { editor, picker } = setup();
    editor.commands.setTextSelection(after(editor, 0, "Intro"));
    editor.commands.insertContent(" {{pur");
    await flush();
    expect(picker.props?.query).toBe("pur");
    const items = picker.props!.items;
    expect(items.map((i) => (i.kind === "variable" ? i.variable.key : `create:${i.label}`))).toEqual(["purchase_apr", "create:pur"]);
    picker.props!.command(items[0]);
    expect(line(editor, 0)).toBe("Intro {{purchase_apr}}");
    await flush();
    expect(picker.props).toBeNull();
    editor.commands.undo();
    expect(line(editor, 0)).toBe("Intro {{pur");
  });

  it("undo brings the raw {{query back without reopening the picker; typing reopens it", async () => {
    const { editor, picker } = setup();
    editor.commands.setTextSelection(after(editor, 0, "Intro"));
    editor.commands.insertContent(" {{pur");
    await flush();
    picker.props!.command(picker.props!.items[0]);
    await flush();
    editor.commands.undo();
    await flush();
    expect(line(editor, 0)).toBe("Intro {{pur");
    expect(picker.props).toBeNull();
    // Moving the caret inside it doesn't open it either.
    editor.commands.setTextSelection(editor.state.selection.from - 1);
    await flush();
    expect(picker.props).toBeNull();
    editor.commands.setTextSelection(editor.state.selection.from + 1);
    editor.commands.insertContent("c");
    await flush();
    expect(picker.props?.query).toBe("purc");
  });

  it("{{ with spaces → Create: the new variable's chip replaces the trigger text", async () => {
    const { root, editor, picker } = setup();
    editor.commands.setTextSelection(after(editor, 0, "Intro"));
    editor.commands.insertContent(" {{Offer end date");
    await flush();
    expect(picker.props?.query).toBe("Offer end date");
    expect(picker.props?.items).toEqual([{ kind: "create", label: "Offer end date" }]);

    const variable: Variable = { key: "offer_end_date", label: "Offer end date", type: "date", required: true, sample: "" };
    expect(root.createVariable(variable)).toEqual({ ok: true });
    picker.props!.command({ kind: "variable", variable });
    expect(line(editor, 0)).toBe("Intro {{offer_end_date}}");
    expect(root.variables.getState().byKey.get("offer_end_date")).toEqual(variable);
  });

  it("typing {{key}} in full makes a chip for a known key only", () => {
    const { editor } = setup();
    const at = after(editor, 0, "Intro");
    editor.commands.setTextSelection(at);
    // Input rules run on text input; simulate the last keystroke.
    editor.commands.insertContent(" {{first_name}");
    editor.view.someProp("handleTextInput", (f) => f(editor.view, editor.state.selection.from, editor.state.selection.from, "}", () => editor.state.tr.insertText("}")));
    expect(line(editor, 0)).toBe("Intro {{first_name}}");
    expect(chipKeys(editor).filter((k) => k === "first_name")).toHaveLength(3);
  });
});

describe("chips stay whole", () => {
  it("Backspace right after a chip removes the whole chip, trigger and all", () => {
    const { editor } = setup();
    const end = after(editor, 2, "Hi ") + 1;
    editor.commands.setTextSelection(end);
    editor.commands.keyboardShortcut("Backspace");
    expect(line(editor, 2)).toBe("Hi , your APR is {{purchase_apr}}.");
    editor.commands.undo();
    expect(line(editor, 2)).toBe("Hi {{first_name}}, your APR is {{purchase_apr}}.");
  });

  it("Delete right before a chip removes the whole chip", () => {
    const { editor } = setup();
    editor.commands.setTextSelection(after(editor, 2, "APR is "));
    editor.commands.keyboardShortcut("Delete");
    expect(line(editor, 2)).toBe("Hi {{first_name}}, your APR is .");
  });

  it("a selected chip goes with Backspace", () => {
    const { editor } = setup();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, after(editor, 2, "Hi "))));
    editor.commands.keyboardShortcut("Backspace");
    expect(line(editor, 2)).toBe("Hi , your APR is {{purchase_apr}}.");
  });
});

describe("list changes reach the chips", () => {
  it("a key change re-points every chip, outside undo history", () => {
    const { root, editor } = setup();
    expect(root.updateVariable("first_name", { key: "given_name" })).toEqual({ ok: true });
    expect(chipKeys(editor)).toEqual(["given_name", "purchase_apr", "given_name"]);
    editor.commands.undo();
    expect(chipKeys(editor)).toEqual(["given_name", "purchase_apr", "given_name"]);
  });

  it("a chip that comes back with an old key lands on the renamed variable", () => {
    const { root, editor } = setup();
    // Remove one chip, rename the variable, then undo the removal.
    editor.commands.setTextSelection(after(editor, 2, "Hi ") + 1);
    editor.commands.keyboardShortcut("Backspace");
    root.updateVariable("first_name", { key: "given_name" });
    editor.commands.undo();
    expect(chipKeys(editor)).toEqual(["given_name", "purchase_apr", "given_name"]);
  });

  it("deleting with 'remove chips' is one undo step that also brings the variable back", async () => {
    const { root, editor } = setup();
    const changes = vi.fn();
    root.setListener(changes);
    root.deleteVariable("first_name", { removeChips: true });
    expect(chipKeys(editor)).toEqual(["purchase_apr"]);
    expect(line(editor, 4)).toBe("Thanks");
    expect(root.variables.getState().byKey.has("first_name")).toBe(false);
    expect(changes).toHaveBeenLastCalledWith([VARIABLES[1]]);

    editor.commands.undo();
    expect(chipKeys(editor)).toEqual(["first_name", "purchase_apr", "first_name"]);
    await flush();
    expect(root.variables.getState().variables.map((v) => v.key)).toEqual(["first_name", "purchase_apr"]);
    expect(changes).toHaveBeenLastCalledWith(VARIABLES);
  });

  it("deleting with 'keep chips' leaves them as unknown chips", () => {
    const { root, editor } = setup();
    root.deleteVariable("first_name");
    expect(chipKeys(editor)).toEqual(["first_name", "purchase_apr", "first_name"]);
    expect(root.variables.getState().byKey.has("first_name")).toBe(false);
  });

  it("label edits don't touch the document", () => {
    const { root, editor } = setup();
    const doc = editor.state.doc;
    root.updateVariable("first_name", { label: "Given name" });
    expect(editor.state.doc).toBe(doc);
  });
});

describe("read-only and selection details", () => {
  it("never inserts in a read-only root", () => {
    const { root, editor } = setup();
    root.config.setState({ readOnly: true });
    editor.setEditable(false);
    expect(root.insertVariable("first_name")).toBe(false);
  });

  it("replaces a text selection inside one line, like typing", () => {
    const { root, editor } = setup();
    root.noteFocus("body");
    const end = after(editor, 0, "Intro");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end - 5, end)));
    root.insertVariable("first_name");
    expect(line(editor, 0)).toBe("{{first_name}}");
  });
});
