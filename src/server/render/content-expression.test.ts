import { describe, expect, it } from "vitest";
import { editorSchema } from "./schema-check";
import { contentPieces } from "./content-expression";

const once = (...names: string[]) => ({ names, min: 1, max: 1 });

describe("contentPieces", () => {
  it.each([
    ["", []],
    ["inline*", [{ names: ["inline"], min: 0, max: Infinity }]],
    ["block+", [{ names: ["block"], min: 1, max: Infinity }]],
    [
      "paragraph block*",
      [once("paragraph"), { names: ["block"], min: 0, max: Infinity }],
    ],
    [
      "(tableCell | tableHeader)*",
      [{ names: ["tableCell", "tableHeader"], min: 0, max: Infinity }],
    ],
    [
      "(paragraph | bulletList | orderedList)+",
      [
        {
          names: ["paragraph", "bulletList", "orderedList"],
          min: 1,
          max: Infinity,
        },
      ],
    ],
    [
      "heading paragraph?",
      [once("heading"), { names: ["paragraph"], min: 0, max: 1 }],
    ],
    ["item{2,4}", [{ names: ["item"], min: 2, max: 4 }]],
    ["item{3}", [{ names: ["item"], min: 3, max: 3 }]],
    ["item{2,}", [{ names: ["item"], min: 2, max: Infinity }]],
    ["(a)", [once("a")]],
    ["a (b | c)", [once("a"), once("b", "c")]],
  ])("reads %j", (expression, pieces) => {
    expect(contentPieces(expression)).toEqual(pieces);
  });

  it.each([
    ["(a b)+", /sequence inside a choice or a repeat/],
    ["a b | c", /choice of more than names|sequence inside/],
    ["a**", /repeat of a repeat/],
    ["a |", /empty choice/],
    ["(a", /expected "\)"/],
    ["a)", /"\)"/],
    ["a{x}", /bad \{n,m\} count/],
    ["a{3,1}", /bad \{n,m\} count/],
    ["a & b", /"&"/],
  ])("refuses %j", (expression, why) => {
    expect(() => contentPieces(expression)).toThrow(why);
  });

  it("reads every content expression the editor's schema has", () => {
    const expressions = Object.values(editorSchema().nodes)
      .map((type) => type.spec.content)
      .filter((content): content is string => content !== undefined);
    expect(expressions.length).toBeGreaterThan(5);
    for (const expression of expressions)
      expect(contentPieces(expression).length).toBeGreaterThan(0);
  });
});
