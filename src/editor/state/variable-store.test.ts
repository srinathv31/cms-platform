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

  it("tracks key renames for the contract diff, chaining back to the key at load", () => {
    const store = createVariableStore(LIST);
    expect(store.getState().update("purchase_apr", { key: "purchase_rate" })).toEqual({ ok: true });
    expect(store.getState().renames).toEqual({ purchase_rate: "purchase_apr" });
    store.getState().update("purchase_rate", { key: "apr" });
    expect(store.getState().renames).toEqual({ apr: "purchase_apr" });
    expect(diffVariables(LIST, store.getState().variables, { renames: store.getState().renames })).toEqual([
      { kind: "key_renamed", key: "apr", breaking: true, from: "purchase_apr", to: "apr" },
    ]);
    // Renaming back to the original key is no rename at all.
    store.getState().update("apr", { key: "purchase_apr" });
    expect(store.getState().renames).toEqual({});
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
    expect(store.getState().renames).toEqual({});
    expect(store.getState().tombstones.get("apr")).toMatchObject({ index: 1, renamedFrom: "purchase_apr" });

    expect(store.getState().restore("apr")).toEqual({ ok: true });
    expect(store.getState().variables.map((x) => x.key)).toEqual(["first_name", "apr", "home_state"]);
    expect(store.getState().renames).toEqual({ apr: "purchase_apr" });
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
