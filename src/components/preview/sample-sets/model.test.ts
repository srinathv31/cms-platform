import { describe, expect, it } from "vitest";
import type { SampleSet, Variable } from "@/editor/model/types";
import { defaultSampleSets, sampleSetValues } from "@/editor/model/sample-sets";
import {
  addSet,
  commitInput,
  createSet,
  findSet,
  isDefaultSet,
  isEdited,
  listSets,
  newSetId,
  nextSetName,
  removeSet,
  renameSet,
  resolveSetValues,
  setValue,
  validateSetName,
  MAX_SET_NAME_LENGTH,
} from "./model";

const TODAY = "2026-10-04";

const v = (key: string, type: Variable["type"], label: string, required = true, sample = ""): Variable => ({
  key,
  label,
  type,
  required,
  sample,
});

const VARIABLES: Variable[] = [
  v("first_name", "text", "First name", true, "Maya"),
  v("annual_fee", "currency", "Annual fee", true, "95"),
  v("purchase_apr", "percent", "Purchase APR"),
  v("offer_end_date", "date", "Offer end date"),
  v("home_state", "us_state", "Home state"),
  v("promo_code", "text", "Promo code", false),
];

const custom = (id: string, name: string, values: SampleSet["values"] = {}): SampleSet => ({ id, name, values });

describe("listSets", () => {
  it("makes the three default sets from an empty list, in order", () => {
    const sets = listSets([], VARIABLES, TODAY);
    expect(sets.map((s) => s.id)).toEqual(["typical", "long", "minimum"]);
    expect(sets.map((s) => s.name)).toEqual(["Typical customer", "Long name and maximum values", "Minimum values"]);
    expect(sets).toEqual(defaultSampleSets(VARIABLES, TODAY));
  });

  it("puts the defaults first and keeps custom sets in stored order", () => {
    const stored = [custom("b", "Beta"), { ...defaultSampleSets(VARIABLES, TODAY)[2] }, custom("a", "Alpha")];
    const sets = listSets(stored, VARIABLES, TODAY);
    expect(sets.map((s) => s.id)).toEqual(["typical", "long", "minimum", "b", "a"]);
  });

  it("keeps a stored default's own values and generates only the missing ones", () => {
    const edited: SampleSet = { id: "long", name: "Long name and maximum values", values: { first_name: "Zed" } };
    const sets = listSets([edited], VARIABLES, TODAY);
    expect(sets[1]).toBe(edited);
    expect(sets[0]).toEqual(defaultSampleSets(VARIABLES, TODAY)[0]);
    expect(sets[2]).toEqual(defaultSampleSets(VARIABLES, TODAY)[2]);
  });

  it("doesn't change its input", () => {
    const stored = [custom("a", "Alpha")];
    const before = JSON.stringify(stored);
    listSets(stored, VARIABLES, TODAY);
    expect(JSON.stringify(stored)).toBe(before);
    expect(stored).toHaveLength(1);
  });
});

describe("findSet", () => {
  const sets = listSets([custom("a", "Alpha")], VARIABLES, TODAY);
  it("finds a set by id", () => {
    expect(findSet(sets, "a")?.name).toBe("Alpha");
    expect(findSet(sets, "long")?.id).toBe("long");
  });
  it("returns undefined for an unknown id", () => {
    expect(findSet(sets, "nope")).toBeUndefined();
  });
});

describe("isDefaultSet", () => {
  it("is true for the three defaults only", () => {
    expect(["typical", "long", "minimum"].every(isDefaultSet)).toBe(true);
    expect(isDefaultSet("a")).toBe(false);
  });
});

describe("resolveSetValues", () => {
  const typical = (values: SampleSet["values"]): SampleSet => ({ id: "typical", name: "Typical customer", values });

  it("matches sampleSetValues when nothing was emptied", () => {
    const set = typical({ first_name: "Zed" });
    expect(resolveSetValues(set, VARIABLES, TODAY)).toEqual(sampleSetValues(set, VARIABLES, TODAY));
  });

  it("fills a variable the set has no value for", () => {
    const resolved = resolveSetValues(typical({}), VARIABLES, TODAY);
    expect(resolved.first_name).toBe("Maya");
    expect(resolved.annual_fee).toBe("95");
  });

  it("keeps a value emptied on purpose empty (sampleSetValues would refill it)", () => {
    const set = typical({ first_name: "", annual_fee: "  " });
    const resolved = resolveSetValues(set, VARIABLES, TODAY);
    expect(resolved.first_name).toBe("");
    expect(resolved.annual_fee).toBe("");
    expect(sampleSetValues(set, VARIABLES, TODAY).first_name).toBe("Maya");
  });

  it("treats null as a gap, not as emptied", () => {
    const set = typical({ first_name: null as unknown as string });
    expect(resolveSetValues(set, VARIABLES, TODAY).first_name).toBe("Maya");
  });

  it("drops keys that aren't variables", () => {
    const resolved = resolveSetValues(typical({ gone: "x" }), VARIABLES, TODAY);
    expect(Object.keys(resolved)).toEqual(VARIABLES.map((variable) => variable.key));
  });
});

