// @vitest-environment happy-dom
// Text flags on a channel field (extensions/text-flags.ts): the text a flagger reads, the decorations it
// draws, the popover that follows the caret, and the fix, which is one transaction undo puts back.

import type { Editor, JSONContent } from "@tiptap/core";
import { undo } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { inlineFieldExtensions } from "../schema";
import { createFlagPopoverStore } from "../state/flag-popover";
import { createVariableStore } from "../state/variable-store";
import { destroyEditors, mountEditor, text } from "../testing/editor";
import type { TextFlagger } from "../types";
import { REFRESH_FLAGS, applyFlagFix, fieldText, flagAt, flagsOf, textFlagsKey } from "./text-flags";

afterEach(destroyEditors);

const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const field = (...content: JSONContent[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content }] });

/** Flags every curly apostrophe, with ' as its fix, and every "bit.ly" with no fix. */
const flagger: TextFlagger = (value) => {
  const flags = [];
  for (const match of value.matchAll(/’/g)) flags.push({ from: match.index, to: match.index + 1, message: "’ isn't in the SMS character set.", replacement: "'" });
  for (const match of value.matchAll(/bit\.ly/g)) flags.push({ from: match.index, to: match.index + 6, message: "bit.ly is a public link shortener." });
  return flags;
};

function setup(content: JSONContent, flags: TextFlagger | null = flagger) {
  const store = createFlagPopoverStore();
  let current = flags;
  const editor = mountEditor(content, {
    extensions: inlineFieldExtensions(
      { store: createVariableStore([]), textFlags: { flagger: () => current, store } },
      "lines",
    ),
  }) as Editor;
  return { editor, store, setFlagger: (next: TextFlagger | null) => (current = next) };
}

const flagged = (editor: Editor) => [...editor.view.dom.querySelectorAll(".ucomp-flag")].map((el) => el.textContent);

describe("fieldText", () => {
  it("reads chips as a space and hard breaks as a line break, with each character's position", () => {
    const { editor } = setup(field(text("Hi "), chip("first_name"), text(", it’s"), { type: "hardBreak" }, text("ok")), null);
    const { text: value, starts } = fieldText(editor.state.doc);
    expect(value).toBe("Hi  , it’s\nok");
    // One paragraph: character i sits at position i + 1.
    expect(starts).toEqual([...value].map((_, i) => i + 1));
  });
});

describe("decorations", () => {
  it("underlines each flag where it sits, past chips and line breaks", () => {
    const { editor } = setup(field(chip("first_name"), text(" it’s at bit.ly/x"), { type: "hardBreak" }, text("don’t")));
    expect(flagged(editor)).toEqual(["’", "bit.ly", "’"]);
    const flags = flagsOf(editor.state);
    expect(editor.state.doc.textBetween(flags[0]!.from, flags[0]!.to)).toBe("’");
    expect(editor.state.doc.textBetween(flags[2]!.from, flags[2]!.to)).toBe("’");
  });

  it("follows typing: a new flag is drawn, a fixed one goes", () => {
    const { editor } = setup(field(text("Hello")));
    expect(flagged(editor)).toEqual([]);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, "’");
    expect(flagged(editor)).toEqual(["’"]);
    editor.commands.setContent(field(text("Hello")));
    expect(flagged(editor)).toEqual([]);
  });

  it("marks a flag on text that draws nothing, so it still shows", () => {
    const zeroWidth: TextFlagger = (value) => (value.includes("\u200B") ? [{ from: value.indexOf("\u200B"), to: value.indexOf("\u200B") + 1, message: "x", replacement: "" }] : []);
    const { editor } = setup(field(text("a\u200Bb")), zeroWidth);
    expect(editor.view.dom.querySelector(".ucomp-flag")?.hasAttribute("data-invisible")).toBe(true);
  });

  it("drops a flag outside the text", () => {
    const wild: TextFlagger = () => [{ from: 3, to: 99, message: "x" }, { from: -1, to: 1, message: "y" }, { from: 2, to: 2, message: "z" }];
    const { editor } = setup(field(text("abc")), wild);
    expect(flagsOf(editor.state)).toEqual([]);
  });

  it("flags again when the host's flagger changes", () => {
    const { editor, setFlagger } = setup(field(text("it’s")), null);
    expect(flagged(editor)).toEqual([]);
    setFlagger(flagger);
    editor.view.dispatch(editor.state.tr.setMeta(textFlagsKey, REFRESH_FLAGS));
    expect(flagged(editor)).toEqual(["’"]);
  });
});

describe("the fix", () => {
  it("Replace writes the replacement in one transaction, and undo puts the character back", () => {
    const { editor } = setup(field(text("it’s due")));
    expect(applyFlagFix(editor.view, 0)).toBe(true);
    expect(editor.state.doc.textContent).toBe("it's due");
    expect(flagged(editor)).toEqual([]);
    undo(editor.state, editor.view.dispatch);
    expect(editor.state.doc.textContent).toBe("it’s due");
    expect(flagged(editor)).toEqual(["’"]);
  });

  it("an empty replacement removes the text", () => {
    const remove: TextFlagger = (value) => (value.includes("\u200B") ? [{ from: value.indexOf("\u200B"), to: value.indexOf("\u200B") + 1, message: "x", replacement: "" }] : []);
    const { editor } = setup(field(text("pay\u200Bnow")), remove);
    expect(applyFlagFix(editor.view, 0)).toBe(true);
    expect(editor.state.doc.textContent).toBe("paynow");
  });

  it("does nothing for a flag without a fix, or in a read-only field", () => {
    const { editor } = setup(field(text("go to bit.ly/x, it’s")));
    expect(applyFlagFix(editor.view, 0)).toBe(false);
    expect(editor.state.doc.textContent).toBe("go to bit.ly/x, it’s");
    editor.setEditable(false);
    expect(applyFlagFix(editor.view, 1)).toBe(false);
  });
});

describe("the popover", () => {
  it("opens when the caret is moved onto a flag, and closes when it leaves", () => {
    const { editor, store } = setup(field(text("ab’cd")));
    editor.view.focus();
    const at = (pos: number) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
    at(1);
    expect(store.getState().index).toBeNull();
    at(4); // just after ’
    expect(store.getState().index).toBe(0);
    at(5);
    expect(store.getState().index).toBeNull();
  });

  it("says its sentence in a polite live region, since it never takes focus", () => {
    const { editor, store } = setup(field(text("ab’cd")));
    const live = editor.view.dom.parentElement?.querySelector('[role="status"][aria-live="polite"]');
    expect(live?.textContent).toBe("");
    store.getState().open(0);
    expect(live?.textContent).toBe("’ isn't in the SMS character set.");
    store.getState().close();
    expect(live?.textContent).toBe("");
  });

  it("closes on an edit, even one that leaves the caret on a flag", () => {
    const { editor, store } = setup(field(text("ab’cd")));
    editor.view.focus();
    store.getState().open(0);
    editor.view.dispatch(editor.state.tr.insertText("x", 1));
    expect(store.getState().index).toBeNull();
  });

  it("finds the flag at a position, preferring one the position is inside", () => {
    const flags = [
      { from: 1, to: 3, message: "a" },
      { from: 3, to: 6, message: "b" },
    ];
    expect(flagAt(flags, 2)).toBe(0);
    expect(flagAt(flags, 4)).toBe(1);
    expect(flagAt(flags, 3)).toBe(0);
    expect(flagAt(flags, 7)).toBeNull();
  });
});
