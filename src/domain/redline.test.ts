import { describe, expect, it } from "vitest";
import type { ChannelFields } from "./channel-fields";
import { addCounts, changesOnly, diffChannelFields, diffDocuments, groupUnchanged, nameChange, type FieldsRedline } from "./redline";
import type { RedlineDoc } from "./review-types";
import type { Channel, JSONContent } from "./types";

const NO_CHANGES = { added: 0, removed: 0, changed: 0, moved: 0 };

// ── Fixture builders ─────────────────────────────────────────────────────────

type Inline = string | JSONContent;

const v = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const bold = (text: string): JSONContent => ({ type: "text", text, marks: [{ type: "bold" }] });

/** Strings become text, with `{key}` as a chip. */
function inline(parts: Inline[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const part of parts) {
    if (typeof part !== "string") {
      out.push(part);
      continue;
    }
    for (const piece of part.split(/(\{[a-z_]+\})/)) {
      if (!piece) continue;
      const chip = /^\{([a-z_]+)\}$/.exec(piece);
      out.push(chip ? v(chip[1]) : { type: "text", text: piece });
    }
  }
  return out;
}

const idAttrs = (id: string | null) => (id ? { attrs: { id } } : {});

function p(id: string | null, ...parts: Inline[]): JSONContent {
  const content = inline(parts);
  return { type: "paragraph", ...idAttrs(id), ...(content.length > 0 ? { content } : {}) };
}

function h(id: string | null, level: number, text: string, requiredKey: string | null = null): JSONContent {
  return { type: "heading", attrs: { ...(id ? { id } : {}), level, requiredKey }, content: inline([text]) };
}

const li = (text: string, id: string | null = null): JSONContent => ({ type: "listItem", ...idAttrs(id), content: [p(null, text)] });

function list(type: "bulletList" | "orderedList", id: string | null, items: (string | JSONContent)[]): JSONContent {
  return { type, ...idAttrs(id), content: items.map((item) => (typeof item === "string" ? li(item) : item)) };
}
const ul = (id: string | null, items: (string | JSONContent)[]) => list("bulletList", id, items);
const ol = (id: string | null, items: (string | JSONContent)[]) => list("orderedList", id, items);

function table(id: string | null, header: string[], rows: string[][]): JSONContent {
  return {
    type: "table",
    ...idAttrs(id),
    content: [
      { type: "tableRow", content: header.map((cell) => ({ type: "tableHeader", content: [p(null, cell)] })) },
      ...rows.map((row) => ({ type: "tableRow", content: row.map((cell) => ({ type: "tableCell", content: [p(null, cell)] })) })),
    ],
  };
}

const callout = (id: string | null, ...paragraphs: string[]): JSONContent => ({
  type: "callout",
  ...idAttrs(id),
  content: paragraphs.map((text) => p(null, text)),
});

const hr = (id: string | null): JSONContent => ({ type: "horizontalRule", ...idAttrs(id) });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

// ── Readers ──────────────────────────────────────────────────────────────────

const isTextblock = (node: JSONContent) => node.type === "paragraph" || node.type === "heading";
const opOf = (x: JSONContent): unknown => x.marks?.find((m) => m.type === "redline")?.attrs?.op;

/** A textblock's inline content with the redline drawn in: [-deleted-] {+inserted+}, chips {{key}}, bold **x**. */
function show(node: JSONContent): string {
  return (node.content ?? [])
    .map((x) => {
      let s = x.type === "variable" ? `{{${x.attrs?.key}}}` : x.type === "text" ? String(x.text) : `<${x.type}>`;
      if (x.marks?.some((m) => m.type === "bold")) s = `**${s}**`;
      const op = opOf(x);
      return op === "delete" ? `[-${s}-]` : op === "insert" ? `{+${s}+}` : s;
    })
    .join("");
}