describe("commitInput", () => {
  const type = (t: Variable["type"]) => ({ type: t });

  it("normalizes friendly input to canonical", () => {
    expect(commitInput(type("currency"), "$1,000")).toEqual({ ok: true, value: "1000" });
    expect(commitInput(type("percent"), "21.99%")).toEqual({ ok: true, value: "21.99" });
    expect(commitInput(type("date"), "3/4/2027")).toEqual({ ok: true, value: "2027-03-04" });
    expect(commitInput(type("us_state"), "new jersey")).toEqual({ ok: true, value: "NJ" });
    expect(commitInput(type("number"), "20,000")).toEqual({ ok: true, value: "20000" });
  });

  it("trims text", () => {
    expect(commitInput(type("text"), "  Maya  ")).toEqual({ ok: true, value: "Maya" });
  });

  it("allows an emptied value, whatever the type", () => {
    expect(commitInput(type("text"), "")).toEqual({ ok: true, value: "" });
    expect(commitInput(type("currency"), "   ")).toEqual({ ok: true, value: "" });
    expect(commitInput(type("date"), "")).toEqual({ ok: true, value: "" });
  });

  it("refuses what the type can't read, with validateValue's message", () => {
    expect(commitInput(type("currency"), "lots")).toEqual({ ok: false, message: "Enter an amount, like 1000.00" });
    expect(commitInput(type("date"), "2027-02-30")).toEqual({ ok: false, message: "Enter a date, like 2027-03-04" });
    expect(commitInput(type("us_state"), "Narnia")).toEqual({ ok: false, message: "Enter a US state, like NJ" });
  });
});

describe("isEdited", () => {
  const sets = listSets([], VARIABLES, TODAY);

  it("is false for a copy of a default set", () => {
    const copy = createSet(sets, sets[1], VARIABLES, TODAY);
    expect(isEdited(copy, VARIABLES, TODAY)).toBe(false);
  });

  it("is true once a value differs from every default, and false again when it is put back", () => {
    const copy = createSet(sets, sets[0], VARIABLES, TODAY);
    const changed = { ...copy, values: { ...copy.values, first_name: "Zed" } };
    expect(isEdited(changed, VARIABLES, TODAY)).toBe(true);
    expect(isEdited({ ...changed, values: { ...changed.values, first_name: "Maya" } }, VARIABLES, TODAY)).toBe(false);
  });

  it("counts an emptied value as an edit", () => {
    const copy = createSet(sets, sets[0], VARIABLES, TODAY);
    expect(isEdited({ ...copy, values: { ...copy.values, promo_code: "" } }, VARIABLES, TODAY)).toBe(true);
  });
});

describe("nextSetName", () => {
  it("is Sample set 4 with the three defaults", () => {
    expect(nextSetName(listSets([], VARIABLES, TODAY))).toBe("Sample set 4");
  });

  it("follows the highest number in use", () => {
    const sets = listSets([custom("a", "Sample set 4"), custom("b", "Sample set 7")], VARIABLES, TODAY);
    expect(nextSetName(sets)).toBe("Sample set 8");
  });

  it("doesn't reuse a number when a set was renamed or deleted", () => {
    const renamed = listSets([custom("a", "Holiday")], VARIABLES, TODAY);
    expect(nextSetName(renamed)).toBe("Sample set 5");
    const deleted = removeSet(listSets([custom("a", "Sample set 4"), custom("b", "Sample set 5")], VARIABLES, TODAY), "a");
    expect(nextSetName(deleted)).toBe("Sample set 6");
  });
});

describe("newSetId", () => {
  it("is short and prefixed", () => {
    expect(newSetId([])).toMatch(/^set_[a-z2-9]{6}$/);
  });

  it("never collides with an id in the list", () => {
    // A random source that repeats itself: the first id it makes is taken, so the second draw must differ.
    const draws = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const random = () => draws[i++ % draws.length];
    const first = newSetId([], () => 0);
    const next = newSetId([custom(first, "x")], random);
    expect(next).not.toBe(first);
  });
});

