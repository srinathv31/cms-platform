// @vitest-environment happy-dom
// The section-merging paste, through the document editor's real paste path (clipboard events, the
// Markdown parser, the chip transform, the guard): pasted headings that match required sections merge
// into them, one undo step, still a paste for the field binding (chips create their variables).

import { Editor, type JSONContent } from "@tiptap/core";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import type { Variable } from "../model/types";
import { editorExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import { createEditorRootRuntime } from "../state/editor-root";
import { SECTIONS_DOC, blockPos, blocks, caret, doc, flush, h2, p, type } from "../testing/editor";

const KNOWN: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

function mount(content: JSONContent = SECTIONS_DOC) {
  const root = createEditorRootRuntime({ variables: KNOWN });
  root.registerField({ id: "body", label: "Document", kind: "body" });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: editorExtensions({
      store: root.variables,
      binding: { fieldId: "body", kind: "body", root, chip: createChipPopoverStore() },
    }),
    content,
  });
  editors.push(editor);
  return { editor, root };
}

function paste(editor: Editor, data: { text?: string; html?: string }) {
  const clipboard = new DataTransfer();
  if (data.text !== undefined) clipboard.setData("text/plain", data.text);
  if (data.html !== undefined) clipboard.setData("text/html", data.html);
  editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
}

const selectAll = (editor: Editor) => editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));

/** Strips block ids, so documents compare by content. */
function content(editor: Editor): JSONContent {
  const strip = (node: JSONContent): JSONContent => {
    const { attrs, content: children, ...rest } = node;
    const kept = attrs ? Object.fromEntries(Object.entries(attrs).filter(([name]) => name !== "id")) : undefined;
    return { ...rest, ...(kept && Object.keys(kept).length ? { attrs: kept } : {}), ...(children ? { content: children.map(strip) } : {}) };
  };
  return strip(editor.getJSON());
}

const ANSWER = [
  "## Offer details",
  "",
  "New offer for {{first_name}}.",
  "",
  "## Rates and fees",
  "",
  "- Late fee {{late_fee}}",
  "",
  "## Legal notices",
  "",
  "New legal.",
].join("\n");

