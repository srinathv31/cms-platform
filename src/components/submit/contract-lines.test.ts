import { describe, expect, it } from "vitest";
import type { Variable } from "@/domain/types";
import { contractSection, splitCode, splitKeys } from "./contract-lines";

const v = (key: string, over: Partial<Variable> = {}): Variable => ({
  key,
  label: key,
  type: "text",
  required: true,
  sample: "",
  ...over,
});

const BASELINE = { number: 2, variables: [v("first_name"), v("purchase_apr", { type: "percent" })] };

describe("contractSection", () => {
  it("has no section when no version is Active: there is nothing to compare with", () => {
    expect(contractSection({ baseline: null, variables: [v("first_name")], versionNumber: 1 })).toBeNull();
  });

  it("has no lines when the list is unchanged", () => {
    const section = contractSection({ baseline: BASELINE, variables: BASELINE.variables, versionNumber: 3 });
    expect(section).toEqual({ baselineNumber: 2, lines: [], breaking: false });
  });

  it("words a required variable added as breaking, with the next version's number", () => {
    const section = contractSection({
      baseline: BASELINE,
      variables: [...BASELINE.variables, v("annual_fee", { type: "currency" })],
      versionNumber: 3,
    });
    expect(section?.breaking).toBe(true);
    expect(section?.lines).toEqual([{ text: "v3 adds required `annual_fee` (Currency).", breaking: true }]);
  });

  it("flags every line by its own change, and lists breaking ones first", () => {
    const section = contractSection({
      baseline: BASELINE,
      variables: [
        v("first_name", { label: "Given name" }), // label only: not breaking
        v("purchase_apr", { type: "percent" }),
        v("promo_code", { required: false }), // optional added: not breaking
        v("annual_fee", { type: "currency" }), // required added: breaking
      ],
      versionNumber: 3,
    });
    expect(section?.lines.map((l) => l.breaking)).toEqual([true, false, false]);
    expect(section?.lines[0]?.text).toContain("`annual_fee`");
    // Each group keeps the order the diff lists it in (the variable list's order).
    expect(section?.lines.slice(1).map((l) => l.text)).toEqual([
      expect.stringContaining("label of `first_name`"),
      expect.stringContaining("adds optional `promo_code`"),
    ]);
  });

  it("is quiet about a change that only touches a label or an optional variable", () => {
    const section = contractSection({
      baseline: BASELINE,
      variables: [...BASELINE.variables, v("promo_code", { required: false })],
      versionNumber: 3,
    });
    expect(section?.breaking).toBe(false);
    expect(section?.lines).toHaveLength(1);
  });

  it("words a renamed variable as one rename, not a removal and an addition", () => {
    const section = contractSection({
      baseline: BASELINE,
      // As the draft saves it: the variable keeps the key it had as its id.
      variables: [v("given_name", { id: "first_name", label: "first_name" }), BASELINE.variables[1]!],
      versionNumber: 3,
    });
    expect(section?.lines).toEqual([{ text: "v3 renames `first_name` to `given_name`.", breaking: true }]);
  });

  it("reads a removed variable as breaking", () => {
    const section = contractSection({ baseline: BASELINE, variables: [BASELINE.variables[0]!], versionNumber: 3 });
    expect(section?.breaking).toBe(true);
    expect(section?.lines[0]?.text).toContain("removes `purchase_apr`");
  });
});

describe("splitCode", () => {
  it("sets text between backticks apart, for Geist Mono", () => {
    expect(splitCode("v3 adds required `annual_fee` (Currency).")).toEqual([
      { text: "v3 adds required ", code: false },
      { text: "annual_fee", code: true },
      { text: " (Currency).", code: false },
    ]);
  });

  it("handles several keys, a leading key and no keys", () => {
    expect(splitCode("`a` to `b`").map((p) => [p.text, p.code])).toEqual([
      ["a", true],
      [" to ", false],
      ["b", true],
    ]);
    expect(splitCode("Nothing here.")).toEqual([{ text: "Nothing here.", code: false }]);
  });
});

describe("splitKeys", () => {
  it("sets a {{key}} in a refusal apart, for Geist Mono", () => {
    expect(splitKeys("Define or remove {{promo_code}} before submitting.")).toEqual([
      { text: "Define or remove ", code: false },
      { text: "{{promo_code}}", code: true },
      { text: " before submitting.", code: false },
    ]);
  });

  it("handles a list of keys and a sentence with none", () => {
    expect(splitKeys("Define or remove {{a}} and {{b}} before submitting.").filter((p) => p.code).map((p) => p.text)).toEqual([
      "{{a}}",
      "{{b}}",
    ]);
    expect(splitKeys("Add an email subject before submitting.")).toEqual([
      { text: "Add an email subject before submitting.", code: false },
    ]);
  });
});
