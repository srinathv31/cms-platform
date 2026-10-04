// @vitest-environment happy-dom
// TableKit keys as configured in schema.ts: Tab / Shift+Tab across cells, Tab in the last cell adds a row.

import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  SECTIONS_DOC,
  destroyEditors,
  mountEditor,
  p,
  press,
} from "../testing/editor";

afterEach(destroyEditors);

const mount = (content: JSONContent = SECTIONS_DOC) => mountEditor(content);

describe("tables", () => {
  it("Tab in the last cell adds a row", () => {
    const editor = mount({ type: "doc", content: [p("Before")] });
    editor.commands.setTextSelection(1);
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    const rows = () => {
      let count = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "tableRow") count++;
      });
      return count;
    };
    expect(rows()).toBe(2);
    for (let i = 0; i < 3; i++) press(editor, "Tab");
    press(editor, "Tab");
    expect(rows()).toBe(3);
    press(editor, "Tab", { shift: true });
    expect(editor.state.selection.$from.node(-1).type.name).toBe("tableCell");
  });
});
