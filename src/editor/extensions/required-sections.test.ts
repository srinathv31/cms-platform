// @vitest-environment happy-dom
// The required-section guard (extensions/required-sections.ts) on a headless client editor.

import type { JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import {
  SECTIONS_DOC,
  blockPos,
  blocks,
  caret,
  destroyEditors,
  flush,
  h2,
  mountEditor,
  note,
  noted,
  p,
  press,
  select,
  type,
} from "../testing/editor";

afterEach(destroyEditors);

const mount = (content: JSONContent = SECTIONS_DOC) => mountEditor(content);

describe("required-section guard: edits that only damage a heading are rejected", () => {
  it("typing inside a required heading", async () => {
    const editor = mount();
    caret(editor, 1, 5);
    type(editor, "x");
    expect(blocks(editor)[1]).toBe("h2*:Offer details");
    expect(note(editor)).toBe("Required for disclosures");
  });

  it("any transaction that renames one (an insert from code, a chip)", async () => {
    const editor = mount();
    editor.commands.insertContentAt(blockPos(editor, 5) + 2, "Not ");
    expect(blocks(editor)[5]).toBe("h2*:Legal notices");
    await flush();
    expect(noted(editor)).toBe("Legal notices");
  });

  it("selecting the heading's text and pressing Backspace", () => {
    const editor = mount();
    const start = blockPos(editor, 5) + 1;
    select(editor, start, start + "Legal notices".length);
    expect(press(editor, "Backspace")).toBe(true);
    expect(blocks(editor)[5]).toBe("h2*:Legal notices");
    expect(noted(editor)).toBe("Legal notices");
  });

  it("selecting the heading block and pressing Delete", () => {
    const editor = mount();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, blockPos(editor, 5))));
    expect(press(editor, "Delete")).toBe(true);
    expect(blocks(editor)).toEqual(blocks(mount()));
    expect(noted(editor)).toBe("Legal notices");
  });

  it("Backspace at the start of the block below would join it into the heading", async () => {
    const editor = mount();
    caret(editor, 6);
    press(editor, "Backspace");
    expect(blocks(editor).slice(5)).toEqual(["h2*:Legal notices", "p:Legal body"]);
    await flush();
    expect(noted(editor)).toBe("Legal notices");
  });

  it("Backspace at the start of an empty line below just removes that line", () => {
    const editor = mount({ type: "doc", content: [h2("Offer details", "offer_details"), p(), p("Body")] });
    caret(editor, 1);
    press(editor, "Backspace");
    expect(blocks(editor)).toEqual(["h2*:Offer details", "p:Body"]);
  });

  it("Delete at the end of the heading would pull the next line in", async () => {
    const editor = mount();
    caret(editor, 5, "Legal notices".length);
    press(editor, "Delete");
    expect(blocks(editor).slice(5)).toEqual(["h2*:Legal notices", "p:Legal body"]);
  });

  it("Backspace at the heading's start removes an empty line above, and nothing else", () => {
    const editor = mount({ type: "doc", content: [p("Intro"), p(), h2("Offer details", "offer_details")] });
    caret(editor, 2);
    press(editor, "Backspace");
    expect(blocks(editor)).toEqual(["p:Intro", "h2*:Offer details"]);
    press(editor, "Backspace");
    expect(blocks(editor)).toEqual(["p:Intro", "h2*:Offer details"]);
    expect(noted(editor)).toBe("Offer details");
  });

  it("Enter: at the start adds a line above (caret in it), in the middle is refused, at the end adds one below", () => {
    const editor = mount();
    caret(editor, 3);
    press(editor, "Enter");
    expect(blocks(editor).slice(3, 5)).toEqual(["p:", "h2*:Rates and fees"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");

    caret(editor, 4, 5);
    press(editor, "Enter");
    expect(blocks(editor)[4]).toBe("h2*:Rates and fees");
    expect(noted(editor)).toBe("Rates and fees");

    caret(editor, 4, "Rates and fees".length);
    press(editor, "Enter");
    expect(blocks(editor).slice(4, 6)).toEqual(["h2*:Rates and fees", "p:"]);
  });

  it("retyping: paragraph, another level, a list", () => {
    const editor = mount();
    caret(editor, 3, 2);
    editor.commands.setParagraph();
    editor.commands.setHeading({ level: 3 });
    editor.commands.toggleBulletList();
    expect(blocks(editor)).toEqual(blocks(mount()));
  });

  it("formatting: bold, italic, underline, link", async () => {
    const editor = mount();
    const start = blockPos(editor, 3) + 1;
    select(editor, start, start + 5);
    editor.commands.toggleBold();
    editor.commands.toggleItalic();
    editor.commands.toggleUnderline();
    editor.commands.setLink({ href: "https://example.com" });
    expect(editor.state.doc.child(3).toJSON()).toEqual(mount().state.doc.child(3).toJSON());
    await flush();
    expect(noted(editor)).toBe("Rates and fees");
  });

  it("reordering or moving a heading away", () => {
    const editor = mount();
    const offer = editor.state.doc.child(1);
    const tr = editor.state.tr.delete(blockPos(editor, 1), blockPos(editor, 2));
    tr.insert(tr.doc.content.size, offer);
    editor.view.dispatch(tr);
    expect(blocks(editor)).toEqual(blocks(mount()));
  });

  it("a copy of a required heading pastes as a plain heading", () => {
    const editor = mount();
    caret(editor, 6, "Legal body".length);
    editor.view.pasteHTML('<p>Copied</p><h2 data-required="legal_notices">Legal notices</h2><p>More</p>');
    const out = blocks(editor);
    expect(out.filter((b) => b === "h2*:Legal notices")).toHaveLength(1);
    expect(out).toContain("h2:Legal notices");
    expect(out.indexOf("h2*:Legal notices")).toBeLessThan(out.indexOf("h2:Legal notices"));
  });
});

