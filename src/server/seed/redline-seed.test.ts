import { describe, expect, it } from "vitest";
import { changesOnly, diffDocuments, groupUnchanged } from "@/domain/redline";
import type { RedlineDoc } from "@/domain/review-types";
import type { JSONContent } from "@/domain/types";
import { checkDocument } from "@/server/render/schema-check";
import { createContext } from "./context";
import { seedCoralTemplates } from "./templates/coral";

// The redline of the real seeded version pairs. The domain test (src/domain/redline.test.ts) keeps to
// pure fixtures, because domain code can't import the seed or the editor's schema; what needs them
// lives here: the seeded bodies (built in memory, as the seed writes them, no DB) and the check that a
// redline, minus its marks, is still a valid editor document.

const NOW = new Date("2026-10-04T12:00:00.000Z");

// ── Readers (the same as in src/domain/redline.test.ts) ──────────────────────

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

function stripRedline(node: JSONContent): JSONContent {
  const out: JSONContent = { ...node };
  if (node.marks) {
    const marks = node.marks.filter((m) => m.type !== "redline");
    if (marks.length > 0) out.marks = marks;
    else delete out.marks;
  }
  if (node.content) out.content = node.content.map(stripRedline);
  return out;
}

/**
 * The redline loses nothing: accepting every change reads as `next`, rejecting every change reads as
 * `base` (when nothing moved and no kind changed), and without the redline mark it's an editor document.
 */
function expectFaithful(base: JSONContent, next: JSONContent, red: RedlineDoc, { reject = true } = {}) {
  const accepted = red.blocks.filter((b) => b.status !== "removed").flatMap((b) => plain(b.node, "delete"));
  expect(accepted).toEqual(plain(next));
  if (reject && red.blocks.every((b) => b.movedFrom === undefined)) {
    const rejected = red.blocks.filter((b) => b.status !== "added").flatMap((b) => plain(b.node, "insert"));
    expect(rejected).toEqual(plain(base));
  }
  if (red.blocks.length > 0) {
    expect(() => checkDocument({ type: "doc", content: red.blocks.map((b) => stripRedline(b.node)) })).not.toThrow();
  }
}

// ── The seeded versions ──────────────────────────────────────────────────────

describe("the seeded Coral versions", () => {
  const ctx = createContext(NOW.getTime());
  seedCoralTemplates(ctx);
  const body = (key: string, number: number): JSONContent => {
    const templateId = ctx.template(key).id;
    const version = ctx.sink.versions.find((x) => x.templateId === templateId && x.number === number);
    if (!version) throw new Error(`no ${key} v${number}`);
    return version.body as JSONContent;
  };

  it("Balance Transfer v1 → v2: 12 months becomes 15, and an end date is added", () => {
    const base = body("balance-transfer", 1);
    const next = body("balance-transfer", 2);
    const red = diffDocuments(base, next);
    expect(red.counts).toEqual({ added: 1, removed: 0, changed: 2, moved: 0 });
    const [intro, endDate, rates] = changesOnly(red);
    expect(intro.status).toBe("changed");
    expect(show(intro.node)).toContain("pay 0% intro APR on that balance for [-12-]{+15+} months.");
    expect(endDate.status).toBe("added");
    expect(plain(endDate.node)).toEqual(["Open your account by {{offer_end_date}} to qualify for this offer."]);
    expect(rates.status).toBe("changed");
    expect(rates.node.type).toBe("table");
    expect(lines(rates.node)).toContain("0% for [-12-]{+15+} months");
    // The required sections stay put.
    const headings = red.blocks.filter((b) => b.node.attrs?.requiredKey);
    expect(headings.map((b) => b.status)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expectFaithful(base, next, red);
  });

  it("Cash Back v2 → v3: the annual fee arrives in the rates table and a new note", () => {
    const base = body("cash-back", 2);
    const next = body("cash-back", 3);
    const red = diffDocuments(base, next);
    expect(red.counts).toEqual({ added: 1, removed: 0, changed: 1, moved: 0 });
    const [rates, feeNote] = changesOnly(red);
    expect(rates.status).toBe("changed");
    expect(lines(rates.node)).toContain("$0{+ the first year, then +}{+{{annual_fee}}+}{+ per year+}");
    expect(lines(rates.node).filter((line) => line.includes("{+") || line.includes("[-"))).toHaveLength(1);
    expect(feeNote.status).toBe("added");
    expect(plain(feeNote.node)).toEqual(["After your first year, an annual fee of {{annual_fee}} is billed to your account each year."]);
    expect(groupUnchanged(red).map((x) => ("status" in x ? x.status : x.count))).toEqual([6, "changed", "added", 4]);
    expectFaithful(base, next, red);
  });

  it("Holiday Points v1 → v2: the corrected bonus and the added rule", () => {
    const base = body("holiday-points", 1);
    const next = body("holiday-points", 2);
    const red = diffDocuments(base, next);
    expect(red.counts).toEqual({ added: 1, removed: 0, changed: 1, moved: 0 });
    const [intro, rule] = changesOnly(red);
    expect(show(intro.node)).toContain("earn [-25,000-]{+20,000+} bonus points");
    expect(rule.node.type).toBe("horizontalRule");
    expect(rule.status).toBe("added");
    expectFaithful(base, next, red);
  });
});
