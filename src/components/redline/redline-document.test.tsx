// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RedlineBlock } from "@/domain/review-types";
import type { JSONContent } from "@/editor/model/types";
import { blockKind, collapsedHosts, gapLabel, groupBlocks, hostKey, joinAnd, markAllDeleted, redlineSummary } from "./blocks";
import { RedlineDocument } from "./redline-document";
import { REDLINE_DOC, REDLINE_VARIABLES } from "./redline-fixtures";

const html = renderToStaticMarkup(<RedlineDocument doc={REDLINE_DOC} variables={REDLINE_VARIABLES} />);

function dom(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}

describe("RedlineDocument: marks", () => {
  const root = dom(html);

  it("wraps the document in the editor's surface and doc classes", () => {
    expect(html).toMatch(/^<div class="ucomp-surface ucomp-redline relative"[^>]*><div class="ucomp-doc">/);
  });

  it("renders insertions as <ins> with the positive tokens", () => {
    const ins = [...root.querySelectorAll('ins[data-redline-op="insert"]')];
    expect(ins.length).toBeGreaterThanOrEqual(2); // the chip and the new words
    const words = ins.find((el) => el.textContent === " for 12 months");
    expect(words?.className).toContain("bg-positive-soft");
    expect(words?.className).toContain("text-(--rl-ins-text)");
    expect(words?.className).toContain("underline");
  });

  it("renders deletions as <del> with the danger tokens and a strike", () => {
    const del = [...root.querySelectorAll('del[data-redline-op="delete"]')].find((el) => el.textContent === " for 6 months");
    expect(del).toBeDefined();
    expect(del?.className).toContain("text-danger-text");
    expect(del?.className).toContain("line-through");
  });

  it("keeps a marked variable a chip, labelled from the variable list", () => {
    const chip = root.querySelector('ins [data-variable="intro_apr"]');
    expect(chip?.textContent).toContain("Intro APR");
    expect(chip?.getAttribute("data-variable-type")).toBe("percent");
  });
});

describe("RedlineDocument: hard breaks", () => {
  it("shows the empty line after a paragraph's last hard break, as the editor does", () => {
    const br = { type: "hardBreak" };
    const doc = {
      counts: { added: 0, removed: 0, changed: 0, moved: 0 },
      blocks: [{ id: "a", status: "unchanged" as const, node: { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "x" }, br, { type: "text", text: "y" }, br] } }],
    };
    const out = renderToStaticMarkup(<RedlineDocument doc={doc} variables={[]} />);
    expect(out).toContain('x<br/>y<br/><br class="ProseMirror-trailingBreak"/></p>');
  });
});