describe("createSet and addSet", () => {
  const sets = listSets([custom("a", "Alpha", { first_name: "Zed" })], VARIABLES, TODAY);

  it("copies the source's resolved values into a new custom set", () => {
    const made = createSet(sets, findSet(sets, "a")!, VARIABLES, TODAY);
    expect(made.name).toBe("Sample set 5");
    expect(made.id).not.toBe("a");
    expect(isDefaultSet(made.id)).toBe(false);
    expect(made.values).toEqual(resolveSetValues(findSet(sets, "a")!, VARIABLES, TODAY));
    expect(made.values.first_name).toBe("Zed");
    expect(Object.keys(made.values)).toEqual(VARIABLES.map((variable) => variable.key));
  });

  it("adds the set at the end without changing the rest", () => {
    const made = createSet(sets, sets[0], VARIABLES, TODAY);
    const next = addSet(sets, made);
    expect(next).toHaveLength(sets.length + 1);
    expect(next.at(-1)).toBe(made);
    expect(next.slice(0, -1)).toEqual(sets);
  });
});

describe("setValue", () => {
  const sets = listSets([custom("a", "Alpha")], VARIABLES, TODAY);

  it("changes one value in one set", () => {
    const next = setValue(sets, "a", "first_name", "Zed");
    expect(findSet(next, "a")?.values.first_name).toBe("Zed");
    expect(next[0]).toBe(sets[0]);
    expect(sets[3].values.first_name).toBeUndefined();
  });

  it("works on a default set", () => {
    const next = setValue(sets, "long", "annual_fee", "1234567");
    expect(findSet(next, "long")?.values.annual_fee).toBe("1234567");
  });

  it("leaves the list as it was for an unknown id", () => {
    expect(setValue(sets, "nope", "first_name", "Zed")).toEqual(sets);
  });
});

describe("validateSetName and renameSet", () => {
  const sets = listSets([custom("a", "Alpha"), custom("b", "Beta")], VARIABLES, TODAY);

  it("trims and collapses spaces", () => {
    expect(validateSetName(sets, "a", "  Holiday   promo ")).toEqual({ ok: true, name: "Holiday promo" });
  });

  it("refuses an empty name", () => {
    expect(validateSetName(sets, "a", "   ")).toEqual({ ok: false, message: "Enter a name" });
  });

  it("allows a name of exactly 40 characters and refuses one of 41", () => {
    expect(MAX_SET_NAME_LENGTH).toBe(40);
    const forty = "x".repeat(40);
    expect(validateSetName(sets, "a", forty)).toEqual({ ok: true, name: forty });
    expect(validateSetName(sets, "a", `${forty}x`)).toEqual({ ok: false, message: "Use 40 characters or fewer" });
    // Counted after the spaces are tidied: the padding doesn't use any of the 40.
    expect(validateSetName(sets, "a", `  ${forty}  `)).toEqual({ ok: true, name: forty });
  });

  it("refuses another set's name, case aside, but not its own", () => {
    expect(validateSetName(sets, "a", "beta")).toEqual({ ok: false, message: "Another set has this name" });
    expect(validateSetName(sets, "a", "Typical customer")).toEqual({ ok: false, message: "Another set has this name" });
    expect(validateSetName(sets, "a", "ALPHA")).toEqual({ ok: true, name: "ALPHA" });
  });

  it("renames a custom set", () => {
    expect(findSet(renameSet(sets, "a", "Holiday"), "a")?.name).toBe("Holiday");
  });

  it("keeps the old name when the new one doesn't validate", () => {
    expect(renameSet(sets, "a", "")).toEqual(sets);
    expect(renameSet(sets, "a", "Beta")).toEqual(sets);
  });

  it("never renames a default set", () => {
    expect(renameSet(sets, "typical", "Mine")).toEqual(sets);
  });
});

describe("removeSet", () => {
  const sets = listSets([custom("a", "Alpha"), custom("b", "Beta")], VARIABLES, TODAY);

  it("removes a custom set", () => {
    expect(removeSet(sets, "a").map((s) => s.id)).toEqual(["typical", "long", "minimum", "b"]);
  });

  it("never removes a default set", () => {
    expect(removeSet(sets, "long")).toEqual(sets);
  });

  it("leaves the list as it was for an unknown id", () => {
    expect(removeSet(sets, "nope")).toEqual(sets);
  });
});
