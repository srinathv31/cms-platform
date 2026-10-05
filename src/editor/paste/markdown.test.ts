// @vitest-environment happy-dom
// Markdown plain-text paste: the parser on its own (looksLikeMarkdown, markdownToHtml), then through
// the document editor's real paste path (a paste event with only text/plain on the clipboard), where
// `{{key}}` still becomes chips and unknown keys still create variables. One-line fields keep the text.

import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import type { Variable } from "../model/types";
import { editorExtensions, inlineFieldExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import { createEditorRootRuntime } from "../state/editor-root";
import { looksLikeMarkdown, markdownToHtml } from "./markdown";

describe("looksLikeMarkdown", () => {
  it.each([
    ["## Offer details\nText", true],
    ["# Title", true],
    ["- one\n- two", true],
    ["1. first\n2. second", true],
    ["| Fee | Amount |\n| --- | --- |\n| Late | $40 |", true],
    ["Intro\n\n---\n\nMore", true],
    ["```\ncode\n```", true],
    ["Pay **in full** by the due date.", true],
    ["See [the terms](https://example.com/terms).", true],
  ])("%j → %s", (text, expected) => {
    expect(looksLikeMarkdown(text)).toBe(expected);
  });

  it.each([
    "Your APR is {{purchase_apr}}.",
    "Two lines\nof plain prose.",
    "#hashtag and 3 * 4 = 12",
    "A single rule is just text: ---",
    "Snake_case_words and {{first_name}} stay plain.",
    "a | b",
  ])("plain: %j", (text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});

describe("markdownToHtml", () => {
  it("headings H1–H3; deeper levels become H3; closing hashes go", () => {
    expect(markdownToHtml("# One\n## Two ##\n### Three\n#### Four")).toBe("<h1>One</h1><h2>Two</h2><h3>Three</h3><h3>Four</h3>");
  });

  it("paragraphs split on blank lines; single newlines join; a trailing `  ` or `\\` breaks the line", () => {
    expect(markdownToHtml("One\ntwo\n\nThree  \nfour\\\nfive")).toBe("<p>One two</p><p>Three<br>four<br>five</p>");
  });

  it("bold, italic, both, and strikethrough (text only)", () => {
    expect(markdownToHtml("**b** __b__ *i* _i_ ***bi*** ~~gone~~")).toBe(
      "<p><strong>b</strong> <strong>b</strong> <em>i</em> <em>i</em> <strong><em>bi</em></strong> gone</p>",
    );
  });

  it("{{key}} is left exactly as written, underscores and all", () => {
    expect(markdownToHtml("Dear {{first_name}}, your _rate_ is {{ purchase_apr }} and {{last_name}}.")).toBe(
      "<p>Dear {{first_name}}, your <em>rate</em> is {{ purchase_apr }} and {{last_name}}.</p>",
    );
    expect(markdownToHtml("**{{annual_fee}}** a year")).toBe("<p><strong>{{annual_fee}}</strong> a year</p>");
  });

  it("intraword underscores are not emphasis", () => {
    expect(markdownToHtml("snake_case_word")).toBe("<p>snake_case_word</p>");
  });

  it("links: http, https and mailto become links; anything else keeps its text", () => {
    expect(markdownToHtml("[Terms](https://example.com/a_b_c?x=1&y=2) [Mail](mailto:help@example.com)")).toBe(
      '<p><a href="https://example.com/a_b_c?x=1&amp;y=2">Terms</a> <a href="mailto:help@example.com">Mail</a></p>',
    );
    expect(markdownToHtml("[Click](javascript:alert(1)) [Top](#top)")).toBe("<p>Click) Top</p>");
    expect(markdownToHtml("Visit https://example.com/a_b_c_ today")).toBe("<p>Visit https://example.com/a_b_c_ today</p>");
  });

  it("text is HTML-escaped", () => {
    expect(markdownToHtml('<script>alert("x")</script> & 5 > 3')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; 5 &gt; 3</p>",
    );
  });

  it("backslash escapes and code spans keep their characters", () => {
    expect(markdownToHtml("\\*not italic\\* and `{{code_key}} *raw*`")).toBe("<p>*not italic* and {{code_key}} *raw*</p>");
  });

  it("bullet lists with -, * and +; ordered lists keep their start", () => {
    expect(markdownToHtml("- a\n* b\n+ c")).toBe("<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>");
    expect(markdownToHtml("3. c\n4) d")).toBe('<ol start="3"><li><p>c</p></li><li><p>d</p></li></ol>');
  });

  it("lists nest by indent and come back out", () => {
    expect(markdownToHtml("- a\n  - a1\n    1. a1x\n  - a2\n- b")).toBe(
      "<ul><li><p>a</p><ul><li><p>a1</p><ol><li><p>a1x</p></li></ol></li><li><p>a2</p></li></ul></li><li><p>b</p></li></ul>",
    );
  });

  it("a different marker kind at the same depth starts a sibling list", () => {
    expect(markdownToHtml("- a\n1. one")).toBe("<ul><li><p>a</p></li></ul><ol><li><p>one</p></li></ol>");
  });

  it("continuation lines join the item; an indented paragraph after a blank line is the item's", () => {
    expect(markdownToHtml("- first line\n  more\n\n  second para\n- next")).toBe(
      "<ul><li><p>first line more</p><p>second para</p></li><li><p>next</p></li></ul>",
    );
  });

  it("a list ends at a blank line followed by unindented text", () => {
    expect(markdownToHtml("- a\n\nAfter")).toBe("<ul><li><p>a</p></li></ul><p>After</p>");
  });

  it("pipe tables: a header row, body rows padded to its width, `\\|` is a pipe", () => {
    expect(markdownToHtml("| Fee | Amount |\n|:---|---:|\n| Late | **$40** |\n| A \\| B |")).toBe(
      "<table><tbody>" +
        "<tr><th><p>Fee</p></th><th><p>Amount</p></th></tr>" +
        "<tr><td><p>Late</p></td><td><p><strong>$40</strong></p></td></tr>" +
        "<tr><td><p>A | B</p></td><td><p></p></td></tr>" +
        "</tbody></table>",
    );
  });

  it("tables without outer pipes", () => {
    expect(markdownToHtml("Fee | Amount\n--- | ---\nLate | $40")).toBe(
      "<table><tbody><tr><th><p>Fee</p></th><th><p>Amount</p></th></tr><tr><td><p>Late</p></td><td><p>$40</p></td></tr></tbody></table>",
    );
  });

  it("rules, quotes and code fences", () => {
    expect(markdownToHtml("One\n\n---\n\n> Quoted\n\n```md\n## not a heading\n```")).toBe(
      "<p>One</p><hr><p>Quoted</p><p>## not a heading</p>",
    );
  });

  it("a Copilot answer", () => {
    const answer = [
      "## Offer details",
      "",
      "Hi {{first_name}}, earn a **$200** credit.",
      "",
      "## Rates and fees",
      "",
      "| Rate | What you pay |",
      "| --- | --- |",
      "| Purchase APR | {{purchase_apr}} |",
      "",
      "## Legal notices",
      "",
      "- Terms apply.",
    ].join("\n");
    expect(markdownToHtml(answer)).toBe(
      "<h2>Offer details</h2><p>Hi {{first_name}}, earn a <strong>$200</strong> credit.</p>" +
        "<h2>Rates and fees</h2><table><tbody><tr><th><p>Rate</p></th><th><p>What you pay</p></th></tr>" +
        "<tr><td><p>Purchase APR</p></td><td><p>{{purchase_apr}}</p></td></tr></tbody></table>" +
        "<h2>Legal notices</h2><ul><li><p>Terms apply.</p></li></ul>",
    );
  });
});

// ── Through the editor's paste ───────────────────────────────────

const KNOWN: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

function mount(kind: "body" | "inline") {
  const root = createEditorRootRuntime({ variables: KNOWN });
  root.registerField({ id: "f", label: kind === "body" ? "Document" : "Email subject", kind });
  const options = { store: root.variables, binding: { fieldId: "f", kind, root, chip: createChipPopoverStore() } };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: kind === "body" ? editorExtensions(options) : inlineFieldExtensions(options),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  editors.push(editor);
  return { editor, root };
}

/** A real paste event with only text on the clipboard (what copying from Copilot's answer gives). */
function pastePlainText(editor: Editor, text: string, shift = false) {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  const dom = editor.view.dom;
  // ProseMirror reads Shift from the key events it saw (⇧⌘V is "paste as plain text").
  if (shift) dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", keyCode: 16, shiftKey: true, bubbles: true }));
  dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  if (shift) dom.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", keyCode: 16, bubbles: true }));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const types = (json: JSONContent) => (json.content ?? []).map((node) => node.type);

describe("Markdown paste in the document", () => {
  it("becomes headings, lists, tables and marks, with chips; unknown keys are created", async () => {
    const { editor, root } = mount("body");
    pastePlainText(editor, "## Terms\n\nDear {{first_name}}, pay **{{late_fee}}**.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |");
    await flush();

    const json: JSONContent = editor.getJSON();
    expect(types(json).slice(0, 4)).toEqual(["heading", "paragraph", "bulletList", "table"]);
    const paragraph = json.content![1].content!;
    expect(paragraph.map((n) => n.type)).toEqual(["text", "variable", "text", "variable", "text"]);
    expect(paragraph[3]).toMatchObject({ attrs: { key: "late_fee" }, marks: [{ type: "bold" }] });
    expect(json.content![3].content![0].content![0].type).toBe("tableHeader");
    expect(root.variables.getState().byKey.get("late_fee")).toMatchObject({ label: "Late fee", type: "text", required: false });
  });

  it("text that isn't Markdown pastes as before (lines → paragraphs, chips)", () => {
    const { editor } = mount("body");
    pastePlainText(editor, "Line one {{first_name}}\nLine two");
    expect(editor.getJSON().content!.slice(0, 2).map((n) => n.content?.map((c) => c.type))).toEqual([["text", "variable"], ["text"]]);
  });

  it("a paste as plain text (Shift) keeps the Markdown as text", () => {
    const { editor } = mount("body");
    pastePlainText(editor, "## Terms", true);
    expect(editor.getJSON().content![0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: "## Terms" }] });
  });

  it("one-line fields keep Markdown as text", () => {
    const { editor } = mount("inline");
    pastePlainText(editor, "**Hi** {{first_name}}");
    const line = editor.getJSON().content![0].content!;
    expect(line.map((n) => n.type)).toEqual(["text", "variable"]);
    expect(line[0]).toEqual({ type: "text", text: "**Hi** " });
  });
});
