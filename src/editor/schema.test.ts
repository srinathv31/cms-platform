// @vitest-environment happy-dom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { filterBlockItems, BLOCK_ITEMS } from "./extensions/block-items";
import type { Variable } from "./model/types";
import { BLOCK_ID_TYPES, baseExtensions, ensureBlockIds } from "./schema";
import { type as typeText } from "./testing/editor";

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
];

const text = (value: string): JSONContent => ({ type: "text", text: value });
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });

const DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { id: "h-1", level: 2, requiredKey: "offer_details" }, content: [text("Offer details")] },
    { type: "paragraph", attrs: { id: "p-1" }, content: [text("Hi "), chip("first_name"), text(", welcome.")] },
    { type: "callout", attrs: { id: "c-1" }, content: [{ type: "paragraph", attrs: { id: "p-2" }, content: [text("Note")] }] },
    {
      type: "bulletList",
      attrs: { id: "l-1" },
      content: [{ type: "listItem", attrs: { id: "li-1" }, content: [{ type: "paragraph", attrs: { id: "p-3" }, content: [chip("purchase_apr")] }] }],
    },
    {
      type: "table",
      attrs: { id: "t-1" },
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", attrs: { id: "p-4" }, content: [text("Fee")] }] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", attrs: { id: "p-5" }, content: [chip("first_name")] }] }] },
      ],
    },
    { type: "horizontalRule", attrs: { id: "hr-1" } },
    { type: "heading", attrs: { id: "h-2", level: 2, requiredKey: "legal_notices" }, content: [text("Legal notices")] },
    { type: "paragraph", attrs: { id: "p-6" }, content: [text("End.")] },
  ],
};

let editor: Editor | null = null;

async function mount(content: JSONContent = DOC) {
  editor = new Editor({ element: document.createElement("div"), extensions: baseExtensions({ variables: VARIABLES }), content });
  await new Promise((resolve) => setTimeout(resolve, 0)); // let UniqueID's create pass run
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function collect(node: JSONContent, pick: (n: JSONContent) => unknown, out: unknown[] = []): unknown[] {
  const value = pick(node);
  if (value !== undefined) out.push(value);
  node.content?.forEach((child) => collect(child, pick, out));
  return out;
}

const ids = (doc: JSONContent) => collect(doc, (n) => n.attrs?.id ?? undefined);
const variableAttrs = (doc: JSONContent) => collect(doc, (n) => (n.type === "variable" ? n.attrs : undefined));

describe("schema round-trip", () => {
  it("keeps block ids, requiredKey and variable keys (and nothing else on chips)", async () => {
    const out = (await mount()).getJSON();
    expect(ids(out)).toEqual(ids(DOC));
    expect(out.content?.[0].attrs).toMatchObject({ id: "h-1", level: 2, requiredKey: "offer_details" });
    expect(variableAttrs(out)).toEqual([{ key: "first_name" }, { key: "purchase_apr" }, { key: "first_name" }]);
  });

  it("is stable: JSON → editor → JSON → editor gives the same JSON", async () => {
    const once = (await mount()).getJSON();
    editor!.destroy();
    const twice = (await mount(once)).getJSON();
    expect(twice).toEqual(once);
  });

  it("serializes chips, required headings and callouts to HTML", async () => {
    const html = (await mount()).getHTML();
    expect(html).toContain('<span data-variable="first_name">First name</span>');
    expect(html).toContain('data-required="offer_details"');
    expect(html).toContain("data-callout");
    expect(html).toContain('class="tableWrapper"');
  });

  it("parses the HTML back to the same structure", async () => {
    const html = (await mount()).getHTML();
    editor!.destroy();
    const fromHtml = (await mount()).commands.setContent(html) && editor!.getJSON();
    expect(variableAttrs(fromHtml as JSONContent)).toEqual(variableAttrs(DOC));
    expect((fromHtml as JSONContent).content?.[0].attrs?.requiredKey).toBe("offer_details");
  });

  it("adds a trailing line after a final heading, so there's always a place to type", async () => {
    const out = (
      await mount({ type: "doc", content: [{ type: "heading", attrs: { id: "h", level: 2, requiredKey: "legal_notices" }, content: [text("Legal notices")] }] })
    ).getJSON();
    expect(out.content?.map((n) => n.type)).toEqual(["heading", "paragraph"]);
  });

  it("writes chips as {{key}} in plain text", async () => {
    expect((await mount()).getText()).toContain("Hi {{first_name}}, welcome.");
  });
});

describe("UniqueID", () => {
  it("gives new blocks a fresh id and leaves existing ids alone", async () => {
    const ed = await mount();
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: "paragraph", content: [text("New")] });
    const out = ed.getJSON();
    const last = out.content?.at(-1);
    expect(last?.type).toBe("paragraph");
    expect(typeof last?.attrs?.id).toBe("string");
    expect(ids(DOC).includes(last?.attrs?.id)).toBe(false);
    expect(ids(out).slice(0, ids(DOC).length)).toEqual(ids(DOC));
  });

  it("fills missing ids on load without touching existing ones", async () => {
    const out = (
      await mount({ type: "doc", content: [{ type: "paragraph", attrs: { id: "keep" }, content: [text("a")] }, { type: "paragraph", content: [text("b")] }] })
    ).getJSON();
    expect(out.content?.[0].attrs?.id).toBe("keep");
    expect(out.content?.[1].attrs?.id).toEqual(expect.any(String));
  });

  it("splitting a block gives the new half its own id", async () => {
    const ed = await mount();
    const pos = 1 + "Offer".length; // inside the first heading
    ed.chain().setTextSelection(pos).splitBlock().run();
    const headingIds = ed.getJSON().content!.filter((n) => n.type === "heading").map((n) => n.attrs?.id);
    expect(new Set(headingIds).size).toBe(headingIds.length);
  });

  it("ensureBlockIds adds ids server-side for every block type", () => {
    const out = ensureBlockIds({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text("A")] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("b")] }] }] },
        { type: "paragraph", attrs: { id: "keep" }, content: [text("c")] },
      ],
    });
    const blocks = collect(out, (n) => (BLOCK_ID_TYPES.includes(n.type as never) ? n.attrs?.id : undefined));
    expect(blocks).toHaveLength(5);
    expect(blocks.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(blocks).toContain("keep");
  });
});