describe("required-section guard: range operations keep the headings and apply to the rest", () => {
  it("select-all + Delete leaves the bare sections, caret in the first", () => {
    const editor = mount();
    editor.commands.selectAll();
    press(editor, "Backspace");
    expect(blocks(editor)).toEqual(["p:", "h2*:Offer details", "h2*:Rates and fees", "h2*:Legal notices"]);
    expect(editor.state.selection.from).toBe(1);
    expect(noted(editor)).toBe("Offer details");
    editor.commands.undo();
    expect(blocks(editor)).toEqual(blocks(mount()));
  });

  it("select-all on a document that starts with a section puts the caret in its body", () => {
    const editor = mount({ type: "doc", content: [h2("Offer details", "offer_details"), p("A"), h2("Legal notices", "legal_notices"), p("B")] });
    editor.commands.selectAll();
    press(editor, "Delete");
    expect(blocks(editor)).toEqual(["h2*:Offer details", "p:", "h2*:Legal notices"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.from).toBe(blockPos(editor, 1) + 1);
  });

  it("select-all + typing replaces everything but the headings", () => {
    const editor = mount();
    editor.commands.selectAll();
    type(editor, "x");
    expect(blocks(editor)).toEqual(["p:x", "h2*:Offer details", "h2*:Rates and fees", "h2*:Legal notices"]);
  });

  it("a selection across one heading deletes the text on both sides", () => {
    const editor = mount();
    select(editor, blockPos(editor, 2) + 1 + 5, blockPos(editor, 4) + 1 + 5);
    press(editor, "Delete");
    expect(blocks(editor).slice(1, 5)).toEqual(["h2*:Offer details", "p:Offer", "h2*:Rates and fees", "p: body"]);
  });

  it("cut copies everything selected and keeps the heading", () => {
    const editor = mount();
    select(editor, blockPos(editor, 2) + 1, blockPos(editor, 4) + 1 + "Rates body".length);
    const data = new Map<string, string>();
    const event = {
      clipboardData: { clearData: () => data.clear(), setData: (t: string, v: string) => data.set(t, v) },
      preventDefault: () => {},
    } as unknown as ClipboardEvent;
    const handled = editor.view.someProp("handleDOMEvents", (handlers) => handlers.cut?.(editor.view, event));
    expect(handled).toBe(true);
    expect(data.get("text/plain")).toContain("Rates and fees");
    // The fully selected paragraph after the heading goes with its text.
    expect(blocks(editor).slice(1, 5)).toEqual(["h2*:Offer details", "p:", "h2*:Rates and fees", "h2*:Legal notices"]);
  });

  it("paste over a selection across a heading inserts the paste and keeps the heading", () => {
    const editor = mount();
    select(editor, blockPos(editor, 2) + 1, blockPos(editor, 4) + 1 + "Rates body".length);
    editor.view.pasteText("Pasted");
    expect(blocks(editor).slice(1, 5)).toEqual(["h2*:Offer details", "p:Pasted", "h2*:Rates and fees", "h2*:Legal notices"]);
  });

  it("paste into a heading is refused", () => {
    const editor = mount();
    caret(editor, 1, 3);
    editor.view.pasteText("Pasted");
    expect(blocks(editor)[1]).toBe("h2*:Offer details");
    expect(noted(editor)).toBe("Offer details");
  });
});

describe("the note", () => {
  it("is one note at a time, announced politely, gone after about two seconds", async () => {
    const editor = mount();
    caret(editor, 1, 2);
    type(editor, "x");
    caret(editor, 3, 2);
    type(editor, "x");
    expect(editor.view.dom.querySelectorAll("[data-required-note]")).toHaveLength(1);
    expect(noted(editor)).toBe("Rates and fees");
    const live = editor.view.dom.parentElement?.querySelector('[role="status"][aria-live="polite"]');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(live?.textContent).toBe("Required for disclosures");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(note(editor)).toBeNull();
  }, 5000);
});
