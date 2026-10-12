import { describe, expect, it } from "vitest";
import { diffDocuments } from "./document";
import type { JSONContent } from "../types";
import {
  NO_CHANGES,
  p,
  h,
  doc,
  opOf,
  show,
  expectFaithful,
  statuses,
} from "./fixtures";

const bold = (text: string): JSONContent => ({
  type: "text",
  text,
  marks: [{ type: "bold" }],
});

describe("diffDocuments: inside a paragraph", () => {
  it("marks word edits mid-paragraph", () => {
    const base = doc(p("a", "Pay 0% intro APR for 12 months on transfers."));
    const next = doc(
      p("a", "Pay 0% intro APR for 15 months on all transfers."),
    );
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(show(red.blocks[0].node)).toBe(
      "Pay 0% intro APR for [-12-]{+15+} months on{+ all+} transfers.",
    );
    expect(red.counts).toEqual({ ...NO_CHANGES, changed: 1 });
    expectFaithful(base, next, red);
  });

  it("keeps numbers and contractions whole, and joins neighbouring word swaps", () => {
    const base = doc(
      p("a", "Earn 25,000 points. It isn't taxable."),
      p("b", "Pay a fee."),
    );
    const next = doc(
      p("a", "Earn 20,000 points. It is taxable."),
      p("b", "Pay no charge."),
    );
    const red = diffDocuments(base, next);
    expect(show(red.blocks[0].node)).toBe(
      "Earn [-25,000-]{+20,000+} points. It [-isn't-]{+is+} taxable.",
    );
    expect(show(red.blocks[1].node)).toBe("Pay [-a fee-]{+no charge+}.");
    expectFaithful(base, next, red);
  });

  it("treats a chip as one token: inserted, removed and replaced", () => {
    const base = doc(
      p("a", "Your APR is 20% today."),
      p("b", "Hi {first_name}, welcome aboard."),
      p("c", "Dear {first_name},"),
    );
    const next = doc(
      p("a", "Your APR is {purchase_apr} today."),
      p("b", "Hi, welcome aboard."),
      p("c", "Dear {last_name},"),
    );
    const red = diffDocuments(base, next);
    expect(red.blocks.map((b) => show(b.node))).toEqual([
      "Your APR is [-20%-]{+{{purchase_apr}}+} today.",
      "Hi[- -][-{{first_name}}-], welcome aboard.",
      "Dear [-{{first_name}}-]{+{{last_name}}+},",
    ]);
    // Chips stay variable nodes, carrying the mark.
    const chip = red.blocks[0].node.content!.find(
      (x) => x.type === "variable",
    )!;
    expect(chip).toEqual({
      type: "variable",
      attrs: { key: "purchase_apr" },
      marks: [{ type: "redline", attrs: { op: "insert" } }],
    });
    expect(red.counts).toEqual({ ...NO_CHANGES, changed: 3 });
    expectFaithful(base, next, red);
  });

  it("counts bold added to existing words as a change: the plain run deleted, the bold one inserted", () => {
    const base = doc(p("a", "Pay by the due date each month."));
    const next = doc(p("a", "Pay by the ", bold("due date"), " each month."));
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(show(red.blocks[0].node)).toBe(
      "Pay by the [-due date-]{+**due date**+} each month.",
    );
    // One merged run per side, the bold one keeping its mark under the redline.
    const inserted = red.blocks[0].node.content!.find(
      (x) => opOf(x) === "insert",
    )!;
    expect(inserted).toEqual({
      type: "text",
      text: "due date",
      marks: [{ type: "bold" }, { type: "redline", attrs: { op: "insert" } }],
    });
    expectFaithful(base, next, red);
  });

  it("counts a link's new href as a change", () => {
    const link = (href: string): JSONContent => ({
      type: "text",
      text: "the terms",
      marks: [{ type: "link", attrs: { href } }],
    });
    const red = diffDocuments(
      doc(p("a", "Read ", link("https://a.example"), ".")),
      doc(p("a", "Read ", link("https://b.example"), ".")),
    );
    expect(show(red.blocks[0].node)).toBe("Read [-the terms-]{+the terms+}.");
  });

  it("marks a whole heading when its level changes", () => {
    const base = doc(h("h", 2, "Fees"), h("g", 2, "Fees"), p("x", "Important"));
    const next = doc(
      h("h", 3, "Fees"),
      h("g", 3, "Fees and charges"),
      h("x", 3, "Important"),
    );
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["h:changed", "g:changed", "x:changed"]);
    expect(red.blocks.map((b) => show(b.node))).toEqual([
      "{+Fees+}",
      "[-Fees-]{+Fees and charges+}",
      "{+Important+}",
    ]);
    expect(red.blocks[0].node.attrs).toEqual({
      id: "h",
      level: 3,
      requiredKey: null,
    });
    expect(red.blocks[2].node.type).toBe("heading");
    expectFaithful(base, next, red, { reject: false });
  });
});
