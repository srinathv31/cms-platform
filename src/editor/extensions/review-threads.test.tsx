// @vitest-environment happy-dom
// Review threads on a headless client editor (extensions/review-threads.ts, lib/threads.ts):
// highlights, the fallback to the whole block, mapping through edits, the active thread, the
// thread at the caret, clicks, what a selection quotes, and the static paint's identical markup.

import type { JSONContent } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaticDocument } from "../components/static-document";
import { commentTarget, locateThread, variableLeafText } from "../lib/threads";
import type { Variable } from "../model/types";
import { editorExtensions } from "../schema";
import { createVariableStore } from "../state/variable-store";
import { blockPos, caret, destroyEditors, doc, mountEditor, select, text, type } from "../testing/editor";
import type { ThreadAnchor } from "../types";
import { setReviewThreads, threadAt, threadHighlights, type ReviewThreadsOptions } from "./review-threads";

afterEach(destroyEditors);

const VARIABLES: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];
const leafText = variableLeafText((key) => VARIABLES.find((v) => v.key === key));

const para = (id: string, ...content: JSONContent[]): JSONContent => ({ type: "paragraph", attrs: { id }, content });
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });

const DOC = doc(
  { type: "heading", attrs: { id: "h1", level: 2, requiredKey: "offer_details" }, content: [text("Offer details")] },
  para("p1", text("Earn 2% cash back on every purchase, with no cap.")),
  para("p2", text("Hi "), chip("first_name"), text(", you are pre-approved for the "), { type: "text", text: "Cash Rewards", marks: [{ type: "bold" }] }, text(" card.")),
  {
    type: "bulletList",
    attrs: { id: "l1" },
    content: [
      { type: "listItem", attrs: { id: "li1" }, content: [para("li1p", text("No annual fee"))] },
      { type: "listItem", attrs: { id: "li2" }, content: [para("li2p", text("Cash back never expires"))] },
    ],
  },
  para("p3", text("Last line.")),
);

const thread = (id: string, blockId: string, quote: string | null = null, status: ThreadAnchor["status"] = "open"): ThreadAnchor => ({
  id,
  blockId,
  quote,
  status,
});

function mount(threads: ThreadAnchor[] = [], activeId: string | null = null, events: Partial<ReviewThreadsOptions> = {}) {
  return mountEditor(DOC, {
    extensions: editorExtensions({
      store: createVariableStore(VARIABLES),
      reviewThreads: { initial: () => ({ threads, activeId }), ...events },
    }),
  });
}

/** Position of the first occurrence of `needle` in the document's text (inside one text node). */
function find(editor: ReturnType<typeof mount>, needle: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return true;
  });
  if (found < 0) throw new Error(`"${needle}" not in the document`);
  return found;
}

const marks = (editor: ReturnType<typeof mount>) =>
  [...editor.view.dom.querySelectorAll<HTMLElement>("mark.ucomp-thread")].map((m) => `${m.dataset.thread}${m.hasAttribute("data-active") ? "*" : ""}:${m.textContent}`);
const blockMarks = (editor: ReturnType<typeof mount>) =>
  [...editor.view.dom.querySelectorAll<HTMLElement>(".ucomp-thread-block")].map(
    (b) => `${b.dataset.threadBlock}${b.hasAttribute("data-active") ? "*" : ""}:${b.getAttribute("data-id") ?? b.querySelector("[data-id]")?.getAttribute("data-id")}`,
  );

