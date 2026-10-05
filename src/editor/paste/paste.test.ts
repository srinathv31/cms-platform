// @vitest-environment happy-dom
// Paste, end to end: real clipboard HTML (Word for Windows, Word for Mac, Google Docs) goes through
// the editor's own paste path (view.pasteHTML → transformPastedHTML → schema parse →
// transformPasted) and is checked as the resulting TipTap JSON, written compactly:
//   "p: text **bold** _italic_ __underline__ [link](href) {{chip}}", lists and tables as nested arrays.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import type { Variable } from "../model/types";
import { editorExtensions, inlineFieldExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import { createEditorRootRuntime } from "../state/editor-root";
import { chipsInJSON, variableKeys } from "./chips";
import { normalizePastedHtml } from "./normalize-html";

const fixture = (name: string) => readFileSync(resolve(process.cwd(), "src/editor/paste/__fixtures__", name), "utf8");

const KNOWN: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
  { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" },
  { key: "offer_end_date", label: "Offer end date", type: "date", required: true, sample: "2027-03-04" },
];

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

function mount(kind: "body" | "inline" = "body", content?: JSONContent) {
  const root = createEditorRootRuntime({ variables: KNOWN });
  root.registerField({ id: "f", label: kind === "body" ? "Document" : "Email subject", kind });
  const options = { store: root.variables, binding: { fieldId: "f", kind, root, chip: createChipPopoverStore() } };
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: kind === "body" ? editorExtensions(options) : inlineFieldExtensions(options),
    content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
  });
  editors.push(editor);
  return { editor, root };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── Compact JSON ─────────────────────────────────────────────────

type Shape = string | Shape[] | { [type: string]: Shape[] };

function inline(content: JSONContent[] | undefined): string {
  return (content ?? [])
    .map((node) => {
      if (node.type === "variable") {
        const chip = `{{${node.attrs?.key}}}`;
        const marks = (node.marks ?? []).map((m) => m.type);
        return marks.includes("bold") ? `**${chip}**` : marks.includes("italic") ? `_${chip}_` : chip;
      }
      if (node.type === "hardBreak") return "\\n";
      let text = node.text ?? "";
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") text = `**${text}**`;
        else if (mark.type === "italic") text = `_${text}_`;
        else if (mark.type === "underline") text = `__${text}__`;
        else if (mark.type === "link") text = `[${text}](${mark.attrs?.href})`;
      }
      return text;
    })
    .join("")
    // Adjacent runs with the same mark read as one.
    .replace(/\*\*\*\*/g, "")
    .replace(/__(?=_)/g, "__");
}

function shape(node: JSONContent): Shape {
  switch (node.type) {
    case "paragraph":
      return `p: ${inline(node.content)}`;
    case "heading":
      return `h${node.attrs?.level}: ${inline(node.content)}`;
    case "bulletList":
    case "orderedList":
    case "table":
    case "tableRow":
      return { [node.type === "bulletList" ? "ul" : node.type === "orderedList" ? "ol" : node.type === "table" ? "table" : "tr"]: (node.content ?? []).map(shape) };
    case "listItem":
      return (node.content ?? []).map(shape);
    case "tableHeader":
    case "tableCell":
      return { [node.type === "tableHeader" ? "th" : "td"]: (node.content ?? []).map(shape) };
    default:
      return node.type ?? "?";
  }
}

const doc = (editor: Editor) => {
  const blocks = (editor.getJSON().content ?? []).map(shape);
  // The empty line the paste landed in / the trailing line.
  while (blocks.at(-1) === "p: ") blocks.pop();
  return blocks;
};

// ── Normalizer ───────────────────────────────────────────────────