describe("required sections", () => {
  const requiredKeys = (doc: JSONContent) => collect(doc, (n) => n.attrs?.requiredKey ?? undefined);

  it("splitting a required heading never makes a second required heading", async () => {
    const ed = await mount();
    ed.chain().setTextSelection(1 + "Offer".length).splitBlock().run();
    const headings = ed.getJSON().content!.filter((n) => n.type === "heading");
    expect(headings[0].attrs).toMatchObject({ id: "h-1", requiredKey: "offer_details" });
    expect(headings[1].attrs?.requiredKey).toBeNull();
    expect(requiredKeys(ed.getJSON())).toEqual(["offer_details", "legal_notices"]);
  });

  it("pasting a copy of a required heading keeps one required heading per key", async () => {
    const ed = await mount();
    ed.commands.insertContentAt(ed.state.doc.content.size, '<h2 data-required="offer_details">Offer details</h2>');
    expect(requiredKeys(ed.getJSON())).toEqual(["offer_details", "legal_notices"]);
  });
});

describe("variable chip", () => {
  it("Backspace right after a chip removes the whole chip and leaves no trigger text", async () => {
    const ed = await mount();
    // "Hi " is 3 chars; paragraph p-1 starts after the heading.
    const paragraphStart = ed.state.doc.child(0).nodeSize + 1;
    const afterChip = paragraphStart + "Hi ".length + 1;
    ed.commands.setTextSelection(afterChip);
    expect(ed.state.doc.nodeAt(afterChip - 1)?.type.name).toBe("variable");

    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    const handled = ed.view.someProp("handleKeyDown", (handler) => handler(ed.view, event));
    expect(handled).toBe(true);

    const paragraph = ed.getJSON().content![1];
    expect(variableAttrs(paragraph)).toEqual([]);
    expect(paragraph.content).toEqual([{ type: "text", text: "Hi , welcome." }]);
  });

  it("is an atom: the cursor can't land inside it", async () => {
    const ed = await mount();
    const pos = ed.state.doc.child(0).nodeSize + 1 + "Hi ".length;
    const node = ed.state.doc.nodeAt(pos);
    expect(node?.type.name).toBe("variable");
    expect(node?.isAtom && node.isInline && node.isLeaf).toBe(true);
  });
});