describe("highlights", () => {
  it("an open thread highlights the first match of its quote in its block", () => {
    const editor = mount([thread("t1", "p1", "2% cash back")]);
    expect(marks(editor)).toEqual(["t1:2% cash back"]);
    expect(blockMarks(editor)).toEqual([]);
  });

  it("matches across whitespace differences and inside nested blocks of a top-level block", () => {
    const editor = mount([thread("t1", "p1", "  every   purchase "), thread("t2", "l1", "No annual fee Cash back")]);
    expect(marks(editor)).toEqual(["t1:every purchase", "t2:No annual fee", "t2:Cash back"]);
  });

  it("a chip reads as its label in a quote; the highlight runs around the chip, not over it", () => {
    const editor = mount([thread("t1", "p2", "Hi First name, you are")]);
    expect(marks(editor)).toEqual(["t1:Hi ", "t1:, you are"]);
    // Marks inside bold text stay inside the <strong> (one per text run).
    setReviewThreads(editor.view, { threads: [thread("t2", "p2", "the Cash Rewards card")] });
    expect(marks(editor)).toEqual(["t2:the ", "t2:Cash Rewards", "t2: card"]);
    expect(editor.view.dom.querySelector("strong > mark.ucomp-thread")?.textContent).toBe("Cash Rewards");
  });

  it("no quote, or a quote that isn't in the block: the whole block, subtly", () => {
    const editor = mount([thread("t1", "p1"), thread("t2", "p3", "not in this block"), thread("t3", "l1")]);
    expect(marks(editor)).toEqual([]);
    expect(blockMarks(editor)).toEqual(["t1:p1", "t3:l1", "t2:p3"]);
  });

  it("resolved threads aren't highlighted", () => {
    const editor = mount([thread("t1", "p1", "2% cash back", "resolved"), thread("t2", "p3", null, "resolved")]);
    expect(marks(editor)).toEqual([]);
    expect(blockMarks(editor)).toEqual([]);
    expect(editor.view.dom.querySelector("[data-thread], [data-thread-block]")).toBeNull();
  });

  it("threads on blocks that aren't there (or the whole-document thread) draw nothing", () => {
    const editor = mount([thread("t1", "gone", "Earn"), thread("t2", "doc")]);
    expect(threadHighlights(editor.state)).toEqual([]);
  });

  it("the active thread is marked; a new active thread moves the mark", () => {
    const editor = mount([thread("t1", "p1", "2% cash back"), thread("t2", "p3")], "t1");
    expect(marks(editor)).toEqual(["t1*:2% cash back"]);
    expect(blockMarks(editor)).toEqual(["t2:p3"]);
    setReviewThreads(editor.view, { activeId: "t2" });
    expect(marks(editor)).toEqual(["t1:2% cash back"]);
    expect(blockMarks(editor)).toEqual(["t2*:p3"]);
    setReviewThreads(editor.view, { activeId: null });
    expect(blockMarks(editor)).toEqual(["t2:p3"]);
  });

  it("new threads replace the old ones; resolving one takes its highlight away", () => {
    const editor = mount([thread("t1", "p1", "2% cash back")]);
    setReviewThreads(editor.view, { threads: [thread("t1", "p1", "2% cash back", "resolved"), thread("t2", "p3", "Last")] });
    expect(marks(editor)).toEqual(["t2:Last"]);
  });

  it("highlights aren't edits: no document change, nothing to undo", () => {
    const editor = mount();
    const before = editor.state.doc;
    setReviewThreads(editor.view, { threads: [thread("t1", "p1", "Earn")] });
    expect(editor.state.doc).toBe(before);
    expect(editor.can().undo()).toBe(false);
  });
});