describe("normalizePastedHtml", () => {
  it("strips Word's styles, classes, spans, fonts, o:p, comments and fragment markers", () => {
    const html = normalizePastedHtml(fixture("word-windows.html"));
    for (const junk of ["mso-", "class=", "style=", "<span", "<o:p", "<!--", "StartFragment", "font-family", "<font", "width="]) {
      expect(html).not.toContain(junk);
    }
    expect(html).toContain("<h1>Cash Rewards Card offer</h1>");
  });

  it("leaves HTML copied from the editor itself alone", () => {
    const own = '<p data-pm-slice="1 1 []">Hi <span data-variable="first_name" class="x">First name</span></p>';
    expect(normalizePastedHtml(own)).toBe(own);
  });

  it("drops empty &nbsp; paragraphs, colors and images; keeps bold from styles", () => {
    expect(
      normalizePastedHtml('<p style="color:red"><span style="font-weight:700">Bold</span> <img src="x.png"> text</p><p>&nbsp;</p>'),
    ).toBe("<p><strong>Bold</strong>  text</p>");
  });
});

// ── Word for Windows ─────────────────────────────────────────────

describe("paste from Word for Windows", () => {
  it("keeps headings, nested bullet and numbered lists, the table with its header row, bold/italic/underline and links", () => {
    const { editor } = mount();
    editor.view.pasteHTML(fixture("word-windows.html"));
    expect(doc(editor)).toEqual([
      "h1: Cash Rewards Card offer",
      "p: Hi {{first_name}}, you’re pre-approved for the **Cash Rewards Card**. Here is what the offer _includes_ and the __terms__ that come with it.",
      "h2: Offer details",
      {
        ul: [
          ["p: A variable purchase APR of {{purchase_apr}}.", { ul: [["p: Based on the Prime Rate."]] }],
          ["p: Cash back that **never expires**."],
        ],
      },
      "p: Apply by {{offer_end_date}} at [example.com/apply](https://example.com/apply).",
      "h2: Rates and fees",
      {
        table: [
          { tr: [{ th: ["p: **Interest rates and fees**"] }, { th: ["p: **Terms**"] }] },
          { tr: [{ td: ["p: Annual fee"] }, { td: ["p: {{annual_fee}}"] }] },
          { tr: [{ td: ["p: Late payment fee"] }, { td: ["p: Up to $41"] }] },
        ],
      },
      "h3: Legal",
      {
        ol: [
          ["p: Credit approval is required.", { ol: [["p: Terms may vary."]] }],
          ["p: Your account must be open."],
        ],
      },
      "p: Questions? Call us.",
    ]);
  });

  it("chips carry only their key", () => {
    const { editor } = mount();
    editor.view.pasteHTML(fixture("word-windows.html"));
    const chips: JSONContent[] = [];
    const walk = (node: JSONContent) => {
      if (node.type === "variable") chips.push(node);
      node.content?.forEach(walk);
    };
    walk(editor.getJSON());
    expect(chips.map((c) => c.attrs)).toEqual([
      { key: "first_name" },
      { key: "purchase_apr" },
      { key: "offer_end_date" },
      { key: "annual_fee" },
    ]);
  });

  it("is one undo step", () => {
    const { editor } = mount();
    editor.view.pasteHTML(fixture("word-windows.html"));
    editor.commands.undo();
    expect(doc(editor)).toEqual([]);
  });
});

// ── Word for Mac ─────────────────────────────────────────────────

describe("paste from Word for Mac", () => {
  it("handles <!--[if !supportLists]--> markers, the Title style, h4, styled runs and a merged header cell", async () => {
    const { editor, root } = mount();
    editor.view.pasteHTML(fixture("word-mac.html"));
    expect(doc(editor)).toEqual([
      "h1: Rate change notice",
      "p: Dear {{first_name}}, the APR on your account changes to **{{new_apr}}** on _{{effective_date}}_. Keep {{this one}} as text.",
      "h2: What changes",
      { ol: [["p: Your purchase APR."], ["p: Your cash advance APR."]] },
      "p: Nothing else changes:",
      { ul: [["p: Fees stay the same."], ["p: Your __credit limit__ stays the same."]] },
      "h3: Fine print",
      {
        table: [
          { tr: [{ td: ["p: Effective {{effective_date}}"] }] },
          { tr: [{ td: ["p: Old APR"] }, { td: ["p: "] }] },
        ],
      },
    ]);
    const table = (editor.getJSON().content ?? []).find((n) => n.type === "table") as JSONContent;
    expect(table.content?.[0]?.content?.[0]?.attrs?.colspan).toBe(2);

    // Unknown keys became optional Text variables, labelled from the key; known keys were kept.
    await flush();
    const created = root.variables.getState().variables.slice(KNOWN.length);
    expect(created).toEqual([
      { key: "new_apr", label: "New APR", type: "text", required: false, sample: "" },
      { key: "effective_date", label: "Effective date", type: "text", required: false, sample: "" },
    ]);

    // Undo takes the paste out; the created variables stay (like an inline Create).
    editor.commands.undo();
    expect(doc(editor)).toEqual([]);
    expect(root.variables.getState().variables).toHaveLength(KNOWN.length + 2);
  });
});

