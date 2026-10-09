// Pure TypeScript model shared by the editor and the app. No React, no TipTap runtime.
// The editor owns these so it stays self-contained; @/domain re-exports them.

import type { JSONContent } from "@tiptap/core";

export type { JSONContent };

/** A JSON value that can be a node: an object that isn't an array. Anything else, the schema parse refuses. */
export function isNode(value: unknown): value is JSONContent {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const VARIABLE_TYPES = [
  "text",
  "currency",
  "percent",
  "date",
  "number",
  "us_state",
] as const;

export type VariableType = (typeof VARIABLE_TYPES)[number];

/**
 * A typed placeholder. The variable list of a version is the consumer's API contract.
 * Sample values are stored in canonical string form:
 *   text "Maya" · currency "1000" · percent "21.99" · date "2027-03-04" · number "20000" · us_state "NJ"
 */
export interface Variable {
  /**
   * What the variable is, across key renames and across versions, so the contract diff tells a rename
   * from a removal plus an addition (decision 0022). Absent, the key is the identity. The variable
   * store sets it: a variable created in the editor gets a fresh id (never a valid key), and one that
   * came without (a starter's, an import's, the seed's) gets the key it had when its key is first
   * renamed, so its identity never changes. Unique within a list, never shown, never sent to consumers.
   */
  id?: string;
  key: string; // snake_case, unique within a template
  label: string;
  type: VariableType;
  required: boolean;
  sample: string;
}

export type VariableValue = string | number;
export type VariableValues = Record<string, VariableValue>;

export interface SampleSet {
  id: string;
  name: string;
  values: VariableValues;
}

/**
 * One difference between a variable list and its baseline (the list consumers render now: the
 * consumer contract), one member per kind, each with exactly its own fields. `key` is the variable's
 * key in the new list (the baseline's for "removed").
 * Breaking: a required variable added, a variable removed, a key renamed, a type changed,
 * optional made required. Non-breaking: an optional variable added, made optional, a label changed.
 */
export type ContractChange =
  /** A variable the baseline doesn't have. Breaking when it is required. */
  | { kind: "added"; key: string; breaking: boolean; type: VariableType; required: boolean }
  /** A baseline variable the list no longer has; `key` is its key there. */
  | { kind: "removed"; key: string; breaking: true; type: VariableType; required: boolean }
  /** The same variable under a new key: `key` and `to` are the new key, `from` the baseline's. */
  | { kind: "key_renamed"; key: string; breaking: true; from: string; to: string }
  | { kind: "type_changed"; key: string; breaking: true; from: VariableType; to: VariableType }
  | { kind: "made_required"; key: string; breaking: true }
  | { kind: "made_optional"; key: string; breaking: false }
  | { kind: "label_changed"; key: string; breaking: false; from: string; to: string };

export type ContractChangeKind = ContractChange["kind"];

/** A content type's required section, e.g. { key: "legal_notices", title: "Legal notices" }. */
export interface RequiredSection {
  key: string;
  title: string;
}

/** Node names in the shared schema that the app and render pipeline rely on. */
export const NODE = {
  variable: "variable",
  heading: "heading",
  callout: "callout",
} as const;

/** TipTap JSON for a variable node: holds only the key. Label and type come from the variable list. */
export interface VariableNodeJSON extends JSONContent {
  type: typeof NODE.variable;
  attrs: { key: string };
}
