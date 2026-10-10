import { describe, expect, it } from "vitest";
import { fieldProblem, normalizeAndCheckField } from "./document-check";
import type { JSONContent } from "./types";

const t = (text: string): JSONContent => ({ type: "text", text });
const br: JSONContent = { type: "hardBreak" };
const chip: JSONContent = { type: "variable", attrs: { key: "first_name" } };
const field = (...inline: JSONContent[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content: inline }] });

describe("fieldProblem (a channel field's check)", () => {
  it("takes one paragraph of text and chips, on one line by default", () => {
    expect(fieldProblem(field(t("Hi "), chip))).toBeNull();
    expect(fieldProblem(field(t("a"), br, t("b")))).toBe("field");
  });

  it("takes hard breaks only in a field that keeps its lines", () => {
    expect(fieldProblem(field(t("a"), br, br, t("b"), chip), { lines: "lines" })).toBeNull();
    expect(fieldProblem(field(t("a"), br, t("b")), { lines: "line", problem: "pushField" })).toBe("pushField");
  });

  it("refuses marks and other blocks in every field, with the problem it is given", () => {
    const marked = field({ type: "text", text: "a", marks: [{ type: "bold" }] });
    expect(fieldProblem(marked, { lines: "lines", problem: "smsField" })).toBe("smsField");
    const twoParagraphs: JSONContent = { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }] };
    expect(fieldProblem(twoParagraphs, { lines: "lines", problem: "smsField" })).toBe("smsField");
    const heading: JSONContent = { type: "doc", content: [{ type: "heading", attrs: { level: 2 } }] };
    expect(fieldProblem(heading)).toBe("field");
  });
});

describe("normalizeAndCheckField", () => {
  it("normalizes for the field's lines before checking, so a typed line break passes either way", () => {
    const typed = field(t("a\nb"));
    expect(normalizeAndCheckField(typed)).toEqual({ doc: field(t("a b")), problem: null });
    expect(normalizeAndCheckField(typed, { lines: "lines" })).toEqual({ doc: field(t("a"), br, t("b")), problem: null });
  });
});
