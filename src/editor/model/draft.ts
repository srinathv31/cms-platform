// The variable form's rules (create in the `{{` picker, New variable and edit in the panel).
// Pure TypeScript: the React form only holds input state and shows these messages.

import type { Variable, VariableType } from "./types";
import { isValidKey, toKey, uniqueKey, validateValue } from "./variables";

/** What the form holds while someone types. `sample` is raw input (canonicalized on submit). */
export interface VariableDraft {
  label: string;
  key: string;
  type: VariableType;
  required: boolean;
  sample: string;
}

export type DraftField = "label" | "key" | "sample";
export type DraftErrors = Partial<Record<DraftField, string>>;

export type DraftResult = { ok: true; variable: Variable } | { ok: false; errors: DraftErrors };

export interface DraftContext {
  /** Keys already in the list, except the one being edited. */
  takenKeys: ReadonlySet<string>;
}

/** A new draft. The key is generated from the label (and made unique). */
export function newDraft(label: string, takenKeys: ReadonlySet<string>, type: VariableType = "text"): VariableDraft {
  const clean = label.trim();
  return { label: clean, key: generatedKey(clean, takenKeys), type, required: true, sample: "" };
}

export function draftFromVariable(variable: Variable): VariableDraft {
  return { ...variable };
}

/** The key a label produces: snake_case, unique in the list. */
export function generatedKey(label: string, takenKeys: ReadonlySet<string>): string {
  return uniqueKey(toKey(label), takenKeys);
}

/** Checks a draft. The sample is optional; when given it must suit the type and is stored canonically. */
export function validateDraft(draft: VariableDraft, { takenKeys }: DraftContext): DraftResult {
  const errors: DraftErrors = {};
  const label = draft.label.trim();
  const key = draft.key.trim();

  if (!label) errors.label = "Enter a label";

  if (!key) errors.key = "Enter a key";
  else if (!isValidKey(key)) errors.key = "Use a–z, 0–9 and _, starting with a letter";
  else if (takenKeys.has(key)) errors.key = "Another variable has this key";

  let sample = "";
  if (draft.sample.trim()) {
    const checked = validateValue(draft.type, draft.sample);
    if (checked.ok) sample = checked.value;
    else errors.sample = checked.message;
  }

  if (errors.label || errors.key || errors.sample) return { ok: false, errors };
  return { ok: true, variable: { key, label, type: draft.type, required: draft.required, sample } };
}

/**
 * Keeps a sample that still suits the type after the type changes, and clears one that doesn't
 * (a date doesn't survive a switch to Currency).
 */
export function sampleForType(sample: string, type: VariableType): string {
  if (!sample.trim()) return "";
  const checked = validateValue(type, sample);
  return checked.ok ? (type === "text" ? sample : checked.value) : "";
}
