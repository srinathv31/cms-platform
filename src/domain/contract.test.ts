import { describe, expect, it } from "vitest";
import { describeChange, describeChanges, diffVariables, isBreaking, isContractChange, typeLabel } from "./contract";
import type { ContractChange, Variable } from "./types";

describe("describeChange: one plain sentence per kind", () => {
  it.each<[string, ContractChange, string]>([
    [
      "a required variable added (the build plan's example)",
      { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
      "v2 adds required `annual_fee` (Currency).",
    ],
    [
      "an optional variable added",
      { kind: "added", key: "bonus_points", breaking: false, type: "number", required: false },
      "v2 adds optional `bonus_points` (Number).",
    ],
    [
      "a variable removed",
      { kind: "removed", key: "promo_code", breaking: true, type: "text", required: false },
      "v2 removes `promo_code` (Text).",
    ],
    [
      "a key renamed",
      { kind: "key_renamed", key: "annual_fee", breaking: true, from: "fee", to: "annual_fee" },
      "v2 renames `fee` to `annual_fee`.",
    ],
    [
      "a type changed",
      { kind: "type_changed", key: "home_state", breaking: true, from: "text", to: "us_state" },
      "v2 changes `home_state` from Text to US state.",
    ],
    [
      "optional made required",
      { kind: "made_required", key: "promo_code", breaking: true },
      "v2 makes `promo_code` required.",
    ],
    [
      "required made optional",
      { kind: "made_optional", key: "promo_code", breaking: false },
      "v2 makes `promo_code` optional.",
    ],
    [
      "a label changed",
      { kind: "label_changed", key: "home_state", breaking: false, from: "State", to: "Home state" },
      "v2 changes the label of `home_state` to “Home state”.",
    ],
  ])("%s", (_, change, line) => {
    expect(describeChange(change, 2)).toBe(line);
  });

  it("uses every type's label", () => {
    expect(
      (["text", "currency", "percent", "date", "number", "us_state"] as const).map((type) =>
        describeChange({ kind: "added", key: "k", breaking: true, type, required: true }, 2),
      ),
    ).toEqual([
      "v2 adds required `k` (Text).",
      "v2 adds required `k` (Currency).",
      "v2 adds required `k` (Percent).",
      "v2 adds required `k` (Date).",
      "v2 adds required `k` (Number).",
      "v2 adds required `k` (US state).",
    ]);
  });
});

describe("describeChanges", () => {
  const before: Variable[] = [
    { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
    { key: "promo_code", label: "Promo code", type: "text", required: false, sample: "SPRING" },
    { key: "home_state", label: "State", type: "text", required: false, sample: "NJ" },
  ];
  const after: Variable[] = [
    { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
    { key: "home_state", label: "Home state", type: "us_state", required: true, sample: "NJ" },
    { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" },
  ];

  it("words the diff line by line, in the diff's order (removals last)", () => {
    const changes = diffVariables(before, after);
    expect(isBreaking(changes)).toBe(true);
    expect(describeChanges(changes, 3)).toEqual([
      "v3 changes `home_state` from Text to US state.",
      "v3 makes `home_state` required.",
      "v3 changes the label of `home_state` to “Home state”.",
      "v3 adds required `annual_fee` (Currency).",
      "v3 removes `promo_code` (Text).",
    ]);
  });

  it("words a rename: the renamed variable keeps its identity as its id", () => {
    const renamed = after.map((v) => (v.key === "annual_fee" ? { ...v, id: "annual_fee", key: "yearly_fee" } : v));
    const changes = diffVariables(after, renamed);
    expect(describeChanges(changes, 4)).toEqual(["v4 renames `annual_fee` to `yearly_fee`."]);
  });

  it("has no lines when nothing changed", () => {
    expect(describeChanges([], 2)).toEqual([]);
  });
});

describe("isContractChange: a stored change has every field of its kind", () => {
  it.each<[string, unknown]>([
    ["added", { kind: "added", key: "fee", breaking: true, type: "currency", required: true }],
    ["removed", { kind: "removed", key: "fee", breaking: true, type: "currency", required: false }],
    ["key_renamed", { kind: "key_renamed", key: "apr", breaking: true, from: "rate", to: "apr" }],
    ["type_changed", { kind: "type_changed", key: "apr", breaking: true, from: "text", to: "percent" }],
    ["made_required", { kind: "made_required", key: "apr", breaking: true }],
    ["made_optional", { kind: "made_optional", key: "apr", breaking: false }],
    ["label_changed", { kind: "label_changed", key: "apr", breaking: false, from: "Rate", to: "APR" }],
  ])("takes a whole %s", (_, change) => {
    expect(isContractChange(change)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["a rename without its old key", { kind: "key_renamed", key: "apr", breaking: true, to: "apr" }],
    ["an addition without its type", { kind: "added", key: "fee", breaking: true, required: true }],
    ["an addition without `required`", { kind: "added", key: "fee", breaking: true, type: "currency" }],
    ["a type change without the new type", { kind: "type_changed", key: "apr", breaking: true, from: "text" }],
    ["a change without a key", { kind: "made_required", breaking: true }],
    ["an unknown kind", { kind: "renamed", key: "apr", breaking: true, from: "rate", to: "apr" }],
    ["not an object", "key_renamed"],
  ])("leaves out %s", (_, change) => {
    expect(isContractChange(change)).toBe(false);
  });
});

describe("typeLabel", () => {
  it("names known types and passes unknown ones through", () => {
    expect(typeLabel("us_state")).toBe("US state");
    expect(typeLabel("phone")).toBe("phone");
    expect(typeLabel(undefined)).toBe("an unknown type");
  });
});
