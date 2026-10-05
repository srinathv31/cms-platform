import { describe, expect, it } from "vitest";
import type { ContractChange, Variable, VariableType } from "../types";
import { apiChanges, contractDiff } from "./contract-diff";

const v = (key: string, type: VariableType = "text", required = true, label = key): Variable => ({ key, label, type, required, sample: "" });

describe("apiChanges", () => {
  it("words each change for the version and keeps from/to only when set", () => {
    const changes: ContractChange[] = [
      { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
      { kind: "label_changed", key: "purchase_apr", breaking: false, from: "APR", to: "Purchase APR" },
    ];
    expect(apiChanges(changes, 3)).toEqual([
      { kind: "added", key: "annual_fee", breaking: true, text: "v3 adds required `annual_fee` (Currency)." },
      {
        kind: "label_changed",
        key: "purchase_apr",
        breaking: false,
        from: "APR",
        to: "Purchase APR",
        text: "v3 changes the label of `purchase_apr` to “Purchase APR”.",
      },
    ]);
    expect(apiChanges([], 2)).toEqual([]);
  });
});

describe("contractDiff", () => {
  const v2 = [v("first_name"), v("purchase_apr", "percent"), v("promo_code", "text", false), v("fee", "text", true)];

  it("no changes: not breaking, nothing newly required", () => {
    expect(contractDiff({ number: 1, variables: v2 }, { number: 2, variables: v2 })).toEqual({
      since: 1,
      to: 2,
      breaking: false,
      items: [],
      newRequired: [],
    });
  });

  it("an added optional variable isn't breaking and asks nothing", () => {
    const diff = contractDiff({ number: 1, variables: v2 }, { number: 2, variables: [...v2, v("offer_end_date", "date", false)] });
    expect(diff).toMatchObject({ breaking: false, newRequired: [] });
    expect(diff.items.map((i) => i.text)).toEqual(["v2 adds optional `offer_end_date` (Date)."]);
  });

  it("names the required keys a consumer must newly supply, in the newer version's order", () => {
    const v3 = [
      v("annual_fee", "currency"), // added, required
      v("first_name"),
      v("purchase_apr", "number"), // retyped, required
      v("promo_code", "text", true), // made required
      v("bonus", "number", false), // added, optional: not asked
      // `fee` removed
    ];
    const diff = contractDiff({ number: 2, variables: v2 }, { number: 3, variables: v3 });
    expect(diff.breaking).toBe(true);
    expect(diff.newRequired).toEqual(["annual_fee", "purchase_apr", "promo_code"]);
    expect(diff.items.map((i) => [i.kind, i.key, i.breaking])).toEqual([
      ["added", "annual_fee", true],
      ["type_changed", "purchase_apr", true],
      ["made_required", "promo_code", true],
      ["added", "bonus", false],
      ["removed", "fee", true],
    ]);
    expect(diff.items.find((i) => i.kind === "type_changed")).toMatchObject({ from: "percent", to: "number", text: "v3 changes `purchase_apr` from Percent to Number." });
  });

  it("a retyped optional variable is breaking but asks nothing new", () => {
    const diff = contractDiff({ number: 1, variables: v2 }, { number: 2, variables: v2.map((x) => (x.key === "promo_code" ? { ...x, type: "date" as const } : x)) });
    expect(diff).toMatchObject({ breaking: true, newRequired: [] });
  });

  it("a removed variable is breaking and asks nothing", () => {
    const diff = contractDiff({ number: 4, variables: v2 }, { number: 5, variables: v2.slice(0, 2) });
    expect(diff).toMatchObject({ since: 4, to: 5, breaking: true, newRequired: [] });
    expect(diff.items.map((i) => i.text)).toEqual(["v5 removes `promo_code` (Text).", "v5 removes `fee` (Text)."]);
  });
});
