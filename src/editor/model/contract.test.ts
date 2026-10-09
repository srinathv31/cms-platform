import { describe, expect, it } from "vitest";
import { diffVariables, flaggedKeys, isBreaking } from "./contract";
import type { Variable } from "./types";

const v = (key: string, patch: Partial<Variable> = {}): Variable => ({
  key,
  label: key.replace(/_/g, " "),
  type: "text",
  required: false,
  sample: "x",
  ...patch,
});

describe("diffVariables", () => {
  it("is empty for an identical list", () => {
    const list = [v("first_name", { required: true }), v("purchase_apr", { type: "percent" })];
    expect(diffVariables(list, list.map((x) => ({ ...x })))).toEqual([]);
  });

  it("adding a required variable is breaking; adding an optional one is not", () => {
    const changes = diffVariables(
      [v("first_name")],
      [v("first_name"), v("annual_fee", { type: "currency", required: true }), v("nickname")],
    );
    expect(changes).toEqual([
      { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
      { kind: "added", key: "nickname", breaking: false, type: "text", required: false },
    ]);
  });

  it("removing a variable is breaking", () => {
    expect(diffVariables([v("first_name"), v("last_name")], [v("first_name")])).toEqual([
      { kind: "removed", key: "last_name", breaking: true, type: "text", required: false },
    ]);
  });

  it("a type change is breaking", () => {
    expect(diffVariables([v("bonus", { type: "text" })], [v("bonus", { type: "number" })])).toEqual([
      { kind: "type_changed", key: "bonus", breaking: true, from: "text", to: "number" },
    ]);
  });

  it("optional → required is breaking; required → optional is not", () => {
    expect(diffVariables([v("a")], [v("a", { required: true })])).toEqual([{ kind: "made_required", key: "a", breaking: true }]);
    expect(diffVariables([v("a", { required: true })], [v("a")])).toEqual([{ kind: "made_optional", key: "a", breaking: false }]);
  });

  it("a label change is non-breaking and not flagged", () => {
    const changes = diffVariables([v("a", { label: "Name" })], [v("a", { label: "First name" })]);
    expect(changes).toEqual([{ kind: "label_changed", key: "a", breaking: false, from: "Name", to: "First name" }]);
    expect(isBreaking(changes)).toBe(false);
    expect(flaggedKeys(changes).size).toBe(0);
  });

  it("a different variable under a new key is a removal and an addition", () => {
    const kinds = diffVariables([v("first_name")], [v("given_name")]).map((c) => c.kind);
    expect(kinds).toEqual(["added", "removed"]);
  });

  it("reports several changes on one variable", () => {
    const kinds = diffVariables(
      [v("fee", { type: "number", label: "Fee" })],
      [v("fee", { type: "currency", required: true, label: "Annual fee" })],
    ).map((c) => c.kind);
    expect(kinds).toEqual(["type_changed", "made_required", "label_changed"]);
  });
});

describe("diffVariables: renames, by the variable's id", () => {
  const RENAMED = { kind: "key_renamed", breaking: true } as const;
  /** A variable whose label stays put whatever its key, so only the key moves. */
  const same = (key: string, patch: Partial<Variable> = {}) => v(key, { label: "Rate", ...patch });

  it("a renamed variable (its old key kept as its id) is one breaking key_renamed", () => {
    const changes = diffVariables([same("first_name")], [same("given_name", { id: "first_name" })]);
    expect(changes).toEqual([{ ...RENAMED, key: "given_name", from: "first_name", to: "given_name" }]);
    expect(isBreaking(changes)).toBe(true);
    expect(flaggedKeys(changes)).toEqual(new Set(["given_name"]));
  });

  it("a chained rename a → b → c is one rename a → c", () => {
    // The id is the key the variable had in the baseline, whatever it went through since.
    expect(diffVariables([same("a")], [same("c", { id: "a" })])).toEqual([{ ...RENAMED, key: "c", from: "a", to: "c" }]);
  });

  it("renamed back to its key, it is no change: with or without the id it no longer needs", () => {
    expect(diffVariables([same("a")], [same("a")])).toEqual([]);
    expect(diffVariables([same("a")], [same("a", { id: "a" })])).toEqual([]);
  });

  it("matches a fresh id across versions, so a variable made in one version and renamed in the next is a rename", () => {
    const id = "6f1c2b7e-4a0d-4f43-9a58-3a6a1f0f7b21";
    expect(diffVariables([same("promo", { id })], [same("promo_code", { id })])).toEqual([
      { ...RENAMED, key: "promo_code", from: "promo", to: "promo_code" },
    ]);
  });

  it("a renamed baseline variable keeps its id: renaming it again pairs on the id", () => {
    expect(diffVariables([same("b", { id: "a" })], [same("c", { id: "a" })])).toEqual([{ ...RENAMED, key: "c", from: "b", to: "c" }]);
  });

  it("a new variable that takes a renamed variable's old key is an addition beside the rename (D11)", () => {
    const changes = diffVariables([same("rate", { type: "percent" })], [
      same("apr", { id: "rate", type: "percent" }),
      same("rate", { id: "0b6f4c1e-5a7d-4e8b-9c2f-3d1a6e7b8c90", required: true }),
    ]);
    expect(changes).toEqual([
      { ...RENAMED, key: "apr", from: "rate", to: "apr" },
      { kind: "added", key: "rate", breaking: true, type: "text", required: true },
    ]);
  });

  it("a variable deleted and made again under its key is the same variable to consumers", () => {
    expect(diffVariables([same("rate")], [same("rate", { id: "0b6f4c1e-5a7d-4e8b-9c2f-3d1a6e7b8c90" })])).toEqual([]);
  });

  it("a rename and a type change on one variable are both reported", () => {
    expect(diffVariables([same("fee", { type: "number" })], [same("annual_fee", { id: "fee", type: "currency" })])).toEqual([
      { ...RENAMED, key: "annual_fee", from: "fee", to: "annual_fee" },
      { kind: "type_changed", key: "annual_fee", breaking: true, from: "number", to: "currency" },
    ]);
  });

  it("two keys swapped are two renames", () => {
    expect(diffVariables([same("a"), same("b")], [same("b", { id: "a" }), same("a", { id: "b" })])).toEqual([
      { ...RENAMED, key: "b", from: "a", to: "b" },
      { ...RENAMED, key: "a", from: "b", to: "a" },
    ]);
  });

  it("a key renamed onto a removed variable's key: the rename, and the other removed", () => {
    expect(diffVariables([same("a"), same("b")], [same("b", { id: "a" })])).toEqual([
      { ...RENAMED, key: "b", from: "a", to: "b" },
      { kind: "removed", key: "b", breaking: true, type: "text", required: false },
    ]);
  });
});
