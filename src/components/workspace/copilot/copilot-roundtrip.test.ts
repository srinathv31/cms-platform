// @vitest-environment happy-dom
// The round trip the Copilot prompt depends on: a draft written out as Markdown (domain/copilot.ts)
// and read back by the editor's Markdown paste (markdownToHtml → the schema → `{{key}}` chips) is the
// same document. An answer that keeps the draft's syntax pastes back without losing structure.

import { afterEach, describe, expect, it } from "vitest";
import { AllSelection } from "@tiptap/pm/state";
import { generateJSON } from "@tiptap/html";
import type { JSONContent } from "@/editor/model/types";
import { chipsInJSON } from "@/editor/paste/chips";
import { markdownToHtml } from "@/editor/paste/markdown";
import { baseExtensions, editorExtensions } from "@/editor/schema";
import { createChipPopoverStore } from "@/editor/state/chip-popover";
import { createEditorRootRuntime } from "@/editor/state/editor-root";
import { blocks, destroyEditors, doc as editorDoc, h2, mountEditor, p as line } from "@/editor/testing/editor";
import { buildCopilotPrompt, documentToMarkdown } from "@/domain/copilot";

const text = (value: string, marks?: JSONContent["marks"]): JSONContent => (marks ? { type: "text", text: value, marks } : { type: "text", text: value });
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const h = (level: number, title: string): JSONContent => ({ type: "heading", attrs: { level }, content: [text(title)] });
const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const row = (cell: "tableHeader" | "tableCell", ...cells: JSONContent[][]): JSONContent => ({
  type: "tableRow",
  content: cells.map((content) => ({ type: cell, content: [p(...content)] })),
});

const BODY: JSONContent = {
  type: "doc",
  content: [
    h(2, "Offer details"),
    p(text("Hi "), chip("first_name"), text(", earn a "), text("$200", [{ type: "bold" }]), text(" credit "), text("soon", [{ type: "italic" }]), text(".")),
    { type: "bulletList", content: [li(p(text("One"))), li(p(text("Two")), { type: "orderedList", content: [li(p(text("Nested")))] })] },
    h(2, "Rates and fees"),
    { type: "table", content: [row("tableHeader", [text("Rate")], [text("What you pay")]), row("tableCell", [text("Purchase APR")], [chip("purchase_apr")])] },
    h(3, "How interest works"),
    p(text("See "), text("the terms", [{ type: "link", attrs: { href: "https://example.com/terms" } }]), text(" [and *more*].")),
    { type: "horizontalRule" },
    h(2, "Legal notices"),
    p(text("Terms apply.")),
  ],
};

/** The parts of a node that matter here: type, text, marks (by type and href), level, chip key. */
function shape(node: JSONContent): unknown {
  const attrs: Record<string, unknown> = {};
  if (node.type === "heading") attrs.level = node.attrs?.level;
  if (node.type === "variable") attrs.key = node.attrs?.key;
  return {
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.marks?.length ? { marks: node.marks.map((mark) => (mark.type === "link" ? `link:${mark.attrs?.href}` : mark.type)) } : {}),
    ...(node.content?.length ? { content: node.content.map(shape) } : {}),
  };
}

describe("draft → Markdown → paste", () => {
  it("gives back the same blocks, marks, links and chips", () => {
    const markdown = documentToMarkdown(BODY);
    const back = chipsInJSON(generateJSON(markdownToHtml(markdown), baseExtensions()));
    expect(shape(back)).toEqual(shape(BODY));
  });
});

describe("prompt headings → answer → section paste", () => {
  afterEach(destroyEditors);

  it("an answer written to the prompt's headings merges into the draft's sections after the type renamed one", () => {
    // The draft was made before "Rates and fees" was renamed "Fees and charges" in the content type.
    const draft = editorDoc(h2("Offer details", "offer_details"), line("Old offer"), h2("Rates and fees", "rates_and_fees"), line("Old rates"));
    const prompt = buildCopilotPrompt({
      templateName: "Spring offer",
      teamName: "Coral Offers",
      contentTypeName: "Disclosure",
      channels: ["pdf"],
      requiredSections: [
        { key: "offer_details", title: "Offer details" },
        { key: "rates_and_fees", title: "Fees and charges" },
      ],
      variables: [],
      body: draft,
    }).text;
    const headings = prompt.slice(prompt.indexOf("in this order:"), prompt.indexOf("There are no placeholders")).match(/^## .+$/gm)!;
    expect(headings).toEqual(["## Offer details", "## Rates and fees"]);

    // Copilot answers with exactly those headings; the author selects all and pastes.
    const answer = headings.map((heading, i) => `${heading}\n\nNew section ${i + 1}.`).join("\n\n");
    // The document editor's paste path (Markdown, chips, the section merge), as in section-paste.test.ts.
    const root = createEditorRootRuntime({ variables: [] });
    root.registerField({ id: "body", label: "Document", kind: "body" });
    const binding = { fieldId: "body", kind: "body" as const, root, chip: createChipPopoverStore() };
    const editor = mountEditor(draft, { extensions: editorExtensions({ store: root.variables, binding }) });
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", answer);
    editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));

    expect(blocks(editor)).toEqual(["h2*:Offer details", "p:New section 1.", "h2*:Rates and fees", "p:New section 2."]);
  });
});
