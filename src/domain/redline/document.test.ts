import { describe, expect, it } from "vitest";
import { changesOnly, diffDocuments, groupUnchanged, nameChange } from "./document";
import type { JSONContent } from "../types";
import {
  NO_CHANGES,
  p,
  h,
  ul,
  table,
  callout,
  doc,
  show,
  expectFaithful,
  statuses,
  block,
  EVERYTHING,
} from "./fixtures";

describe("diffDocuments: edge cases", () => {
  it("falls back to content when blocks have no ids", () => {
    const base = doc(h(null, 2, "Offer details", "offer_details"), p(null, "Alpha one."), p(null, "Beta two three four."), p(null, "Gamma."));
    // The editor gave every block an id when the old content was opened.
    const next = doc(h("h", 2, "Offer details", "offer_details"), p("a", "Alpha one."), p("b", "Beta two three five."), p("d", "Delta."));
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["h:unchanged", "a:unchanged", "b:changed", "base:3:removed", "d:added"]);
    expect(show(block(red, "b").node)).toBe("Beta two three [-four-]{+five+}.");
    expectFaithful(base, next, red);

    // Neither side has ids: positions name the blocks.
    const bare = diffDocuments(base, doc(h(null, 2, "Offer details", "offer_details"), p(null, "Gamma."), p(null, "Alpha one.")));
    expect(statuses(bare)).toEqual(["next:0:unchanged", "next:1:moved", "next:2:unchanged", "base:2:removed"]);
  });

  it("handles empty documents", () => {
    expect(diffDocuments(doc(), doc())).toEqual({ blocks: [], counts: NO_CHANGES });
    expect(statuses(diffDocuments({ type: "doc" }, doc(p("a", "Hello."))))).toEqual(["a:added"]);
    // The editor's empty document is one empty line.
    expect(statuses(diffDocuments(doc(p("a", "Hello.")), doc(p("t"))))).toEqual(["a:removed"]);
  });

  it("ignores the editor's trailing empty line", () => {
    const red = diffDocuments(doc(p("a", "Hello.")), doc(p("a", "Hello."), p("t")));
    expect(statuses(red)).toEqual(["a:unchanged"]);
    expect(red.counts).toEqual(NO_CHANGES);
  });

  it("with no base, shows every block unchanged with zero counts", () => {
    const red = diffDocuments(null, EVERYTHING);
    expect(red.counts).toEqual(NO_CHANGES);
    expect(red.blocks.every((b) => b.status === "unchanged")).toBe(true);
    red.blocks.forEach((b, k) => expect(b.node).toBe(EVERYTHING.content![k]));
    expect(groupUnchanged(red)).toEqual([{ type: "gap", count: 7 }]);
  });

  it("leaves a required-section heading unchanged around changes", () => {
    const base = doc(
      h("h1", 2, "Offer details", "offer_details"),
      p("a", "Earn 2% cash back."),
      p("b", "Old terms."),
      h("h2", 2, "Rates and fees", "rates_and_fees"),
      p("c", "Your APR is {purchase_apr}."),
      h("h3", 2, "Legal notices", "legal_notices"),
      p("z", "Coral Bank."),
    );
    const next = doc(
      h("h1", 2, "Offer details", "offer_details"),
      p("a", "Earn 3% cash back."),
      h("h2", 2, "Rates and fees", "rates_and_fees"),
      p("n", "A new fee note."),
      p("c", "Your APR is {purchase_apr}."),
      h("h3", 2, "Legal notices", "legal_notices"),
      p("z", "Coral Bank."),
    );
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["h1:unchanged", "a:changed", "b:removed", "h2:unchanged", "n:added", "c:unchanged", "h3:unchanged", "z:unchanged"]);
    for (const id of ["h1", "h2", "h3"]) {
      expect(block(red, id).node).toBe(next.content!.find((b) => b.attrs?.id === id));
      expect(block(red, id).node.attrs?.requiredKey).toBeTruthy();
    }
    expect(show(block(red, "a").node)).toBe("Earn [-2-]{+3+}% cash back.");
    expectFaithful(base, next, red);
  });
});

describe("changesOnly and groupUnchanged", () => {
  const base = doc(p("a", "Alpha one."), p("b", "Beta two."), p("c", "Gamma three."), p("d", "Delta four."), p("e", "Epsilon five."));
  const next = doc(p("a", "Alpha one, edited."), p("b", "Beta two."), p("c", "Gamma three."), p("e", "Epsilon five."), p("f", "Phi six."));
  const red = diffDocuments(base, next);

  it("changesOnly keeps the changed blocks, in order", () => {
    expect(changesOnly(red).map((b) => `${b.id}:${b.status}`)).toEqual(["a:changed", "d:removed", "f:added"]);
    expect(changesOnly(red)).toHaveLength(red.counts.added + red.counts.removed + red.counts.changed + red.counts.moved);
  });

  it("groupUnchanged folds each run of unchanged blocks into a gap", () => {
    expect(groupUnchanged(red).map((x) => ("status" in x ? `${x.id}:${x.status}` : `gap ${x.count}`))).toEqual([
      "a:changed",
      "gap 2",
      "d:removed",
      "gap 1",
      "f:added",
    ]);
    const tail = diffDocuments(doc(p("a", "One."), p("b", "Two."), p("c", "Three.")), doc(p("a", "One!"), p("b", "Two."), p("c", "Three.")));
    expect(groupUnchanged(tail)).toEqual([tail.blocks[0], { type: "gap", count: 2 }]);
  });
});

