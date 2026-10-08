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
 * One difference between a variable list and the Active version's list (the consumer contract).
 * Breaking: a required variable added, a variable removed, a key renamed, a type changed,
 * optional made required. Non-breaking: an optional variable added, made optional, a label changed.
 */
export type ContractChangeKind =
  | "added"
  | "removed"
  | "key_renamed"
  | "type_changed"
  | "made_required"
  | "made_optional"
  | "label_changed";

export interface ContractChange {
  kind: ContractChangeKind;
  /** The variable's key in the new list (the old key for "removed"). */
  key: string;
  breaking: boolean;
  /** Previous value: old key, old type, old label. */
  from?: string;
  /** New value: new key, new type, new label. */
  to?: string;
  type?: VariableType;
  required?: boolean;
}

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
