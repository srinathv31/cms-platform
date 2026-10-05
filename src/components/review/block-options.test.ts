import { describe, expect, it } from "vitest";
import type { JSONContent, Variable } from "@/domain/types";
import { blockOptions } from "./block-options";

const variables = [{ key: "first_name", label: "First name", type: "text", required: true }] as unknown as Variable[];

const body: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { id: "h1", level: 2 }, content: [{ type: "text", text: "Offer details" }] },
    {
      type: "paragraph",
      attrs: { id: "p1" },
      content: [
        { type: "text", text: "Hi " },
        { type: "variable", attrs: { key: "first_name" } },
        { type: "text", text: ", your offer is ready." },
      ],
    },
    { type: "horizontalRule", attrs: { id: "hr" } },
    { type: "paragraph", attrs: { id: "empty" } },
    {
      type: "bulletList",
      attrs: { id: "l1" },
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Triple points" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Double points" }] }] },
      ],
    },
    { type: "paragraph", attrs: { id: "long" }, content: [{ type: "text", text: "word ".repeat(40) }] },
    {
      type: "table",
      attrs: { id: "t1" },
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Rate or fee" }] }] },
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "What you pay" }] }] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Annual fee" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "variable", attrs: { key: "first_name" } }] }] },
          ],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { id: "l2" },
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Purchases must post to your account within 30 days of the offer start date." }] }],
        },
      ],
    },
    { type: "table", attrs: { id: "t-empty" }, content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }] },
  ],
};

describe("blockOptions", () => {
  const options = blockOptions(body, variables);

  it("names each block in reading order, skipping dividers and empty blocks", () => {
    expect(options.map((o) => o.id)).toEqual(["h1", "p1", "l1", "long", "t1", "l2"]);
  });

  it("marks headings", () => {
    expect(options.map((o) => o.heading)).toEqual([true, false, false, false, false, false]);
  });

  it("reads a variable as its label", () => {
    expect(options[1].label).toBe("Hi First name, your offer is ready.");
  });

  it("calls a list by its first item, and a table by its header cells, not a run of text", () => {
    expect(options[2].label).toBe("List: Triple points");
    expect(options[4].label).toBe("Table: Rate or fee, What you pay");
    // The first item, cut short with the kind kept.
    expect(options[5].label).toBe("List: Purchases must post to your account within 30…");
    expect(options[5].label.length).toBeLessThanOrEqual(56);
  });

  it("leaves out a table with nothing in it", () => {
    expect(options.map((o) => o.id)).not.toContain("t-empty");
  });

  it("cuts a long block short", () => {
    expect(options[3].label.length).toBeLessThanOrEqual(56);
    expect(options[3].label.endsWith("…")).toBe(true);
  });

  it("has nothing to offer without blocks", () => {
    expect(blockOptions({ type: "doc" }, [])).toEqual([]);
  });
});