const WORDS = "the card account balance transfer purchase statement credit annual fee interest rate payment due date offer bonus points cash back eligible new".split(" ");
/** Different for every seed (the number at the end), so no two blocks are identical. */
const sentence = (seed: number, length: number) =>
  Array.from({ length }, (_, k) => WORDS[(seed * 7 + k * 3 + Math.floor(k / 5)) % WORDS.length]).join(" ") + ` ${seed}.`;

/** About three pages: 60 blocks of paragraphs, lists, tables and callouts under required sections. */
function threePages(withIds: boolean): JSONContent {
  const id = (k: number) => (withIds ? `b${k}` : null);
  const blocks: JSONContent[] = [];
  for (let k = 0; k < 60; k++) {
    if (k % 20 === 0) blocks.push(h(id(k), 2, `Section ${k / 20 + 1}`, `section_${k / 20}`));
    else if (k % 10 === 5) blocks.push(ul(id(k), [sentence(k, 12), sentence(k + 1, 15), sentence(k + 2, 9)]));
    else if (k % 15 === 7) blocks.push(table(id(k), ["Rate or fee", "What you pay"], [0, 1, 2, 3].map((r) => [sentence(k + r, 3), sentence(k + r + 9, 6)])));
    else if (k % 13 === 3) blocks.push(callout(id(k), sentence(k, 30), sentence(k + 4, 20)));
    else blocks.push(p(id(k), sentence(k, 45)));
  }
  return doc(...blocks);
}

/** Eight word edits, a table cell and a list item edited, one block added, one removed, one moved. */
function edited(base: JSONContent): JSONContent {
  const blocks = structuredClone(base.content!);
  const reword = (node: JSONContent) => {
    const text = node.content![0];
    text.text = String(text.text).replace(/ fee /, " charge ").replace(/^\w+/, "Updated");
  };
  for (const k of [1, 4, 9, 12, 18, 24, 33, 41]) if (blocks[k].type === "paragraph") reword(blocks[k]);
  reword(blocks[7].content![2].content![1].content![0]); // a table cell
  reword(blocks[5].content![1].content![0]); // a list item
  const [movedBlock] = blocks.splice(14, 1);
  blocks.splice(50, 0, movedBlock);
  blocks.splice(30, 1);
  blocks.splice(22, 0, p(base.content![1].attrs ? "added" : null, sentence(99, 25)));
  return doc(...blocks);
}

function medianMs(base: JSONContent, next: JSONContent): number {
  for (let k = 0; k < 5; k++) diffDocuments(base, next);
  const times: number[] = [];
  for (let k = 0; k < 31; k++) {
    const t0 = performance.now();
    diffDocuments(base, next);
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[15];
}

describe("speed", () => {
  // The target is 5 ms; the thresholds leave room for a slow, busy test machine.
  it("diffs a three-page document (60 blocks) in a few milliseconds", () => {
    const base = threePages(true);
    const next = edited(base);
    const red = diffDocuments(base, next);
    expect(red.counts.added).toBe(1);
    expect(red.counts.removed).toBe(1);
    expect(red.counts.moved + red.counts.changed).toBeGreaterThanOrEqual(10);
    expect(medianMs(base, next)).toBeLessThan(25);
  });

  it("stays quick when no block has an id (content matching)", () => {
    const base = threePages(false);
    const next = edited(base);
    expect(diffDocuments(base, next).counts.added).toBe(1);
    expect(medianMs(base, next)).toBeLessThan(25);
  });
});

describe("nameChange", () => {
  it("is the rename from the base version's name to the new one", () => {
    expect(nameChange("Rate Change Notice", "Rate Change Notice — 2027")).toEqual({ from: "Rate Change Notice", to: "Rate Change Notice — 2027" });
  });

  it("is null when the name is the same, or there is no base to compare with", () => {
    expect(nameChange("Rate Change Notice", "Rate Change Notice")).toBeNull();
    expect(nameChange(null, "Rate Change Notice")).toBeNull();
    expect(nameChange(undefined, "Rate Change Notice")).toBeNull();
  });

  it("compares as typed: a change of case or spacing is a rename customers see", () => {
    expect(nameChange("Rate change notice", "Rate Change Notice")).not.toBeNull();
    expect(nameChange("Rate Change Notice", "Rate Change  Notice")).not.toBeNull();
  });
});
