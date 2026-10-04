import { describe, expect, it } from "vitest";
import { isPickerQuery, pickerItems } from "../extensions/variable-picker";
import { generatedKey, newDraft, sampleForType, validateDraft } from "./draft";
import type { Variable } from "./types";
import { filterVariables, uniqueKey } from "./variables";

const LIST: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
  { key: "offer_end_date", label: "Offer end date", type: "date", required: true, sample: "2027-03-04" },
  { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" },
  { key: "home_state", label: "Home state", type: "us_state", required: false, sample: "NJ" },
];

const keys = (list: Variable[]) => list.map((v) => v.key);

describe("picker filtering", () => {
  it("lists everything for an empty query", () => {
    expect(keys(filterVariables(LIST, ""))).toEqual(keys(LIST));
  });

  it("ranks label prefix, then label word, then key, then anywhere", () => {
    expect(keys(filterVariables(LIST, "pur"))).toEqual(["purchase_apr"]);
    expect(keys(filterVariables(LIST, "fee"))).toEqual(["annual_fee"]);
    expect(keys(filterVariables(LIST, "a"))).toEqual(["annual_fee", "purchase_apr", "first_name", "offer_end_date", "home_state"]);
  });

  it("matches multi-word queries against labels and keys", () => {
    expect(keys(filterVariables(LIST, "end date"))).toEqual(["offer_end_date"]);
    expect(keys(filterVariables(LIST, "offer end"))).toEqual(["offer_end_date"]);
    expect(keys(filterVariables(LIST, "purchase_a"))).toEqual(["purchase_apr"]);
    expect(keys(filterVariables(LIST, "  Purchase   APR "))).toEqual(["purchase_apr"]);
  });

  it("ends with Create, carrying the query", () => {
    expect(pickerItems(LIST, "Offer end ").at(-1)).toEqual({ kind: "create", label: "Offer end" });
    expect(pickerItems(LIST, "zzz")).toEqual([{ kind: "create", label: "zzz" }]);
    expect(pickerItems(LIST, "")).toHaveLength(LIST.length + 1);
  });

  it("doesn't offer Create for a query that already names a variable (label any case, or key)", () => {
    const kinds = (query: string) => pickerItems(LIST, query).map((i) => (i.kind === "create" ? "create" : i.variable.key));
    expect(kinds("purchase apr")).toEqual(["purchase_apr"]);
    expect(kinds("  Offer  end date ")).toEqual(["offer_end_date"]);
    expect(kinds("first_name")).toEqual(["first_name"]);
    expect(kinds("Purchase")).toEqual(["purchase_apr", "create"]);
  });

  it("closes on a leading space, a closing }} or a runaway query", () => {
    expect(isPickerQuery("Offer end date")).toBe(true);
    expect(isPickerQuery("")).toBe(true);
    expect(isPickerQuery(" offer")).toBe(false);
    expect(isPickerQuery("first_name}} and")).toBe(false);
    expect(isPickerQuery("x".repeat(80))).toBe(false);
  });
});

describe("create form", () => {
  const taken = new Set(keys(LIST));

  it("generates a snake_case key from the label, unique in the list", () => {
    expect(generatedKey("Offer end date", new Set())).toBe("offer_end_date");
    expect(generatedKey("Offer end date", taken)).toBe("offer_end_date_2");
    expect(uniqueKey("a", new Set(["a", "a_2"]))).toBe("a_3");
    expect(newDraft("  Bonus points ", taken)).toEqual({
      label: "Bonus points",
      key: "bonus_points",
      type: "text",
      required: true,
      sample: "",
    });
  });

  it("validates label, key format and uniqueness", () => {
    const draft = newDraft("Bonus points", taken);
    expect(validateDraft({ ...draft, label: " " }, { takenKeys: taken })).toEqual({ ok: false, errors: { label: "Enter a label" } });
    expect(validateDraft({ ...draft, key: "" }, { takenKeys: taken })).toMatchObject({ errors: { key: "Enter a key" } });
    expect(validateDraft({ ...draft, key: "Bonus" }, { takenKeys: taken })).toMatchObject({ ok: false, errors: { key: expect.any(String) } });
    expect(validateDraft({ ...draft, key: "first_name" }, { takenKeys: taken })).toMatchObject({
      errors: { key: "Another variable has this key" },
    });
  });

  it("accepts an empty sample and canonicalizes a given one", () => {
    const none = new Set<string>();
    const draft = { ...newDraft("Offer end date", none), type: "date" as const };
    expect(validateDraft(draft, { takenKeys: none })).toEqual({
      ok: true,
      variable: { key: "offer_end_date", label: "Offer end date", type: "date", required: true, sample: "" },
    });
    expect(validateDraft({ ...draft, sample: "3/4/2027" }, { takenKeys: none })).toMatchObject({
      ok: true,
      variable: { sample: "2027-03-04" },
    });
    expect(validateDraft({ ...draft, sample: "soon" }, { takenKeys: none })).toMatchObject({
      ok: false,
      errors: { sample: "Enter a date, like 2027-03-04" },
    });
  });

  it("keeps a sample across a type change only when it still fits", () => {
    expect(sampleForType("2027-03-04", "currency")).toBe("");
    expect(sampleForType("1,000", "number")).toBe("1000");
    expect(sampleForType("New jersey", "us_state")).toBe("NJ");
    expect(sampleForType("anything", "text")).toBe("anything");
  });
});