/** Every textblock inside the node, shown, in reading order. */
function lines(node: JSONContent): string[] {
  return isTextblock(node) ? [show(node)] : (node.content ?? []).flatMap(lines);
}

/** Plain text of every non-empty textblock, leaving out inline nodes marked `drop`. */
function plain(node: JSONContent, drop?: "delete" | "insert"): string[] {
  if (!isTextblock(node)) return (node.content ?? []).flatMap((child) => plain(child, drop));
  const text = (node.content ?? [])
    .filter((x) => drop === undefined || opOf(x) !== drop)
    .map((x) => (x.type === "variable" ? `{{${x.attrs?.key}}}` : (x.text ?? "")))
    .join("");
  return text ? [text] : [];
}

/**
 * The redline loses nothing: accepting every change reads as `next`, rejecting every change reads as
 * `base` (when nothing moved and no kind changed). That the redline, minus its marks, is a valid editor
 * document is checked on the real seeded pairs in `src/server/seed/redline-seed.test.ts` (domain code
 * can't import the editor's schema).
 */
function expectFaithful(base: JSONContent, next: JSONContent, red: RedlineDoc, { reject = true } = {}) {
  const accepted = red.blocks.filter((b) => b.status !== "removed").flatMap((b) => plain(b.node, "delete"));
  expect(accepted).toEqual(plain(next));
  if (reject && red.blocks.every((b) => b.movedFrom === undefined)) {
    const rejected = red.blocks.filter((b) => b.status !== "added").flatMap((b) => plain(b.node, "insert"));
    expect(rejected).toEqual(plain(base));
  }
}

