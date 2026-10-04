// @vitest-environment happy-dom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { baseExtensions } from "../schema";
import { focusFirstSection } from "./sections";

const text = (value: string): JSONContent => ({ type: "text", text: value });
const h2 = (title: string, requiredKey: string | null): JSONContent => ({ type: "heading", attrs: { level: 2, requiredKey }, content: [text(title)] });
const p = (value?: string): JSONContent => (value ? { type: "paragraph", content: [text(value)] } : { type: "paragraph" });

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const mount = (content: JSONContent[]) => {
  editor = new Editor({ element: document.createElement("div"), extensions: baseExtensions(), content: { type: "doc", content } });
  return editor;
};

describe('focus("first-section")', () => {
  it("continues a seeded section: the caret goes to the end of its last line", () => {
    const e = mount([
      p("Intro"),
      h2("Offer details", "offer_details"),
      p("Spend $2,000 in the first 3 months."),
      p("Earn 20,000 points."),
      h2("Rates and fees", "rates_and_fees"),
      p("Rates"),
    ]);
    focusFirstSection(e);
    const { $from } = e.state.selection;
    expect($from.parent.textContent).toBe("Earn 20,000 points.");
    expect($from.parentOffset).toBe("Earn 20,000 points.".length);
  });

  it("prefers the section's last top-level paragraph over a list after it", () => {
    const e = mount([
      h2("Offer details", "offer_details"),
      p("Earn points on every purchase."),
      { type: "bulletList", content: ["One", "Two", "Three"].map((v) => ({ type: "listItem", content: [p(v)] })) },
      h2("Legal notices", "legal_notices"),
    ]);
    focusFirstSection(e);
    expect(e.state.selection.$from.parent.textContent).toBe("Earn points on every purchase.");
    expect(e.state.selection.$from.depth).toBe(1);
  });

  it("reaches into a list or table when the section has no paragraph", () => {
    const e = mount([
      h2("Offer details", "offer_details"),
      { type: "bulletList", content: [{ type: "listItem", content: [p("Last item")] }] },
      h2("Legal notices", "legal_notices"),
    ]);
    focusFirstSection(e);
    expect(e.state.selection.$from.parent.textContent).toBe("Last item");
  });

  it("adds an empty line under an empty section's heading (Blank), outside undo history", () => {
    const e = mount([h2("Offer details", "offer_details"), h2("Legal notices", "legal_notices")]);
    focusFirstSection(e);
    expect(e.state.doc.child(1).type.name).toBe("paragraph");
    expect(e.state.selection.from).toBe(e.state.doc.child(0).nodeSize + 1);
    expect(e.can().undo()).toBe(false);
  });
});