describe("highlights follow edits (mapped decorations)", () => {
  it("typing before and inside a highlight keeps it on its text", () => {
    const editor = mount([thread("t1", "p1", "cash back")]);
    caret(editor, 1, 0);
    type(editor, "Now: ");
    expect(marks(editor)).toEqual(["t1:cash back"]);
    // Inside the quote: the highlight grows with it.
    const at = find(editor, "back");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
    type(editor, "money ");
    expect(marks(editor)).toEqual(["t1:cash money back"]);
    // Right after it: not part of the highlight.
    const end = find(editor, "back") + 4;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
    type(editor, "!");
    expect(marks(editor)).toEqual(["t1:cash money back"]);
  });

  it("follows its block when blocks above it are added or removed", () => {
    const editor = mount([thread("t1", "p3", "Last"), thread("t2", "p3")]);
    editor.commands.insertContentAt(blockPos(editor, 1), { type: "paragraph", content: [text("A new first paragraph")] });
    expect(marks(editor)).toEqual(["t1:Last"]);
    expect(blockMarks(editor)).toEqual(["t2:p3"]);
    const p1 = blockPos(editor, 2);
    editor.commands.deleteRange({ from: p1, to: p1 + editor.state.doc.child(2).nodeSize });
    expect(marks(editor)).toEqual(["t1:Last"]);
  });

  it("deleting the quoted text falls back to the block; undo brings the text highlight back", () => {
    const editor = mount([thread("t1", "p1", "2% cash back")], "t1");
    const at = find(editor, "2% cash back");
    select(editor, at, at + "2% cash back".length);
    editor.commands.deleteSelection();
    expect(marks(editor)).toEqual([]);
    expect(blockMarks(editor)).toEqual(["t1*:p1"]);
    editor.commands.undo();
    expect(marks(editor)).toEqual(["t1*:2% cash back"]);
    expect(blockMarks(editor)).toEqual([]);
  });

  it("a block deleted and brought back by undo gets its highlight back", () => {
    const editor = mount([thread("t1", "p3", "Last")]);
    const at = blockPos(editor, 4);
    editor.commands.deleteRange({ from: at, to: at + editor.state.doc.child(4).nodeSize });
    expect(threadHighlights(editor.state)).toEqual([]);
    editor.commands.undo();
    expect(marks(editor)).toEqual(["t1:Last"]);
  });

  it("a thread whose quote isn't found is tried again when its block is edited", () => {
    const editor = mount([thread("t1", "p3", "Last line, really.")]);
    expect(blockMarks(editor)).toEqual(["t1:p3"]);
    const end = find(editor, "Last line.") + "Last line".length;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
    type(editor, ", really");
    expect(marks(editor)).toEqual(["t1:Last line, really."]);
    expect(blockMarks(editor)).toEqual([]);
  });
});

describe("the thread at the caret and clicks", () => {
  it("threadAt: inside a quote (edges included), inside a highlighted block; the active one wins an overlap", () => {
    const editor = mount([thread("t1", "p1", "cash back on every"), thread("t2", "p1", "every purchase"), thread("t3", "p3")]);
    const at = find(editor, "cash back");
    expect(threadAt(editor.state, at - 1)).toBeNull();
    expect(threadAt(editor.state, at)).toBe("t1");
    expect(threadAt(editor.state, at + 4)).toBe("t1");
    const every = find(editor, "every");
    // The overlap: the shorter highlight, unless the other one is active.
    expect(threadAt(editor.state, every + 2)).toBe("t2");
    setReviewThreads(editor.view, { activeId: "t1" });
    expect(threadAt(editor.state, every + 2)).toBe("t1");
    expect(threadAt(editor.state, blockPos(editor, 4) + 3)).toBe("t3");
  });

  it("onCaretThread reports the thread under the caret each time it changes", () => {
    const onCaretThread = vi.fn();
    const editor = mount([thread("t1", "p1", "cash back"), thread("t3", "p3")], null, { onCaretThread });
    const at = find(editor, "cash back");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at + 2)));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at + 3)));
    caret(editor, 4, 2);
    caret(editor, 1, 0);
    expect(onCaretThread.mock.calls).toEqual([["t1"], ["t3"], [null]]);
  });

  it("a click on a highlight (text or block) calls onThreadClick; elsewhere it doesn't", () => {
    const onThreadClick = vi.fn();
    const editor = mount([thread("t1", "p1", "cash back"), thread("t3", "p3")], null, { onThreadClick });
    const click = (element: Element | null) => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    click(editor.view.dom.querySelector('mark[data-thread="t1"]'));
    click(editor.view.dom.querySelector('[data-id="p3"]'));
    click(editor.view.dom.querySelector('[data-id="p2"]'));
    expect(onThreadClick.mock.calls).toEqual([["t1"], ["t3"]]);
  });
});

