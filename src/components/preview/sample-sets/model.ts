// The sample-set list as plain data: what the switcher shows and what an edit produces. Pure
// TypeScript (no React), so the preview, the review screen and the server can share it. Every
// function returns new arrays and objects; nothing mutates its input.
//
// The model imports the editor's pure model directly (`@/editor/model/*`, as the editor's README
// allows for code that must not load React or TipTap).

import type { SampleSet, Variable, VariableValue, VariableValues } from "@/editor/model/types";
import { DEFAULT_SAMPLE_SETS, defaultSampleSets, sampleSetValues } from "@/editor/model/sample-sets";
import { validateValue } from "@/editor/model/variables";

// ── Which sets exist ─────────────────────────────────────────────────────────

/** The ids of the three default sets, in switcher order. They can't be renamed or deleted. */
export const DEFAULT_SET_IDS: readonly string[] = DEFAULT_SAMPLE_SETS.map((set) => set.id);

export function isDefaultSet(id: string): boolean {
  return DEFAULT_SET_IDS.includes(id);
}

/**
 * The stored sets plus any default set that is missing (generated with `defaultSampleSets`).
 * The defaults come first, in order (typical, long, minimum); custom sets follow in stored order.
 * A stored default keeps its own values. `today` is YYYY-MM-DD.
 */
export function listSets(stored: readonly SampleSet[], variables: readonly Variable[], today: string): SampleSet[] {
  const generated = defaultSampleSets(variables, today);
  const defaults = generated.map((set) => stored.find((s) => s.id === set.id) ?? set);
  const customs = stored.filter((s) => !isDefaultSet(s.id));
  return [...defaults, ...customs];
}

export function findSet(sets: readonly SampleSet[], id: string): SampleSet | undefined {
  return sets.find((set) => set.id === id);
}

// ── Values ───────────────────────────────────────────────────────────────────

/**
 * The values a set renders with: `sampleSetValues` (the set's own values, gaps filled from the
 * defaults), except that a value the author emptied on purpose stays empty. That is what lets an
 * emptied required variable reach the render route, which then names it as missing.
 * `sampleSetValues` alone would refill it with the generated default.
 */
export function resolveSetValues(set: SampleSet, variables: readonly Variable[], today: string): VariableValues {
  const out = sampleSetValues(set, variables, today);
  for (const v of variables) {
    if (Object.prototype.hasOwnProperty.call(set.values, v.key) && isEmptied(set.values[v.key])) out[v.key] = "";
  }
  return out;
}

export type CommitResult = { ok: true; value: string } | { ok: false; message: string };

/**
 * What typing into a value field commits: blank is allowed (an emptied value, stored as ""), text
 * is trimmed, and everything else goes through `validateValue` for its canonical form
 * ("$1,000" becomes "1000", "new jersey" becomes "NJ"). A refusal carries validateValue's message.
 */
export function commitInput(variable: Pick<Variable, "type">, input: string): CommitResult {
  const raw = input.trim();
  if (raw === "") return { ok: true, value: "" };
  return validateValue(variable.type, raw);
}

/** Whether the set's resolved values differ from every generated default set (it holds the author's edits). */
export function isEdited(set: SampleSet, variables: readonly Variable[], today: string): boolean {
  const mine = resolveSetValues(set, variables, today);
  return !defaultSampleSets(variables, today).some((base) =>
    variables.every((v) => String(mine[v.key]) === String(base.values[v.key])),
  );
}

// ── Making and changing sets ─────────────────────────────────────────────────

const NAME_PREFIX = "Sample set";

/**
 * "Sample set N", where N follows the highest number already used and is never below the count of
 * sets plus one: with the three defaults it is "Sample set 4", then 5, 6 and so on.
 */
export function nextSetName(sets: readonly SampleSet[]): string {
  let highest = 0;
  for (const set of sets) {
    const match = /^Sample set (\d+)$/.exec(set.name.trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${NAME_PREFIX} ${Math.max(highest, sets.length) + 1}`;
}

/** A short random id (`set_k3x9qa`) that no set in the list has. `random` is injectable for tests. */
export function newSetId(sets: readonly SampleSet[], random: () => number = Math.random): string {
  const taken = new Set(sets.map((set) => set.id));
  for (;;) {
    let id = "set_";
    for (let i = 0; i < 6; i++) id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length) % ID_ALPHABET.length];
    if (!taken.has(id)) return id;
  }
}

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * A new custom set: a copy of `source`'s resolved values, the next "Sample set N" name and a fresh
 * id. It isn't in any list yet; `addSet` puts it at the end.
 */
export function createSet(
  sets: readonly SampleSet[],
  source: SampleSet,
  variables: readonly Variable[],
  today: string,
  random?: () => number,
): SampleSet {
  return {
    id: newSetId(sets, random),
    name: nextSetName(sets),
    values: resolveSetValues(source, variables, today),
  };
}

export function addSet(sets: readonly SampleSet[], set: SampleSet): SampleSet[] {
  return [...sets, set];
}

/** The list with one value changed in one set. An unknown id leaves the list as it was. */
export function setValue(sets: readonly SampleSet[], id: string, key: string, value: VariableValue): SampleSet[] {
  return sets.map((set) => (set.id === id ? { ...set, values: { ...set.values, [key]: value } } : set));
}

export type NameResult = { ok: true; name: string } | { ok: false; message: string };

/** The longest name a custom set can have: what the switcher's trigger can show before it truncates. */
export const MAX_SET_NAME_LENGTH = 40;

/** A custom set's new name: trimmed, not empty, at most 40 characters, and not another set's name (case aside). */
export function validateSetName(sets: readonly SampleSet[], id: string, input: string): NameResult {
  const name = input.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, message: "Enter a name" };
  if (name.length > MAX_SET_NAME_LENGTH) return { ok: false, message: `Use ${MAX_SET_NAME_LENGTH} characters or fewer` };
  const lower = name.toLowerCase();
  if (sets.some((set) => set.id !== id && set.name.trim().toLowerCase() === lower)) {
    return { ok: false, message: "Another set has this name" };
  }
  return { ok: true, name };
}

/** The list with a custom set renamed. Default sets keep their names; so does a name that doesn't validate. */
export function renameSet(sets: readonly SampleSet[], id: string, input: string): SampleSet[] {
  if (isDefaultSet(id)) return [...sets];
  const result = validateSetName(sets, id, input);
  if (!result.ok) return [...sets];
  return sets.map((set) => (set.id === id ? { ...set, name: result.name } : set));
}

/** The list without a custom set. Default sets can't be removed. */
export function removeSet(sets: readonly SampleSet[], id: string): SampleSet[] {
  if (isDefaultSet(id)) return [...sets];
  return sets.filter((set) => set.id !== id);
}

/** An empty string, as the fields store it. (null and undefined are gaps, which the defaults fill.) */
function isEmptied(value: VariableValue | null | undefined): boolean {
  return typeof value === "string" && value.trim() === "";
}