const statuses = (red: RedlineDoc) => red.blocks.map((b) => `${b.id}:${b.status}`);
const block = (red: RedlineDoc, id: string) => {
  const found = red.blocks.find((b) => b.id === id);
  if (!found) throw new Error(`no block ${id}`);
  return found;
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EVERYTHING = doc(
  h("h1", 2, "Offer details", "offer_details"),
  p("a", "Hi {first_name}, pay 0% intro APR for 12 months."),
  ul("l", ["Transfers must post within 60 days.", "Fees apply."]),
  table("t", ["Rate or fee", "What you pay"], [["Annual fee", "$0"]]),
  callout("c", "Interest starts on the transaction date."),
  hr("r"),
  p("z", "Coral Bank, N.A. Member FDIC."),
);

// ── Tests ────────────────────────────────────────────────────────────────────

describe("diffDocuments: whole blocks", () => {
  it("reports nothing when nothing changed, and hands back the blocks as they are", () => {
    const next = structuredClone(EVERYTHING);
    const red = diffDocuments(EVERYTHING, next);
    expect(red.counts).toEqual(NO_CHANGES);
    expect(statuses(red)).toEqual(["h1", "a", "l", "t", "c", "r", "z"].map((id) => `${id}:unchanged`));
    red.blocks.forEach((b, k) => expect(b.node).toBe(next.content![k]));
    expectFaithful(EVERYTHING, next, red);
  });

  it("ignores id noise, editor default attributes and a link's target", () => {
    const base = doc(
      p("a", { type: "text", text: "Read the terms", marks: [{ type: "link", attrs: { href: "https://coral.example/terms" } }] }, "."),
      ul("l", ["One.", "Two."]),
      table("t", ["Fee"], [["$0"]]),
      h("h", 2, "Rates and fees"),
    );
    const next = doc(
      p("a", { type: "text", text: "Read the terms", marks: [{ type: "link", attrs: { href: "https://coral.example/terms", target: "_blank", rel: "noopener noreferrer nofollow", class: null } }] }, "."),
      { type: "bulletList", attrs: { id: "l" }, content: [li("One.", "x1"), li("Two.", "x2")].map((item) => ({ ...item, content: [p("np" + String(item.attrs?.id), String(item.content![0].content![0].text))] })) },
      { type: "table", attrs: { id: "t" }, content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p("c1", "Fee")] }] }, { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p("c2", "$0")] }] }] },
      { type: "heading", attrs: { level: 2, id: "h" }, content: [{ type: "text", text: "Rates and fees" }] },
    );
    const red = diffDocuments(base, next);
    expect(red.counts).toEqual(NO_CHANGES);
  });

  it("finds a paragraph added", () => {
    const base = doc(p("a", "Alpha one."), p("b", "Beta two."));
    const next = doc(p("a", "Alpha one."), p("n", "New words."), p("b", "Beta two."));
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["a:unchanged", "n:added", "b:unchanged"]);
    expect(red.counts).toEqual({ ...NO_CHANGES, added: 1 });
    expect(block(red, "n").node).toBe(next.content![1]);
    expectFaithful(base, next, red);
  });

  it("finds a paragraph removed, and keeps it where it was", () => {
    const base = doc(p("a", "Alpha one."), p("b", "Beta two."), p("c", "Gamma three."));
    const next = doc(p("a", "Alpha one."), p("c", "Gamma three."));
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["a:unchanged", "b:removed", "c:unchanged"]);
    expect(block(red, "b").node).toBe(base.content![1]);
    expect(red.counts).toEqual({ ...NO_CHANGES, removed: 1 });
    expectFaithful(base, next, red);
  });

  it("finds a paragraph moved", () => {
    const base = doc(p("a", "Alpha one."), p("b", "Beta two."), p("c", "Gamma three."), p("d", "Delta four."));
    const next = doc(p("a", "Alpha one."), p("c", "Gamma three."), p("d", "Delta four."), p("b", "Beta two."));
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["a:unchanged", "c:unchanged", "d:unchanged", "b:moved"]);
    expect(block(red, "b").movedFrom).toBe(1);
    expect(block(red, "b").node).toBe(next.content![3]);
    expect(red.counts).toEqual({ ...NO_CHANGES, moved: 1 });
    expectFaithful(base, next, red);
  });

  it("reports a moved and edited paragraph as changed, with where it came from", () => {
    const base = doc(p("a", "Alpha one."), p("b", "Beta two."), p("c", "Gamma three."));
    const next = doc(p("b", "Beta two."), p("c", "Gamma three."), p("a", "Alpha one, edited."));
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["b:unchanged", "c:unchanged", "a:changed"]);
    expect(block(red, "a").movedFrom).toBe(0);
    expect(show(block(red, "a").node)).toBe("Alpha one{+, edited+}.");
    expect(red.counts).toEqual({ ...NO_CHANGES, changed: 1 });
    expectFaithful(base, next, red);
  });

  it("adds, removes and moves in one document", () => {
    const base = doc(p("a", "Alpha one."), p("b", "Beta two."), p("c", "Gamma three."), p("d", "Delta four."), p("e", "Epsilon five."));
    const next = doc(p("e", "Epsilon five."), p("a", "Alpha one."), p("n", "New words."), p("c", "Gamma three."), p("d", "Delta four."));
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["e:moved", "a:unchanged", "b:removed", "n:added", "c:unchanged", "d:unchanged"]);
    expect(red.counts).toEqual({ added: 1, removed: 1, changed: 0, moved: 1 });
    expectFaithful(base, next, red);
  });

  it("never pairs two blocks that both have ids, different ones", () => {
    const base = doc(p("x", "Same words here."));
    const next = doc(p("y", "Same words here."));
    expect(statuses(diffDocuments(base, next))).toEqual(["x:removed", "y:added"]);
  });
});

