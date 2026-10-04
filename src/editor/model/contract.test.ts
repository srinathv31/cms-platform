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
      { kind: "type_changed", key: "bonus", breaking: true, from: "text", to: "number", type: "number" },
    ]);
  });

  it("optional → required is breaking; required → optional is not", () => {
    expect(diffVariables([v("a")], [v("a", { required: true })])[0]).toMatchObject({
      kind: "made_required",
      breaking: true,
    });
    expect(diffVariables([v("a", { required: true })], [v("a")])[0]).toMatchObject({
      kind: "made_optional",
      breaking: false,
    });
  });

  it("a label change is non-breaking and not flagged", () => {
    const changes = diffVariables([v("a", { label: "Name" })], [v("a", { label: "First name" })]);
    expect(changes).toEqual([{ kind: "label_changed", key: "a", breaking: false, from: "Name", to: "First name" }]);
    expect(isBreaking(changes)).toBe(false);
    expect(flaggedKeys(changes).size).toBe(0);
  });

  it("without rename info a key change reads as removed + added", () => {
    const kinds = diffVariables([v("first_name")], [v("given_name")]).map((c) => c.kind);
    expect(kinds).toEqual(["added", "removed"]);
  });

  it("with rename info a key change is one breaking key_renamed", () => {
    const changes = diffVariables([v("first_name", { label: "First" })], [v("given_name", { label: "First" })], {
      renames: { given_name: "first_name" },
    });
    expect(changes).toEqual([
      { kind: "key_renamed", key: "given_name", breaking: true, from: "first_name", to: "given_name" },
    ]);
    expect(flaggedKeys(changes)).toEqual(new Set(["given_name"]));
  });

  it("reports several changes on one variable", () => {
    const kinds = diffVariables(
      [v("fee", { type: "number", label: "Fee" })],
      [v("fee", { type: "currency", required: true, label: "Annual fee" })],
    ).map((c) => c.kind);
    expect(kinds).toEqual(["type_changed", "made_required", "label_changed"]);
  });
});
