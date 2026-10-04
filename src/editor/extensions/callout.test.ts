// @vitest-environment happy-dom
// Callout keys (extensions/callout.ts): leaving and unwrapping like a list item.

import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  SECTIONS_DOC,
  blockPos,
  blocks,
  caret,
  destroyEditors,
  mountEditor,
  p,
  press,
} from "../testing/editor";

afterEach(destroyEditors);

const mount = (content: JSONContent = SECTIONS_DOC) => mountEditor(content);

describe("callout keys", () => {
  const callout = (...lines: string[]): JSONContent => ({ type: "callout", content: lines.map((line) => p(line)) });

  it("Enter on an empty last line leaves the callout", () => {
    const editor = mount({ type: "doc", content: [callout("Note"), p("After")] });
    editor.commands.setTextSelection(1 + 1 + "Note".length);
    press(editor, "Enter");
    expect(blocks(editor)).toEqual(["callout[p:Note|p:]", "p:After"]);
    press(editor, "Enter");
    expect(blocks(editor)).toEqual(["callout[p:Note]", "p:", "p:After"]);
    expect(editor.state.selection.$from.depth).toBe(1);
  });

  it("Backspace at the start of an empty callout unwraps it", () => {
    const editor = mount({ type: "doc", content: [p("Before"), callout(""), p("After")] });
    caret(editor, 1);
    editor.commands.setTextSelection(blockPos(editor, 1) + 2);
    press(editor, "Backspace");
    expect(blocks(editor)).toEqual(["p:Before", "p:", "p:After"]);
  });

  it("Backspace at the start of its first line lifts that line out", () => {
    const editor = mount({ type: "doc", content: [p("Before"), callout("One", "Two")] });
    editor.commands.setTextSelection(blockPos(editor, 1) + 2);
    press(editor, "Backspace");
    expect(blocks(editor)).toEqual(["p:Before", "p:One", "callout[p:Two]"]);
  });
});
