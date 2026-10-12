import { describe, expect, it } from "vitest";
import { diffDocuments } from "./document";
import type { JSONContent } from "../types";
import {
  p,
  li,
  list,
  ul,
  table,
  callout,
  doc,
  isTextblock,
  show,
  expectFaithful,
} from "./fixtures";

const ol = (id: string | null, items: (string | JSONContent)[]) =>
  list("orderedList", id, items);

/** Every textblock inside the node, shown, in reading order. */
function lines(node: JSONContent): string[] {
  return isTextblock(node) ? [show(node)] : (node.content ?? []).flatMap(lines);
}

describe("diffDocuments: nested blocks", () => {
  it("lines up list items by their text: added, removed and edited", () => {
    const base = doc(
      ul("l", [
        "Transfers must post within 60 days.",
        "Balances from other Coral accounts are not eligible.",
        "Fees apply.",
      ]),
    );
    const next = doc(
      ul("l", [
        "Transfers must post within 90 days.",
        "Fees apply.",
        "The amount can't exceed your credit line.",
      ]),
    );
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(lines(red.blocks[0].node)).toEqual([
      "Transfers must post within [-60-]{+90+} days.",
      "[-Balances from other Coral accounts are not eligible.-]",
      "Fees apply.",
      "{+The amount can't exceed your credit line.+}",
    ]);
    expect(red.blocks[0].node.content!.map((item) => item.type)).toEqual([
      "listItem",
      "listItem",
      "listItem",
      "listItem",
    ]);
    expectFaithful(base, next, red);
  });

  it("lines up list items by id when they have one", () => {
    const base = doc(ul("l", [li("Alpha.", "i1"), li("Beta.", "i2")]));
    const next = doc(
      ul("l", [li("Gamma.", "i1"), li("Beta.", "i2"), li("Delta.", "i3")]),
    );
    const red = diffDocuments(base, next);
    expect(lines(red.blocks[0].node)).toEqual([
      "[-Alpha-]{+Gamma+}.",
      "Beta.",
      "{+Delta.+}",
    ]);
    expectFaithful(base, next, red);
  });

  it("diffs a nested list inside a list item", () => {
    const nested = (second: string) =>
      doc(
        ul("l", [
          {
            type: "listItem",
            content: [p(null, "Outer."), ol(null, ["First.", second])],
          },
        ]),
      );
    const red = diffDocuments(nested("Second one."), nested("Second two."));
    expect(lines(red.blocks[0].node)).toEqual([
      "Outer.",
      "First.",
      "Second [-one-]{+two+}.",
    ]);
  });

  it("marks a whole list when its type changes", () => {
    const base = doc(ul("l", ["One.", "Two."]));
    const next = doc(ol("l", ["One.", "Two."]));
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(red.blocks[0].node.type).toBe("orderedList");
    expect(lines(red.blocks[0].node)).toEqual(["{+One.+}", "{+Two.+}"]);
    expectFaithful(base, next, red, { reject: false });
  });

  it("diffs a table: a cell edited and a row added", () => {
    const base = doc(
      table(
        "t",
        ["Rate or fee", "What you pay"],
        [
          ["Annual fee", "$0"],
          ["Late fee", "Up to $40"],
        ],
      ),
    );
    const next = doc(
      table(
        "t",
        ["Rate or fee", "What you pay"],
        [
          ["Annual fee", "$95"],
          ["Late fee", "Up to $40"],
          ["Returned payment", "Up to $40"],
        ],
      ),
    );
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(lines(red.blocks[0].node)).toEqual([
      "Rate or fee",
      "What you pay",
      "Annual fee",
      "$[-0-]{+95+}",
      "Late fee",
      "Up to $40",
      "{+Returned payment+}",
      "{+Up to $40+}",
    ]);
    expectFaithful(base, next, red);
  });

  it("finds a row inserted mid-table next to an edited one", () => {
    const base = doc(
      table(
        "t",
        ["Fee", "Amount"],
        [
          ["Annual fee", "$0"],
          ["Late fee", "Up to $40"],
        ],
      ),
    );
    const next = doc(
      table(
        "t",
        ["Fee", "Amount"],
        [
          ["Annual fee", "$0"],
          ["Foreign transaction fee", "3%"],
          ["Late fee", "Up to $41"],
        ],
      ),
    );
    const red = diffDocuments(base, next);
    expect(lines(red.blocks[0].node)).toEqual([
      "Fee",
      "Amount",
      "Annual fee",
      "$0",
      "{+Foreign transaction fee+}",
      "{+3%+}",
      "Late fee",
      "Up to $[-40-]{+41+}",
    ]);
    expectFaithful(base, next, red);
  });

  it("diffs a callout's paragraphs", () => {
    const base = doc(
      callout(
        "c",
        "Interest starts on the transaction date.",
        "Talk to a tax advisor.",
      ),
    );
    const next = doc(
      callout(
        "c",
        "Interest starts on the posting date.",
        "Talk to a tax advisor.",
        "Keep your receipts.",
      ),
    );
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(lines(red.blocks[0].node)).toEqual([
      "Interest starts on the [-transaction-]{+posting+} date.",
      "Talk to a tax advisor.",
      "{+Keep your receipts.+}",
    ]);
    expectFaithful(base, next, red);
  });
});