describe("what a selection quotes (commentTarget)", () => {
  const target = (editor: ReturnType<typeof mount>) => commentTarget(editor.state, leafText);

  it("text inside one block: the top-level block id and the selected text", () => {
    const editor = mount();
    const at = find(editor, "cash back");
    select(editor, at, at + "cash back".length);
    expect(target(editor)).toEqual({ blockId: "p1", quote: "cash back" });
  });

  it("trims, joins whitespace, reads chips as labels, and anchors list text to the list", () => {
    const editor = mount();
    const start = blockPos(editor, 2) + 1;
    select(editor, start, find(editor, "pre-approved"));
    expect(target(editor)).toEqual({ blockId: "p2", quote: "Hi First name, you are" });
    select(editor, find(editor, "annual"), find(editor, "never"));
    expect(target(editor)).toEqual({ blockId: "l1", quote: "annual fee Cash back" });
  });

  it("the quote finds its way back to exactly the selected text", () => {
    const editor = mount();
    const from = find(editor, "you are");
    const to = find(editor, " card.");
    select(editor, from, to);
    const request = target(editor)!;
    expect(request.quote).toBe("you are pre-approved for the Cash Rewards");
    expect(locateThread(editor.state.doc, request, leafText)).toEqual({ kind: "text", from, to });
  });

  it("a drag that runs on to the start of the next block still quotes one block", () => {
    const editor = mount();
    select(editor, find(editor, "with no cap"), blockPos(editor, 2) + 1);
    expect(target(editor)).toEqual({ blockId: "p1", quote: "with no cap." });
  });

  it("nothing across blocks, for a caret, a selected chip or whitespace only", () => {
    const editor = mount();
    select(editor, find(editor, "no cap"), find(editor, "you are"));
    expect(target(editor)).toBeNull();
    caret(editor, 1, 3);
    expect(target(editor)).toBeNull();
    const chipPos = blockPos(editor, 2) + 1 + "Hi ".length;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, chipPos)));
    expect(target(editor)).toBeNull();
    const space = find(editor, " cash");
    select(editor, space, space + 1);
    expect(target(editor)).toBeNull();
  });
});

describe("static first paint", () => {
  it("draws the same highlights, with the same markup, as the live editor", () => {
    const threads = [thread("t1", "p2", "Hi First name, you are pre-approved for the Cash"), thread("t2", "p3"), thread("t3", "p1", "Earn", "resolved")];
    const editor = mount(threads, "t2");
    const live = [...editor.view.dom.querySelectorAll("mark, .ucomp-thread-block")].map((el) => el.cloneNode(false) as Element);
    const html = renderToStaticMarkup(<StaticDocument content={DOC} variables={VARIABLES} threads={threads} activeThreadId="t2" />);
    const host = document.createElement("div");
    host.innerHTML = html;
    const painted = [...host.querySelectorAll("mark, .ucomp-thread-block")].map((el) => el.cloneNode(false) as Element);
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()} ${[...el.attributes]
        .map((a) => `${a.name}=${a.name === "class" ? a.value.split(/\s+/).sort().join(".") : a.value}`)
        .sort()
        .join(" ")}`;
    expect(painted.map(describe)).toEqual(live.map(describe));
    expect(painted.length).toBe(4); // three text runs of t1 (around the chip, and in the bold) and the t2 block
    // Nesting matches too: the highlight sits inside the bold, as the decoration does.
    expect(host.querySelector("strong > mark.ucomp-thread")?.textContent).toBe("Cash");
    expect(editor.view.dom.querySelector("strong > mark.ucomp-thread")?.textContent).toBe("Cash");
  });

  it("without threads the static paint is unchanged", () => {
    const plain = renderToStaticMarkup(<StaticDocument content={DOC} variables={VARIABLES} />);
    expect(renderToStaticMarkup(<StaticDocument content={DOC} variables={VARIABLES} threads={[thread("t1", "p1", null, "resolved")]} />)).toBe(plain);
    expect(plain).not.toContain("<mark");
  });
});
