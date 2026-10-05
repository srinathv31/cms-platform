import { describe, expect, it } from "vitest";
import type { JSONContent } from "@/domain/types";
import { blockTextOf } from "./block-text";

const text = (value: string): JSONContent => ({ type: "text", text: value });
const para = (id: string, ...content: JSONContent[]): JSONContent => ({ type: "paragraph", attrs: { id }, content });

const DOC: JSONContent = {
  type: "doc",
  content: [
    para("p1", text("Earn "), { type: "variable", attrs: { key: "bonus_points" } }, text("  after you   spend.")),
    {
      type: "bulletList",
      attrs: { id: "l1" },
      content: [
        { type: "listItem", attrs: { id: "li1" }, content: [para("p2", text("Triple points on flights."))] },
        { type: "listItem", attrs: { id: "li2" }, content: [para("p3", text("Double points on dining."))] },
      ],
    },
    para("empty"),
    para("long", text("word ".repeat(200))),
  ],
};

describe("blockTextOf", () => {
  it("reads a paragraph on one line, with chips as their label and whitespace as single spaces", () => {
    expect(blockTextOf(DOC, "p1", { bonus_points: "Bonus points" })).toBe("Earn Bonus points after you spend.");
    expect(blockTextOf(DOC, "p1", new Map([["bonus_points", "Bonus points"]]))).toBe("Earn Bonus points after you spend.");
  });

  it("falls back to the key for a chip it has no label for", () => {
    expect(blockTextOf(DOC, "p1")).toBe("Earn bonus_points after you spend.");
  });

  it("joins the lines of a list with spaces", () => {
    expect(blockTextOf(DOC, "l1")).toBe("Triple points on flights. Double points on dining.");
  });

  it("finds a nested block by its id", () => {
    expect(blockTextOf(DOC, "p3")).toBe("Double points on dining.");
  });

  it("says nothing for a missing block, an empty one, or no document", () => {
    expect(blockTextOf(DOC, "nope")).toBeNull();
    expect(blockTextOf(DOC, "empty")).toBeNull();
    expect(blockTextOf(null, "p1")).toBeNull();
  });

  it("keeps a very long block short enough to hold in a line of the DOM", () => {
    expect(blockTextOf(DOC, "long")!.length).toBeLessThanOrEqual(240);
  });
});