describe("diffDocuments: inside a paragraph", () => {
  it("marks word edits mid-paragraph", () => {
    const base = doc(p("a", "Pay 0% intro APR for 12 months on transfers."));
    const next = doc(p("a", "Pay 0% intro APR for 15 months on all transfers."));
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(show(red.blocks[0].node)).toBe("Pay 0% intro APR for [-12-]{+15+} months on{+ all+} transfers.");
    expect(red.counts).toEqual({ ...NO_CHANGES, changed: 1 });
    expectFaithful(base, next, red);
  });

  it("keeps numbers and contractions whole, and joins neighbouring word swaps", () => {
    const base = doc(p("a", "Earn 25,000 points. It isn't taxable."), p("b", "Pay a fee."));
    const next = doc(p("a", "Earn 20,000 points. It is taxable."), p("b", "Pay no charge."));
    const red = diffDocuments(base, next);
    expect(show(red.blocks[0].node)).toBe("Earn [-25,000-]{+20,000+} points. It [-isn't-]{+is+} taxable.");
    expect(show(red.blocks[1].node)).toBe("Pay [-a fee-]{+no charge+}.");
    expectFaithful(base, next, red);
  });

  it("treats a chip as one token: inserted, removed and replaced", () => {
    const base = doc(p("a", "Your APR is 20% today."), p("b", "Hi {first_name}, welcome aboard."), p("c", "Dear {first_name},"));
    const next = doc(p("a", "Your APR is {purchase_apr} today."), p("b", "Hi, welcome aboard."), p("c", "Dear {last_name},"));
    const red = diffDocuments(base, next);
    expect(red.blocks.map((b) => show(b.node))).toEqual([
      "Your APR is [-20%-]{+{{purchase_apr}}+} today.",
      "Hi[- -][-{{first_name}}-], welcome aboard.",
      "Dear [-{{first_name}}-]{+{{last_name}}+},",
    ]);
    // Chips stay variable nodes, carrying the mark.
    const chip = red.blocks[0].node.content!.find((x) => x.type === "variable")!;
    expect(chip).toEqual({ type: "variable", attrs: { key: "purchase_apr" }, marks: [{ type: "redline", attrs: { op: "insert" } }] });
    expect(red.counts).toEqual({ ...NO_CHANGES, changed: 3 });
    expectFaithful(base, next, red);
  });

  it("counts bold added to existing words as a change: the plain run deleted, the bold one inserted", () => {
    const base = doc(p("a", "Pay by the due date each month."));
    const next = doc(p("a", "Pay by the ", bold("due date"), " each month."));
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(show(red.blocks[0].node)).toBe("Pay by the [-due date-]{+**due date**+} each month.");
    // One merged run per side, the bold one keeping its mark under the redline.
    const inserted = red.blocks[0].node.content!.find((x) => opOf(x) === "insert")!;
    expect(inserted).toEqual({ type: "text", text: "due date", marks: [{ type: "bold" }, { type: "redline", attrs: { op: "insert" } }] });
    expectFaithful(base, next, red);
  });

  it("counts a link's new href as a change", () => {
    const link = (href: string): JSONContent => ({ type: "text", text: "the terms", marks: [{ type: "link", attrs: { href } }] });
    const red = diffDocuments(doc(p("a", "Read ", link("https://a.example"), ".")), doc(p("a", "Read ", link("https://b.example"), ".")));
    expect(show(red.blocks[0].node)).toBe("Read [-the terms-]{+the terms+}.");
  });

  it("marks a whole heading when its level changes", () => {
    const base = doc(h("h", 2, "Fees"), h("g", 2, "Fees"), p("x", "Important"));
    const next = doc(h("h", 3, "Fees"), h("g", 3, "Fees and charges"), h("x", 3, "Important"));
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["h:changed", "g:changed", "x:changed"]);
    expect(red.blocks.map((b) => show(b.node))).toEqual(["{+Fees+}", "[-Fees-]{+Fees and charges+}", "{+Important+}"]);
    expect(red.blocks[0].node.attrs).toEqual({ id: "h", level: 3, requiredKey: null });
    expect(red.blocks[2].node.type).toBe("heading");
    expectFaithful(base, next, red, { reject: false });
  });
});

