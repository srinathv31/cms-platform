// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { baseExtensions } from "../schema";
import type { JSONContent } from "./types";
import { mergeUsage, reconcileUsage, usageFromDoc, usageFromJSON } from "./usage";

const text = (value: string): JSONContent => ({ type: "text", text: value });
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const h = (level: number, title: string, requiredKey?: string): JSONContent => ({
  type: "heading",
  attrs: { level, requiredKey: requiredKey ?? null },
  content: [text(title)],
});

const DOC: JSONContent = {
  type: "doc",
  content: [
    p(text("Hi "), chip("first_name")),
    h(2, "Offer details", "offer_details"),
    p(chip("purchase_apr"), text(" and "), chip("first_name")),
    h(3, "Fine print"),
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [p(chip("purchase_apr"))] }],
    },
    h(2, "Rates and fees", "rates_and_fees"),
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [p(text("APR"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [p(chip("purchase_apr"))] }] },
      ],
    },
  ],
};

const EXPECTED = new Map([
  ["first_name", [{ section: null, count: 1 }, { section: "Offer details", count: 1 }]],
  ["purchase_apr", [{ section: "Offer details", count: 2 }, { section: "Rates and fees", count: 1 }]],
]);

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("usage", () => {
  it("counts chips per key by H2 section (H3s don't start a section)", () => {
    expect(usageFromJSON(DOC, { sections: true })).toEqual(EXPECTED);
  });

  it("gives the same numbers from a live document as from JSON", () => {
    editor = new Editor({ element: document.createElement("div"), extensions: baseExtensions(), content: DOC });
    expect(usageFromDoc(editor.state.doc, { sections: true })).toEqual(EXPECTED);
  });

  it("drops sections for inline fields", () => {
    expect(usageFromJSON(DOC, { sections: false }).get("purchase_apr")).toEqual([{ section: null, count: 3 }]);
  });

  it("recounts after edits without re-walking unchanged blocks", () => {
    editor = new Editor({ element: document.createElement("div"), extensions: baseExtensions(), content: DOC });
    const first = usageFromDoc(editor.state.doc, { sections: true });
    editor.commands.insertContentAt(1, "Hello ");
    const second = usageFromDoc(editor.state.doc, { sections: true });
    expect(second).toEqual(first);
    // Renaming a section heading moves its chips to the new title.
    const headingPos = editor.state.doc.child(0).nodeSize;
    editor.commands.insertContentAt(headingPos + 1, "Special ");
    expect(usageFromDoc(editor.state.doc, { sections: true }).get("purchase_apr")?.[0]).toEqual({
      section: "Special Offer details",
      count: 2,
    });
  });

  it("merges fields into places, body first, and keeps unchanged entries' identity", () => {
    const body = usageFromJSON(DOC, { sections: true });
    const subject = usageFromJSON({ type: "doc", content: [p(chip("first_name"))] }, { sections: false });
    const merged = mergeUsage([
      { label: "Document", usage: body },
      { label: "Email subject", usage: subject },
    ]);
    expect(merged.get("first_name")).toEqual({
      key: "first_name",
      count: 3,
      places: [
        { field: "Document", section: null, count: 1 },
        { field: "Document", section: "Offer details", count: 1 },
        { field: "Email subject", section: null, count: 1 },
      ],
    });

    const again = mergeUsage([{ label: "Document", usage: body }, { label: "Email subject", usage: subject }]);
    const reconciled = reconcileUsage(merged, again);
    expect(reconciled).toBe(merged);

    const fewer = mergeUsage([{ label: "Document", usage: body }]);
    const next = reconcileUsage(merged, fewer);
    expect(next).not.toBe(merged);
    expect(next.get("purchase_apr")).toBe(merged.get("purchase_apr"));
    expect(next.get("first_name")?.count).toBe(2);
  });
});