describe("pasted headings that match required sections", () => {
  it("merge into the sections instead of duplicating them (blocks go to each section's end)", () => {
    const { editor } = mount();
    caret(editor, 0, "Intro".length);
    paste(editor, { text: ANSWER });
    expect(blocks(editor)).toEqual([
      "p:Intro",
      "h2*:Offer details",
      "p:Offer body",
      "p:New offer for .",
      "h2*:Rates and fees",
      "p:Rates body",
      "bulletList[p:Late fee ]",
      "h2*:Legal notices",
      "p:Legal body",
      "p:New legal.",
    ]);
  });

  it("is one undo step", () => {
    const { editor } = mount();
    const before = content(editor);
    caret(editor, 0, "Intro".length);
    paste(editor, { text: ANSWER });
    expect(content(editor)).not.toEqual(before);
    editor.commands.undo();
    expect(content(editor)).toEqual(before);
  });

  it("still counts as a paste: {{key}} becomes chips and unknown keys are created (and stay after undo)", async () => {
    const { editor, root } = mount();
    caret(editor, 0, "Intro".length);
    paste(editor, { text: ANSWER });
    await flush();
    const chips: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "variable") chips.push(node.attrs.key as string);
    });
    expect(chips).toEqual(["first_name", "late_fee"]);
    expect(root.variables.getState().byKey.get("late_fee")).toMatchObject({ type: "text", required: false });
    editor.commands.undo();
    await flush();
    expect(root.variables.getState().byKey.has("late_fee")).toBe(true);
  });

  it("blocks before the first match paste at the caret; the caret ends after the last pasted block", () => {
    const { editor } = mount();
    caret(editor, 0, "Intro".length);
    paste(editor, { text: "Lead line\n\n## Legal notices\n\nAppended." });
    expect(blocks(editor)).toEqual([
      "p:IntroLead line",
      "h2*:Offer details",
      "p:Offer body",
      "h2*:Rates and fees",
      "p:Rates body",
      "h2*:Legal notices",
      "p:Legal body",
      "p:Appended.",
    ]);
    const { $from } = editor.state.selection;
    expect($from.parent.textContent).toBe("Appended.");
    expect($from.parentOffset).toBe("Appended.".length);
  });

  it("a section holding only empty lines is replaced; trailing empty lines stay after the content", () => {
    const { editor } = mount(doc(h2("Offer details", "offer_details"), p(), p(), h2("Rates and fees", "rates_and_fees"), p("Rates"), p(), h2("Legal notices", "legal_notices")));
    caret(editor, 1);
    paste(editor, { text: "## Offer details\n\nOffer.\n\n## Rates and fees\n\nMore rates." });
    expect(blocks(editor)).toEqual([
      "h2*:Offer details",
      "p:Offer.",
      "h2*:Rates and fees",
      "p:Rates",
      "p:More rates.",
      "p:",
      "h2*:Legal notices",
    ]);
  });

  it("headings that match nothing stay ordinary headings, in the section they came with", () => {
    const { editor } = mount();
    caret(editor, 0, "Intro".length);
    paste(editor, { text: "## Rates and fees\n\n### How interest works\n\nDaily.\n\n## Something else\n\nOther." });
    expect(blocks(editor).slice(3)).toEqual([
      "h2*:Rates and fees",
      "p:Rates body",
      "h3:How interest works",
      "p:Daily.",
      "h2:Something else",
      "p:Other.",
      "h2*:Legal notices",
      "p:Legal body",
    ]);
  });

  it("matching ignores case, spacing, numbering and a trailing colon", () => {
    const { editor } = mount();
    caret(editor, 0, "Intro".length);
    paste(editor, { text: "# 2.  RATES and fees:\n\nCase-insensitive." });
    expect(blocks(editor).filter((block) => block.startsWith("h"))).toEqual(["h2*:Offer details", "h2*:Rates and fees", "h2*:Legal notices"]);
    expect(blocks(editor)[5]).toBe("p:Case-insensitive.");
  });

  it("select-all + paste replaces the draft section by section", () => {
    const { editor } = mount(doc(h2("Offer details", "offer_details"), p("Old offer"), h2("Rates and fees", "rates_and_fees"), p("Old rates"), h2("Legal notices", "legal_notices"), p("Old legal")));
    selectAll(editor);
    paste(editor, { text: ANSWER });
    expect(blocks(editor)).toEqual([
      "h2*:Offer details",
      "p:New offer for .",
      "h2*:Rates and fees",
      "bulletList[p:Late fee ]",
      "h2*:Legal notices",
      "p:New legal.",
    ]);
    editor.commands.undo();
    expect(blocks(editor)).toEqual(["h2*:Offer details", "p:Old offer", "h2*:Rates and fees", "p:Old rates", "h2*:Legal notices", "p:Old legal"]);
  });

  it("select-all + paste: blocks before the first section go to the top", () => {
    const { editor } = mount(doc(h2("Offer details", "offer_details"), p("Old offer"), h2("Rates and fees", "rates_and_fees"), p("Old rates"), h2("Legal notices", "legal_notices"), p("Old legal")));
    selectAll(editor);
    paste(editor, { text: "Lead.\n\n## Legal notices\n\nNew legal." });
    expect(blocks(editor)).toEqual(["p:Lead.", "h2*:Offer details", "p:", "h2*:Rates and fees", "h2*:Legal notices", "p:New legal."]);
  });

  it("right after typing, the paste is still its own undo step", () => {
    const { editor } = mount();
    caret(editor, 2, "Offer body".length);
    type(editor, " typed");
    paste(editor, { text: ANSWER });
    editor.commands.undo();
    expect(blocks(editor)[2]).toBe("p:Offer body typed");
    expect(blocks(editor)).toHaveLength(7);
  });

  it("with the caret in a required heading, the blocks before the first match go right below it", () => {
    const { editor } = mount();
    caret(editor, 1, 3);
    paste(editor, { text: "Lead\n\n## Legal notices\n\nAppended." });
    expect(blocks(editor).slice(0, 4)).toEqual(["p:Intro", "h2*:Offer details", "p:Lead", "p:Offer body"]);
    expect(blocks(editor).at(-1)).toBe("p:Appended.");
  });

  it("works for pasted HTML too (a rendered answer copied from the browser)", () => {
    const { editor } = mount();
    caret(editor, 0, "Intro".length);
    paste(editor, { html: "<h2>Offer details</h2><p>From <b>HTML</b> {{first_name}}</p>", text: "Offer details\nFrom HTML" });
    expect(blocks(editor).slice(1, 4)).toEqual(["h2*:Offer details", "p:Offer body", "p:From HTML "]);
  });

  it("a copy of a required heading (copied in the editor, it carries its key) pastes as a plain heading, as before", () => {
    const { editor } = mount();
    caret(editor, 6, "Legal body".length);
    // What copying from a ProseMirror editor puts on the clipboard (data-pm-slice: open start and end, no context).
    paste(editor, { html: '<p data-pm-slice="1 1 []">Copied</p><h2 data-required="legal_notices">Legal notices</h2><p>More</p>' });
    expect(blocks(editor).slice(5)).toEqual(["h2*:Legal notices", "p:Legal bodyCopied", "h2:Legal notices", "p:More"]);
  });

  it("a paste without a matching heading is the ordinary paste", () => {
    const { editor } = mount(doc(p("Intro"), p(), h2("Offer details", "offer_details"), p("Offer body")));
    caret(editor, 1);
    paste(editor, { text: "## Not a section\n\nText" });
    expect(blocks(editor)).toEqual(["p:Intro", "h2:Not a section", "p:Text", "h2*:Offer details", "p:Offer body"]);
  });

  it("a document without required sections pastes headings as headings", () => {
    const { editor } = mount(doc(p("Hello"), p()));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, blockPos(editor, 1) + 1)));
    paste(editor, { text: "## Offer details\n\nText" });
    expect(blocks(editor)).toEqual(["p:Hello", "h2:Offer details", "p:Text"]);
  });
});
