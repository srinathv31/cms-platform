import { describe, expect, it } from "vitest";
import { diffVariables } from "../model/contract";
import type { Variable } from "../model/types";
import { createVariableStore } from "./variable-store";

const v = (key: string, patch: Partial<Variable> = {}): Variable => ({
  key,
  label: key.replace(/_/g, " "),
  type: "text",
  required: true,
  sample: "",
  ...patch,
});

const LIST = [v("first_name"), v("purchase_apr", { type: "percent" }), v("home_state", { type: "us_state" })];

describe("variable store actions", () => {
  it("creates at the end (or at an index) and rejects bad or taken keys", () => {
    const store = createVariableStore(LIST);
    expect(store.getState().create(v("annual_fee"))).toEqual({ ok: true });
    expect(store.getState().variables.map((x) => x.key)).toEqual(["first_name", "purchase_apr", "home_state", "annual_fee"]);
    expect(store.getState().create(v("bonus"), 1)).toEqual({ ok: true });
    expect(store.getState().variables[1].key).toBe("bonus");
    expect(store.getState().create(v("first_name"))).toEqual({ ok: false, reason: "duplicate_key" });
    expect(store.getState().create(v("First Name"))).toEqual({ ok: false, reason: "invalid_key" });
  });

  it("updates in place, keeps unrelated variables' identity", () => {
    const store = createVariableStore(LIST);
    const before = store.getState().byKey.get("purchase_apr");
    store.getState().update("first_name", { label: "Given name", required: false });
    expect(store.getState().byKey.get("first_name")).toMatchObject({ label: "Given name", required: false });
    expect(store.getState().byKey.get("purchase_apr")).toBe(before);
    expect(store.getState().variables[0].key).toBe("first_name");
  });

  it("a no-op update doesn't change the list", () => {
    const store = createVariableStore(LIST);
    const list = store.getState().variables;
    store.getState().update("first_name", { label: "first name" });
    expect(store.getState().variables).toBe(list);
  });

  it("gives a created variable a fresh id, never a key, replacing any it came with", () => {
    const store = createVariableStore(LIST);
    store.getState().create(v("annual_fee"));
    store.getState().create(v("bonus", { id: "first_name" }));
    const [fee, bonus] = [store.getState().byKey.get("annual_fee")!, store.getState().byKey.get("bonus")!];
    expect(fee.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(bonus.id).not.toBe("first_name");
    expect(bonus.id).not.toBe(fee.id);
  });

  it("keeps a renamed variable's identity as its id, so the saved list carries the rename", () => {
    const store = createVariableStore(LIST);
    expect(store.getState().update("purchase_apr", { key: "purchase_rate" })).toEqual({ ok: true });
    expect(store.getState().byKey.get("purchase_rate")).toEqual({ ...LIST[1], id: "purchase_apr", key: "purchase_rate" });
    // A chain a → b → c keeps the first key: one rename against the list it started from.
    store.getState().update("purchase_rate", { key: "apr" });
    expect(store.getState().byKey.get("apr")?.id).toBe("purchase_apr");
    expect(diffVariables(LIST, store.getState().variables)).toEqual([
      { kind: "key_renamed", key: "apr", breaking: true, from: "purchase_apr", to: "apr" },
    ]);
    // Renamed back to its key, it needs no id, and nothing changed.
    store.getState().update("apr", { key: "purchase_apr" });
    expect(store.getState().byKey.get("purchase_apr")).toEqual(LIST[1]);
    expect(store.getState().byKey.get("purchase_apr")).not.toHaveProperty("id");
    expect(diffVariables(LIST, store.getState().variables)).toEqual([]);
  });

  it("never changes an id: a created variable keeps its own through renames, and a patch's id is ignored", () => {
    const store = createVariableStore(LIST, () => "fresh-1");
    store.getState().create(v("promo"));
    store.getState().update("promo", { key: "promo_code", id: "first_name" });
    expect(store.getState().byKey.get("promo_code")?.id).toBe("fresh-1");
    store.getState().update("promo_code", { key: "promo" });
    expect(store.getState().byKey.get("promo")?.id).toBe("fresh-1");
    store.getState().update("first_name", { label: "Given name", id: "other" });
    expect(store.getState().byKey.get("first_name")).not.toHaveProperty("id");
  });

  it("a new variable on a renamed variable's old key is a variable of its own (D11)", () => {
    const store = createVariableStore(LIST, () => "fresh-1");
    store.getState().update("purchase_apr", { key: "apr" });
    store.getState().create(v("purchase_apr", { type: "percent" }));
    expect(store.getState().byKey.get("purchase_apr")?.id).toBe("fresh-1");
    expect(diffVariables(LIST, store.getState().variables)).toEqual([
      { kind: "key_renamed", key: "apr", breaking: true, from: "purchase_apr", to: "apr" },
      { kind: "added", key: "purchase_apr", breaking: true, type: "percent", required: true },
    ]);
  });

  it("a rename and a type change on one variable both reach the diff", () => {
    const store = createVariableStore(LIST);
    store.getState().update("home_state", { key: "state", type: "text" });
    expect(diffVariables(LIST, store.getState().variables)).toEqual([
      { kind: "key_renamed", key: "state", breaking: true, from: "home_state", to: "state" },
      { kind: "type_changed", key: "state", breaking: true, from: "us_state", to: "text" },
    ]);
  });

  it("forwards every old key to the current one", () => {
    const store = createVariableStore(LIST);
    store.getState().update("purchase_apr", { key: "purchase_rate" });
    store.getState().update("purchase_rate", { key: "apr" });
    expect(store.getState().forwards).toEqual({ purchase_apr: "apr", purchase_rate: "apr" });
  });

  it("rejects a rename onto a taken or invalid key", () => {
    const store = createVariableStore(LIST);
    expect(store.getState().update("first_name", { key: "home_state" })).toEqual({ ok: false, reason: "duplicate_key" });
    expect(store.getState().update("first_name", { key: "9lives" })).toEqual({ ok: false, reason: "invalid_key" });
    expect(store.getState().update("nope", { label: "x" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("removes into a tombstone and restores at the old place, with its rename", () => {
    const store = createVariableStore(LIST);
    store.getState().update("purchase_apr", { key: "apr" });
    store.getState().remove("apr");
    expect(store.getState().byKey.has("apr")).toBe(false);
    expect(diffVariables(LIST, store.getState().variables).map((c) => c.kind)).toEqual(["removed"]);
    expect(store.getState().tombstones.get("apr")).toMatchObject({ index: 1, variable: { key: "apr", id: "purchase_apr" } });

    expect(store.getState().restore("apr")).toEqual({ ok: true });
    expect(store.getState().variables.map((x) => x.key)).toEqual(["first_name", "apr", "home_state"]);
    expect(diffVariables(LIST, store.getState().variables).map((c) => c.kind)).toEqual(["key_renamed"]);
    expect(store.getState().tombstones.size).toBe(0);
    expect(store.getState().restore("apr")).toEqual({ ok: false, reason: "not_found" });
  });

  it("creating a key again clears its tombstone", () => {
    const store = createVariableStore(LIST);
    store.getState().remove("home_state");
    store.getState().create(v("home_state"));
    expect(store.getState().tombstones.has("home_state")).toBe(false);
  });
});