// ── Google Docs ──────────────────────────────────────────────────

describe("paste from Google Docs", () => {
  it("unwraps the docs-internal-guid <b>, keeps weight/style spans as marks and the list", () => {
    const { editor } = mount();
    editor.view.pasteHTML(fixture("google-docs.html"));
    expect(doc(editor)).toEqual([
      "h2: Fee schedule",
      "p: The annual fee is **{{annual_fee}}**_ per year_, see [fees](https://example.com/fees).",
      { ul: [["p: No foreign transaction fee"]] },
    ]);
  });
});

// ── Plain text and one-line fields ───────────────────────────────

describe("{{key}} in pasted text", () => {
  it("plain text: known keys and new ones become chips; invalid {{…}} stays text", async () => {
    const { editor, root } = mount();
    editor.view.pasteText("Hi {{first_name}} and {{ promo_code }}, not {{Promo Code}} or {{9lives}}.");
    expect(doc(editor)).toEqual(["p: Hi {{first_name}} and {{promo_code}}, not {{Promo Code}} or {{9lives}}."]);
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"text":", not {{Promo Code}} or {{9lives}}."');
    await flush();
    expect(root.variables.getState().byKey.get("promo_code")).toEqual({
      key: "promo_code",
      label: "Promo code",
      type: "text",
      required: false,
      sample: "",
    });
  });

  it("a deleted variable pasted back comes back as it was", async () => {
    const { editor, root } = mount();
    root.deleteVariable("annual_fee");
    editor.view.pasteText("Fee {{annual_fee}}");
    await flush();
    expect(root.variables.getState().byKey.get("annual_fee")?.type).toBe("currency");
  });

  it("a one-line field joins pasted lines with spaces and keeps chips", () => {
    const { editor } = mount("inline");
    editor.view.pasteText("Your offer\nends {{offer_end_date}}\n\nsoon");
    expect(doc(editor)).toEqual(["p: Your offer ends {{offer_end_date}} soon"]);
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    editor.view.pasteHTML(fixture("word-windows.html"));
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent.startsWith("Cash Rewards Card offer Hi ")).toBe(true);
  });
});

// ── Import helpers (JSON) ────────────────────────────────────────

describe("chipsInJSON and variableKeys (import)", () => {
  it("turns valid {{key}} in TipTap JSON into chips, keeping marks; invalid stays text", () => {
    const input: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "For {{first_name}}" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Fee {{ annual_fee }}", marks: [{ type: "bold" }] },
            { type: "text", text: " and {{Not a key}}." },
          ],
        },
      ],
    };
    const out = chipsInJSON(input);
    expect(out.content?.[0].content).toEqual([
      { type: "text", text: "For " },
      { type: "variable", attrs: { key: "first_name" } },
    ]);
    expect(out.content?.[1].content).toEqual([
      { type: "text", text: "Fee ", marks: [{ type: "bold" }] },
      { type: "variable", attrs: { key: "annual_fee" }, marks: [{ type: "bold" }] },
      { type: "text", text: " and {{Not a key}}." },
    ]);
    expect(variableKeys(out)).toEqual(["first_name", "annual_fee"]);
  });

  it("returns the same object when there is nothing to convert", () => {
    const input: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Plain" }] }] };
    expect(chipsInJSON(input)).toBe(input);
  });

  it("produces JSON the schema accepts (round-trips through an editor)", () => {
    const { editor } = mount();
    editor.commands.setContent(chipsInJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi {{first_name}}" }] }] }));
    expect(doc(editor)).toEqual(["p: Hi {{first_name}}"]);
  });
});