describe("slash menu items", () => {
  it("filters by label and keywords, best match first", async () => {
    const ed = await mount({ type: "doc", content: [{ type: "paragraph" }] });
    ed.commands.setTextSelection(1);
    expect(filterBlockItems(BLOCK_ITEMS, "", ed).map((i) => i.id)).toEqual([
      "text",
      "heading1",
      "heading2",
      "heading3",
      "bulletList",
      "orderedList",
      "table",
      "callout",
      "divider",
    ]);
    expect(filterBlockItems(BLOCK_ITEMS, "h2", ed).map((i) => i.id)).toEqual(["heading2"]);
    expect(filterBlockItems(BLOCK_ITEMS, "head", ed).map((i) => i.id)).toEqual(["heading1", "heading2", "heading3"]);
    expect(filterBlockItems(BLOCK_ITEMS, "list", ed).map((i) => i.id)).toEqual(["bulletList", "orderedList"]);
    expect(filterBlockItems(BLOCK_ITEMS, "hr", ed).map((i) => i.id)).toEqual(["divider"]);
    expect(filterBlockItems(BLOCK_ITEMS, "zzz", ed)).toEqual([]);
  });

  it("hides blocks that can't go where the cursor is", async () => {
    const ed = await mount();
    const cellText = collectPositions(ed, "Fee");
    ed.commands.setTextSelection(cellText);
    const inTable = filterBlockItems(BLOCK_ITEMS, "", ed).map((i) => i.id);
    expect(inTable).not.toContain("table");
    expect(inTable).not.toContain("callout");

    ed.commands.setTextSelection(collectPositions(ed, "Note"));
    const inCallout = filterBlockItems(BLOCK_ITEMS, "", ed).map((i) => i.id);
    expect(inCallout).not.toContain("heading1");
    expect(inCallout).not.toContain("table");
  });

  it("applies a block after removing the /query", async () => {
    const ed = await mount({ type: "doc", content: [{ type: "paragraph", content: [text("/h2")] }] });
    const heading = BLOCK_ITEMS.find((i) => i.id === "heading2")!;
    heading.apply(ed.chain().deleteRange({ from: 1, to: 4 })).run();
    expect(ed.getJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(ed.getJSON().content?.[0].content).toBeUndefined();
  });
});

describe("numbered list typed rule", () => {
  /** Types `value` one character at a time at the end of the document's only line. */
  async function typed(value: string) {
    const ed = await mount({ type: "doc", content: [{ type: "paragraph" }] });
    ed.commands.setTextSelection(1);
    for (const char of value) typeText(ed, char);
    return ed.state.doc.firstChild!;
  }

  it.each([
    ["1. ", 1],
    ["0. ", 0],
    ["42. ", 42],
    ["9999. ", 9999],
  ])("%j starts a numbered list at %i", async (value, start) => {
    const block = await typed(value);
    expect(block.type.name).toBe("orderedList");
    expect(block.attrs.start).toBe(start);
    expect(block.textContent).toBe("");
  });

  it.each(["10000. ", "12345. ", "007007. "])("%j stays text (a list starts at 0 to 9999)", async (value) => {
    const block = await typed(value);
    expect(block.type.name).toBe("paragraph");
    expect(block.textContent).toBe(value);
  });

  it("joins the list just above when the number continues it, as TipTap's rule does", async () => {
    const item = (value: string): JSONContent => ({ type: "listItem", content: [{ type: "paragraph", content: [text(value)] }] });
    const ed = await mount({ type: "doc", content: [{ type: "orderedList", attrs: { start: 1 }, content: [item("One"), item("Two")] }, { type: "paragraph" }] });
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    for (const char of "3. ") typeText(ed, char);
    const blocks = ed.getJSON().content ?? [];
    expect(blocks.filter((block) => block.type === "orderedList")).toHaveLength(1);
    expect(blocks[0].content).toHaveLength(3);
  });
});

function collectPositions(ed: Editor, needle: string): number {
  let found = -1;
  ed.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(needle)) found = pos + 1;
    return found < 0;
  });
  return found;
}