describe("RedlineDocument: blocks", () => {
  const root = dom(html);
  const frame = (status: string) => root.querySelector(`[data-redline="${status}"]`) as HTMLElement;

  it("marks an added block with a positive bar, in an <ins>", () => {
    const added = frame("added");
    expect(added.getAttribute("aria-label")).toBe("Added block");
    expect(added.querySelector('[data-slot="redline-bar"]')?.className).toContain("bg-positive");
    expect(added.querySelector("ins")?.textContent).toBe("A balance transfer fee of 3% applies.");
  });

  it("strikes a removed block whole (text and chip) and gives it a danger bar", () => {
    const removed = frame("removed");
    expect(removed.getAttribute("aria-label")).toBe("Removed block");
    expect(removed.querySelector('[data-slot="redline-bar"]')?.className).toContain("bg-danger");
    const struck = [...removed.querySelectorAll("del")].map((el) => el.textContent);
    expect(struck.join("")).toContain("There is no annual fee for the first year, ");
    expect(removed.querySelector('del [data-variable="annual_fee"]')).not.toBeNull();
    expect(removed.querySelectorAll("ins")).toHaveLength(0);
  });

  it("labels a moved block in the gutter, and a changed block with a neutral bar", () => {
    const moved = frame("moved");
    expect(moved.getAttribute("aria-label")).toBe("Moved block");
    expect(moved.querySelector('[data-slot="redline-label"]')?.textContent).toBe("Moved");
    const changed = frame("changed");
    expect(changed.getAttribute("aria-label")).toBe("Changed block");
    expect(changed.querySelector('[data-slot="redline-bar"]')?.className).toContain("bg-text-subtle");
  });

  it("leaves unchanged blocks plain: no group, no gutter", () => {
    const unchanged = root.querySelectorAll('[data-redline="unchanged"]');
    expect(unchanged).toHaveLength(4);
    for (const el of unchanged) {
      expect(el.getAttribute("role")).toBeNull();
      expect(el.querySelector('[data-slot^="redline-"]')).toBeNull();
    }
  });

  it("keeps reading order, with headings as headings", () => {
    const order = [...root.querySelectorAll("[data-redline]")].map((el) => el.getAttribute("data-redline"));
    expect(order).toEqual(["unchanged", "unchanged", "unchanged", "changed", "added", "removed", "moved", "unchanged"]);
    expect(root.querySelectorAll("h2")).toHaveLength(2);
    expect(frame("moved").getAttribute("data-kind")).toBe("h2");
  });

  it("hides the decorations from the accessibility tree (the group's label speaks for them)", () => {
    for (const el of root.querySelectorAll('[data-slot^="redline-"]')) expect(el.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("RedlineDocument: block ids", () => {
  const root = dom(html);

  it("gives every top-level block's frame its id, and nothing else a block id", () => {
    const ids = [...root.querySelectorAll("[data-block-id]")].map((el) => el.getAttribute("data-block-id"));
    expect(ids).toEqual(REDLINE_DOC.blocks.map((b) => b.id));
    // Frames are the direct children of the document, so a host can find them by `.ucomp-doc > [data-block-id]`.
    expect(root.querySelectorAll(".ucomp-doc > [data-block-id]")).toHaveLength(REDLINE_DOC.blocks.length);
  });

  it("lets the document's hover comment button find a block (`data-id`), except a removed one", () => {
    const withId = [...root.querySelectorAll(".ucomp-doc > [data-id]")].map((el) => el.getAttribute("data-id"));
    expect(withId).toEqual(REDLINE_DOC.blocks.filter((b) => b.status !== "removed").map((b) => b.id));
  });

  it("marks the active block, and only that one", () => {
    const active = dom(renderToStaticMarkup(<RedlineDocument doc={REDLINE_DOC} variables={REDLINE_VARIABLES} activeBlockId="p-3" />));
    const marked = [...active.querySelectorAll("[data-active]")];
    expect(marked.map((el) => el.getAttribute("data-block-id"))).toEqual(["p-3"]);
    expect(root.querySelectorAll("[data-active]")).toHaveLength(0);
  });

  it("keeps the ids with Changes only", () => {
    const only = dom(renderToStaticMarkup(<RedlineDocument doc={REDLINE_DOC} variables={REDLINE_VARIABLES} changesOnly />));
    expect([...only.querySelectorAll("[data-block-id]")].map((el) => el.getAttribute("data-block-id"))).toEqual(["p-3", "p-4", "p-5", "h-2"]);
  });
});

describe("RedlineDocument: changes only", () => {
  const trimmed = dom(renderToStaticMarkup(<RedlineDocument doc={REDLINE_DOC} variables={REDLINE_VARIABLES} changesOnly />));
  const order = (root: HTMLElement) =>
    [...root.querySelectorAll("[data-redline], [data-redline-gap], [data-redline-caption]")].map((el) =>
      el.hasAttribute("data-redline-gap") ? "gap" : el.hasAttribute("data-redline-caption") ? "caption" : el.getAttribute("data-redline"),
    );

  it("names the section over its changes: an unchanged heading becomes a caption, not a heading", () => {
    expect([...trimmed.querySelectorAll("[data-redline-caption]")].map((el) => el.textContent)).toEqual(["Offer details"]);
    expect(trimmed.querySelector("[data-redline-caption]")?.className).toContain("caps-label");
    // The unchanged "Offer details" heading is gone as a heading; the heading that moved is still one.
    expect([...trimmed.querySelectorAll("h2")].map((el) => el.textContent)).toEqual(["Legal notices"]);
  });

  it("counts each run of unchanged blocks on a quiet line, headings not counted", () => {
    const gaps = [...trimmed.querySelectorAll("[data-redline-gap]")].map((el) => el.textContent);
    expect(gaps).toEqual(["2 unchanged blocks", "1 unchanged block"]);
    expect(trimmed.querySelectorAll('[data-redline="unchanged"]')).toHaveLength(0);
    expect(trimmed.querySelector("[data-redline-gap]")?.className).not.toContain("flex");
  });

  it("keeps every changed block, in place: caption, the count of what's unchanged above the first change, the changes, the trailing count", () => {
    expect(order(trimmed)).toEqual(["caption", "gap", "changed", "added", "removed", "moved", "gap"]);
  });

  it("renders only a caption and a count when nothing changed", () => {
    const same: RedlineBlock[] = REDLINE_DOC.blocks.map((b) => ({ ...b, status: "unchanged" as const }));
    const out = dom(
      renderToStaticMarkup(
        <RedlineDocument doc={{ blocks: same, counts: { added: 0, removed: 0, changed: 0, moved: 0 } }} variables={REDLINE_VARIABLES} changesOnly />,
      ),
    );
    // Two sections: "Offer details" (2 paragraphs and the changed-looking ones now unchanged) and "Legal notices".
    expect([...out.querySelectorAll("[data-redline-caption]")].map((el) => el.textContent)).toEqual(["Offer details", "Legal notices"]);
    expect([...out.querySelectorAll("[data-redline-gap]")].map((el) => el.textContent)).toEqual(["5 unchanged blocks", "1 unchanged block"]);
  });

  it("renders an empty document without throwing", () => {
    const out = renderToStaticMarkup(<RedlineDocument doc={{ blocks: [], counts: { added: 0, removed: 0, changed: 0, moved: 0 } }} variables={[]} />);
    expect(out).toContain("ucomp-doc");
  });
});

describe("groupBlocks", () => {
  const block = (id: string, status: RedlineBlock["status"]): RedlineBlock => ({ id, status, node: { type: "paragraph", attrs: { id } } });
  const heading = (id: string, text: string, status: RedlineBlock["status"] = "unchanged"): RedlineBlock => ({
    id,
    status,
    node: { type: "heading", attrs: { id, level: 2 }, content: [{ type: "text", text }] },
  });

  const doc = (blocks: RedlineBlock[]) => ({ blocks, counts: { added: 0, removed: 0, changed: 0, moved: 0 } });
  const show = (items: ReturnType<typeof groupBlocks>) =>
    items.map((i) => (i.type === "gap" ? `gap:${i.count}` : i.type === "caption" ? `caption:${i.text}` : i.block.id));

  it("returns every block when changes-only is off", () => {
    expect(groupBlocks(doc([block("a", "unchanged"), block("b", "added")]), false)).toHaveLength(2);
  });

  it("merges adjacent unchanged blocks and keeps separate runs apart", () => {
    const items = groupBlocks(
      doc([block("a", "unchanged"), block("b", "unchanged"), block("c", "changed"), block("d", "unchanged"), block("e", "removed")]),
      true,
    );
    expect(show(items)).toEqual(["gap:2", "c", "gap:1", "e"]);
  });

  it("captions the changes with the nearest heading above them, once per section", () => {
    const items = groupBlocks(
      doc([
        heading("h1", "Offer details"),
        block("a", "changed"),
        block("b", "added"),
        heading("h2", "Rates and fees"),
        block("c", "unchanged"),
        block("d", "changed"),
        heading("h3", "Legal notices"),
        block("e", "removed"),
        block("f", "unchanged"),
      ]),
      true,
    );
    expect(show(items)).toEqual([
      "caption:Offer details",
      "a",
      "b",
      "caption:Rates and fees",
      "gap:1",
      "d",
      "caption:Legal notices",
      "e",
      "gap:1",
    ]);
  });

  it("gives a section with nothing changed its caption and a count, and a section with nothing in it neither", () => {
    expect(show(groupBlocks(doc([heading("h1", "A"), block("a", "unchanged"), block("b", "unchanged"), heading("h2", "B"), heading("h3", "C")]), true))).toEqual([
      "caption:A",
      "gap:2",
    ]);
  });

  it("paints a heading that changed as the change, and it is its own caption", () => {
    const items = groupBlocks(doc([heading("h1", "Offer details"), block("a", "unchanged"), heading("h2", "Fees", "changed"), block("b", "changed")]), true);
    expect(show(items)).toEqual(["caption:Offer details", "gap:1", "h2", "b"]);
  });

  it("starts without a caption before the first heading, and reads a chip in a heading as its label", () => {
    const withChip: RedlineBlock = {
      id: "h1",
      status: "unchanged",
      node: { type: "heading", attrs: { id: "h1", level: 2 }, content: [{ type: "text", text: "About " }, { type: "variable", attrs: { key: "product" } }] },
    };
    const items = groupBlocks(doc([block("a", "changed"), withChip, block("b", "changed")]), true, new Map([["product", "Product name"]]));
    expect(show(items)).toEqual(["a", "caption:About Product name", "b"]);
  });
});

describe("groupBlocks: hidden blocks and comment markers", () => {
  const block = (id: string, status: RedlineBlock["status"]): RedlineBlock => ({ id, status, node: { type: "paragraph", attrs: { id } } });
  const heading = (id: string, text: string, status: RedlineBlock["status"] = "unchanged"): RedlineBlock => ({
    id,
    status,
    node: { type: "heading", attrs: { id, level: 2 }, content: text ? [{ type: "text", text }] : [] },
  });
  const doc = (blocks: RedlineBlock[]) => ({ blocks, counts: { added: 0, removed: 0, changed: 0, moved: 0 } });
  const show = (items: ReturnType<typeof groupBlocks>) =>
    items.map((i) => (i.type === "gap" ? `gap:${i.count}` : i.type === "caption" ? `caption:${i.text}` : i.block.id));
  const hidden = (items: ReturnType<typeof groupBlocks>) => items.map((i) => (i.hidden ?? []).join(","));

  const SECTIONS = doc([
    heading("t", "Title"),
    heading("h1", "Offer details"),
    block("a", "unchanged"),
    block("b", "unchanged"),
    block("c", "changed"),
    block("d", "unchanged"),
    heading("h2", "Rates"),
    heading("h3", ""),
    block("e", "unchanged"),
    heading("h4", "Legal"),
  ]);

  it("records every hidden block on the caption or count that stands in for it", () => {
    const items = groupBlocks(SECTIONS, true);
    expect(show(items)).toEqual(["caption:Offer details", "gap:2", "c", "gap:1", "gap:1"]);
    // A heading that shows nowhere (the title, one an empty heading replaces, a trailing one) rides on
    // the next line painted, or the last.
    expect(hidden(items)).toEqual(["t,h1", "a,b", "", "d", "h2,h3,e,h4"]);
    // Every unchanged block is placed exactly once.
    const hosts = collapsedHosts(items);
    expect([...hosts.keys()].sort()).toEqual(["a", "b", "d", "e", "h1", "h2", "h3", "h4", "t"]);
    expect(hosts.get("a")).toBe("collapsed:a");
    expect(hosts.get("b")).toBe("collapsed:a");
    expect(hosts.get("t")).toBe("collapsed:t");
    expect(hosts.get("h4")).toBe("collapsed:h2");
    expect(hosts.has("c")).toBe(false);
  });

  it("puts a heading that shows nowhere on the next block painted when no line comes first", () => {
    const items = groupBlocks(doc([heading("t", "Title"), heading("h", "Fees", "changed"), block("x", "changed")]), true);
    expect(show(items)).toEqual(["h", "x"]);
    expect(hidden(items)).toEqual(["t", ""]);
    expect(collapsedHosts(items).get("t")).toBe("h"); // shares the changed heading's marker
    expect(hostKey(items[0])).toBe("h");
  });

  it("reveals the block of the thread being read, splitting its run", () => {
    const items = groupBlocks(SECTIONS, true, undefined, "a");
    expect(show(items)).toEqual(["caption:Offer details", "a", "gap:1", "c", "gap:1", "gap:1"]);
    expect(collapsedHosts(items).has("a")).toBe(false);
    expect(collapsedHosts(items).get("b")).toBe("collapsed:b");
  });

  it("reveals an unchanged heading as itself, not a caption", () => {
    const items = groupBlocks(SECTIONS, true, undefined, "h1");
    expect(show(items)).toEqual(["h1", "gap:2", "c", "gap:1", "gap:1"]);
    expect(hidden(items)[0]).toBe("t");
  });

  it("is a no-op with Changes only off", () => {
    expect(collapsedHosts(groupBlocks(SECTIONS, false, undefined, "a")).size).toBe(0);
  });

  it("puts the hidden blocks and the line's key on the caption and count elements", () => {
    const root = dom(renderToStaticMarkup(<RedlineDocument doc={REDLINE_DOC} variables={REDLINE_VARIABLES} changesOnly />));
    const gaps = [...root.querySelectorAll("[data-redline-gap]")];
    expect(gaps.map((g) => [g.getAttribute("data-hidden-blocks"), g.getAttribute("data-collapsed")])).toEqual([
      ["p-1 p-2", "collapsed:p-1"],
      ["p-6", "collapsed:p-6"],
    ]);
    expect(root.querySelector("[data-redline-caption]")?.getAttribute("data-hidden-blocks")).toBe("h-1");
    // The active block shows in place even though it didn't change.
    const revealed = dom(renderToStaticMarkup(<RedlineDocument doc={REDLINE_DOC} variables={REDLINE_VARIABLES} changesOnly activeBlockId="p-2" />));
    expect(revealed.querySelector('[data-block-id="p-2"]')?.hasAttribute("data-active")).toBe(true);
    expect([...revealed.querySelectorAll("[data-redline-gap]")].map((g) => g.textContent)).toEqual(["1 unchanged block", "1 unchanged block"]);
  });
});

describe("helpers", () => {
  it("counts unchanged blocks with the right number", () => {
    expect(gapLabel(1)).toBe("1 unchanged block");
    expect(gapLabel(4)).toBe("4 unchanged blocks");
  });

  it("reads the diff's counts as one sentence fragment", () => {
    expect(redlineSummary({ added: 2, removed: 1, changed: 3, moved: 0 })).toBe("2 added, 1 removed, and 3 changed");
    expect(redlineSummary({ added: 0, removed: 0, changed: 2, moved: 1 })).toBe("2 changed and 1 moved");
    expect(redlineSummary({ added: 0, removed: 1, changed: 0, moved: 0 })).toBe("1 removed");
    expect(redlineSummary({ added: 0, removed: 0, changed: 0, moved: 0 })).toBe("No changes");
    expect(joinAnd(["a", "b", "c", "d"])).toBe("a, b, c, and d");
  });

  it("finds the block kind the layout depends on", () => {
    expect(blockKind({ type: "heading", attrs: { level: 1 } })).toBe("h1");
    expect(blockKind({ type: "heading", attrs: { level: 3 } })).toBe("h3");
    expect(blockKind({ type: "heading", attrs: { level: 2 } })).toBe("h2");
    expect(blockKind({ type: "horizontalRule" })).toBe("hr");
    expect(blockKind({ type: "table" })).toBe("block");
  });

  it("marks every run and chip deleted without touching the input", () => {
    const node: JSONContent = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "bold" }] }, { type: "variable", attrs: { key: "k" } }] }],
        },
      ],
    };
    const copy = JSON.stringify(node);
    const out = markAllDeleted(node);
    const inline = out.content![0].content![0].content!;
    expect(inline[0].marks).toEqual([{ type: "bold" }, { type: "redline", attrs: { op: "delete" } }]);
    expect(inline[1].marks).toEqual([{ type: "redline", attrs: { op: "delete" } }]);
    expect(JSON.stringify(node)).toBe(copy);
  });
});
