// @vitest-environment happy-dom
// The block handle's + (lib/insert-below.ts) and the `/` menu's dismiss-undo (SlashMenuController.armUndo).

import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createSlashMenuController } from "../components/slash-menu";
import { insertBlockBelow } from "./insert-below";
import {
  SECTIONS_DOC,
  blockPos,
  blocks,
  destroyEditors,
  flush,
  mountEditor,
  p,
  press,
} from "../testing/editor";

afterEach(destroyEditors);

const mount = (content: JSONContent = SECTIONS_DOC) => mountEditor(content);

describe("+ (insert below)", () => {
  it("adds a line with / below the block, and a dismissed menu takes it back out", async () => {
    const slash = createSlashMenuController();
    const editor = mountEditor(SECTIONS_DOC, { slashRender: slash.render });
    await flush(); // UniqueID's first pass
    const node = editor.state.doc.child(3);
    insertBlockBelow(editor, node, blockPos(editor, 3));
    slash.armUndo(editor);
    expect(blocks(editor).slice(3, 5)).toEqual(["h2*:Rates and fees", "p:/"]);
    await flush();
    expect(slash.store.getState().props?.query).toBe("");
    press(editor, "Escape");
    await flush();
    await flush();
    expect(blocks(editor)).toEqual(blocks(mount()));
  });

  it("reuses an empty line under the pointer", () => {
    const editor = mount({ type: "doc", content: [p("A"), p(), p("B")] });
    insertBlockBelow(editor, editor.state.doc.child(1), blockPos(editor, 1));
    expect(blocks(editor)).toEqual(["p:A", "p:/", "p:B"]);
  });
});