describe("diffDocuments: nested blocks", () => {
  it("lines up list items by their text: added, removed and edited", () => {
    const base = doc(ul("l", ["Transfers must post within 60 days.", "Balances from other Coral accounts are not eligible.", "Fees apply."]));
    const next = doc(ul("l", ["Transfers must post within 90 days.", "Fees apply.", "The amount can't exceed your credit line."]));
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(lines(red.blocks[0].node)).toEqual([
      "Transfers must post within [-60-]{+90+} days.",
      "[-Balances from other Coral accounts are not eligible.-]",
      "Fees apply.",
      "{+The amount can't exceed your credit line.+}",
    ]);
    expect(red.blocks[0].node.content!.map((item) => item.type)).toEqual(["listItem", "listItem", "listItem", "listItem"]);
    expectFaithful(base, next, red);
  });

  it("lines up list items by id when they have one", () => {
    const base = doc(ul("l", [li("Alpha.", "i1"), li("Beta.", "i2")]));
    const next = doc(ul("l", [li("Gamma.", "i1"), li("Beta.", "i2"), li("Delta.", "i3")]));
    const red = diffDocuments(base, next);
    expect(lines(red.blocks[0].node)).toEqual(["[-Alpha-]{+Gamma+}.", "Beta.", "{+Delta.+}"]);
    expectFaithful(base, next, red);
  });

  it("diffs a nested list inside a list item", () => {
    const nested = (second: string) =>
      doc(ul("l", [{ type: "listItem", content: [p(null, "Outer."), ol(null, ["First.", second])] }]));
    const red = diffDocuments(nested("Second one."), nested("Second two."));
    expect(lines(red.blocks[0].node)).toEqual(["Outer.", "First.", "Second [-one-]{+two+}."]);
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
    const base = doc(table("t", ["Rate or fee", "What you pay"], [["Annual fee", "$0"], ["Late fee", "Up to $40"]]));
    const next = doc(table("t", ["Rate or fee", "What you pay"], [["Annual fee", "$95"], ["Late fee", "Up to $40"], ["Returned payment", "Up to $40"]]));
    const red = diffDocuments(base, next);
    expect(red.blocks[0].status).toBe("changed");
    expect(lines(red.blocks[0].node)).toEqual([
      "Rate or fee", "What you pay",
      "Annual fee", "$[-0-]{+95+}",
      "Late fee", "Up to $40",
      "{+Returned payment+}", "{+Up to $40+}",
    ]);
    expectFaithful(base, next, red);
  });

  it("finds a row inserted mid-table next to an edited one", () => {
    const base = doc(table("t", ["Fee", "Amount"], [["Annual fee", "$0"], ["Late fee", "Up to $40"]]));
    const next = doc(table("t", ["Fee", "Amount"], [["Annual fee", "$0"], ["Foreign transaction fee", "3%"], ["Late fee", "Up to $41"]]));
    const red = diffDocuments(base, next);
    expect(lines(red.blocks[0].node)).toEqual([
      "Fee", "Amount",
      "Annual fee", "$0",
      "{+Foreign transaction fee+}", "{+3%+}",
      "Late fee", "Up to $[-40-]{+41+}",
    ]);
    expectFaithful(base, next, red);
  });

  it("diffs a callout's paragraphs", () => {
    const base = doc(callout("c", "Interest starts on the transaction date.", "Talk to a tax advisor."));
    const next = doc(callout("c", "Interest starts on the posting date.", "Talk to a tax advisor.", "Keep your receipts."));
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

// ── Speed ────────────────────────────────────────────────────────────────────

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

describe("diffChannelFields", () => {
  /** A field's stored document: one paragraph, as `prepareField` makes it. */
  const field = (...parts: Inline[]): JSONContent => doc(p(null, ...parts));
  const alert = (channelFields: ChannelFields, channels: Channel[] = ["push", "sms"]) => ({ channels, channelFields });
  const statuses = (result: FieldsRedline) => Object.fromEntries(result.fields.map((f) => [f.field.id, f.status]));
  /** The words a field's diff marks with `op`, chips as {key}. */
  const marked = (result: FieldsRedline, id: string, op: "insert" | "delete") =>
    result.fields
      .find((f) => f.field.id === id)!
      .doc.blocks.flatMap((b) => b.node.content ?? [])
      .filter((n) => n.marks?.some((m) => m.type === "redline" && m.attrs?.op === op))
      .map((n) => (n.type === "variable" ? `{${String(n.attrs?.key)}}` : n.text))
      .join("");

  it("with no base, is every field of the channels that are on, as it stands, counting nothing", () => {
    const result = diffChannelFields(null, alert({ push: { title: field("Was this you?") } }, ["push"]));
    expect(result.fields.map((f) => f.field.id)).toEqual(["push.title", "push.subtitle", "push.body"]);
    expect(Object.values(statuses(result))).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(result.counts).toEqual(NO_CHANGES);
    expect(result.fields[0]!.doc.blocks[0]!.node.content).toEqual(inline(["Was this you?"]));
  });

  it("word-diffs a changed field, an email subject among them, and counts it once", () => {
    const email = (subject: JSONContent) => ({ channels: ["pdf", "email"] as Channel[], channelFields: { email: { subject } } });
    const result = diffChannelFields(email(field("Your rate is changing on {effective_date}")), email(field("Your rate changes soon")));
    expect(statuses(result)).toEqual({ "email.subject": "changed", "email.preheader": "unchanged" });
    expect(marked(result, "email.subject", "delete")).toBe("is changing on {effective_date}");
    expect(marked(result, "email.subject", "insert")).toBe("changes soon");
    expect(result.counts).toEqual({ ...NO_CHANGES, changed: 1 });
  });

  it("pairs a field however much was rewritten: a changed field, never a removal and an addition", () => {
    const result = diffChannelFields(alert({ sms: { text: field("Coral: one two three.") } }), alert({ sms: { text: field("Entirely different words here") } }));
    expect(statuses(result)["sms.text"]).toBe("changed");
    expect(result.fields.find((f) => f.field.id === "sms.text")!.doc.blocks).toHaveLength(1);
  });

  it("is added when a field gains text, removed when it loses it, unchanged when it has none on either side", () => {
    const result = diffChannelFields(
      alert({ push: { title: field("Hi"), subtitle: field("Card {card_last4}") } }),
      alert({ push: { title: field("Hi"), body: field("Pay now.") } }),
    );
    expect(statuses(result)).toEqual({ "push.title": "unchanged", "push.subtitle": "removed", "push.body": "added", "sms.text": "unchanged" });
    expect(result.fields.find((f) => f.field.id === "sms.text")!.doc.blocks).toEqual([]);
    expect(result.counts).toEqual({ ...NO_CHANGES, added: 1, removed: 1 });
  });

  it("counts a field only while its channel is on: turning a channel on adds its fields, off removes them", () => {
    const fields = { push: { title: field("Hi") }, sms: { text: field("Coral: hi.") } };
    const off = diffChannelFields(alert(fields, ["push", "sms"]), alert(fields, ["push"]));
    expect(statuses(off)).toEqual({ "push.title": "unchanged", "push.subtitle": "unchanged", "push.body": "unchanged", "sms.text": "removed" });
    const on = diffChannelFields(alert(fields, ["push"]), alert(fields, ["push", "sms"]));
    expect(statuses(on)["sms.text"]).toBe("added");
  });

  it("adds two counts together", () => {
    expect(addCounts({ added: 1, removed: 0, changed: 2, moved: 1 }, { added: 0, removed: 1, changed: 1, moved: 0 })).toEqual({
      added: 1,
      removed: 1,
      changed: 3,
      moved: 1,
    });
  });
});
