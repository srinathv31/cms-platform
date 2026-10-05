// Default sample sets: the values the preview and the review screen render with. Pure TypeScript,
// deterministic for a given `today` (the host passes its clock's date; nothing here reads the time).
//
//   typical   "Typical customer"              each variable's sample when it's valid, else a
//                                             realistic default for its type
//   long      "Long name and maximum values"  stresses layout: long names and phrases, seven-digit
//                                             amounts, a high percent, the widest month (September
//                                             30), the longest state name
//   minimum   "Minimum values"                short names and words, zero amounts, a short date
//                                             (May 1), the shortest state name
//
// Text defaults follow what the variable is, judged from its key (then its label): a first name, a
// last name, a full name, a company, an email, a city, a street address, or anything else.

import type { SampleSet, Variable, VariableType, VariableValue, VariableValues } from "./types";
import { TYPE_META, US_STATES, toKey, validateValue } from "./variables";

export type DefaultSampleSetId = "typical" | "long" | "minimum";

/** The three sets every version starts with, in switcher order. */
export const DEFAULT_SAMPLE_SETS: readonly { id: DefaultSampleSetId; name: string }[] = [
  { id: "typical", name: "Typical customer" },
  { id: "long", name: "Long name and maximum values" },
  { id: "minimum", name: "Minimum values" },
];

/** The three default sets, with a value for every variable in the list. `today` is YYYY-MM-DD. */
export function defaultSampleSets(variables: readonly Variable[], today: string): SampleSet[] {
  const day = parseDay(today);
  return DEFAULT_SAMPLE_SETS.map(({ id, name }) => ({
    id,
    name,
    values: Object.fromEntries(variables.map((v) => [v.key, defaultValue(id, v, day)])),
  }));
}

/**
 * The values to render a set with: the set's own value for each variable when it has one, else the
 * default for the set's kind (custom sets fall back to typical). Keys not in the list are dropped.
 * Values are passed through as given; the render route validates them.
 */
export function sampleSetValues(set: SampleSet, variables: readonly Variable[], today: string): VariableValues {
  const kind: DefaultSampleSetId = isDefaultId(set.id) ? set.id : "typical";
  let day: Day | null = null;
  const out: VariableValues = {};
  for (const v of variables) {
    const given = Object.prototype.hasOwnProperty.call(set.values, v.key) ? set.values[v.key] : undefined;
    out[v.key] = isPresent(given) ? given : defaultValue(kind, v, (day ??= parseDay(today)));
  }
  return out;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

function isDefaultId(id: string): id is DefaultSampleSetId {
  return DEFAULT_SAMPLE_SETS.some((s) => s.id === id);
}

function isPresent(value: VariableValue | null | undefined): value is VariableValue {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function defaultValue(kind: DefaultSampleSetId, v: Variable, day: Day): string {
  if (kind === "typical") {
    const sample = v.sample ? validateValue(v.type, v.sample) : null;
    if (sample?.ok) return sample.value;
  }
  if (v.type === "text") {
    const text = TEXT[textKind(v)][kind];
    return text || v.label || TYPE_META.text.example;
  }
  return OTHER[kind](v.type, day);
}

const LONGEST_STATE = stateBy((a, b) => b.length > a.length);
const SHORTEST_STATE = stateBy((a, b) => b.length < a.length);

/** Non-text defaults, canonical. */
const OTHER: Record<DefaultSampleSetId, (type: Exclude<VariableType, "text">, day: Day) => string> = {
  typical: (type, day) => (type === "date" ? addDays(day, 30) : TYPE_META[type].example),
  long: (type, day) => {
    switch (type) {
      case "currency":
      case "number":
        return "1000000";
      case "percent":
        return "99.99";
      case "date":
        return nextOnOrAfter(day, 9, 30); // September: the widest month name
      case "us_state":
        return LONGEST_STATE;
    }
  },
  minimum: (type, day) => {
    switch (type) {
      case "currency":
      case "number":
      case "percent":
        return "0";
      case "date":
        return nextOnOrAfter(day, 5, 1); // May 1: the shortest month name, one-digit day
      case "us_state":
        return SHORTEST_STATE;
    }
  },
};

function stateBy(better: (current: string, candidate: string) => boolean): string {
  let best: [string, string] | null = null;
  for (const entry of Object.entries(US_STATES)) {
    if (!best || better(best[1], entry[1])) best = entry;
  }
  return best![0];
}

// ── Text ─────────────────────────────────────────────────────────────────────

type TextKind = "first" | "last" | "full" | "company" | "email" | "city" | "address" | "other";

/** In the order they're tried: specific names before the generic `…_name`. */
const TEXT_KINDS: readonly [TextKind, RegExp][] = [
  ["first", /(^|_)(first|given|preferred|middle|f)_?name(_|$)/],
  ["last", /(^|_)(last|family|sur|l)_?name(_|$)/],
  ["company", /(^|_)(company|business|employer|merchant|organization|organisation|firm)(_|$)/],
  ["email", /(^|_)e_?mail(_|$)/],
  ["city", /(^|_)(city|town)(_|$)/],
  ["address", /(^|_)(address|street)(_|$)/],
  // A person's whole name ("name", "full_name", "customer_name", "cardholder"); not "product_name".
  [
    "full",
    /^(?:(?:full|customer|client|cardholder|cardmember|account_holder|holder|member|recipient|borrower|applicant|owner|legal|display|primary|joint)_)?name$|^(?:cardholder|cardmember|customer)$/,
  ],
];

function textKind(v: Variable): TextKind {
  for (const source of [v.key, toKey(v.label)]) {
    const found = TEXT_KINDS.find(([, pattern]) => pattern.test(source));
    if (found) return found[0];
  }
  return "other";
}

/** "" means: use the variable's label. */
const TEXT: Record<TextKind, Record<DefaultSampleSetId, string>> = {
  first: { typical: "Maya", long: "Alexandria-Marguerite", minimum: "Al" },
  last: { typical: "Chen", long: "Featherstonehaugh-Villiers", minimum: "Li" },
  full: {
    typical: "Maya Chen",
    long: "Alexandria-Marguerite Featherstonehaugh-Villiers",
    minimum: "Al Li",
  },
  company: {
    typical: "Harbor Supply Co.",
    long: "Featherstonehaugh-Villiers Agricultural Holdings Incorporated",
    minimum: "Ace",
  },
  email: {
    typical: "maya.chen@example.com",
    long: "alexandria-marguerite.featherstonehaugh-villiers@example.com",
    minimum: "al@li.co",
  },
  city: { typical: "Newark", long: "Rancho Santa Margarita", minimum: "Ada" },
  address: {
    typical: "120 Harbor Street",
    long: "12500 Northwest Old Settlers Boulevard, Apartment 1204",
    minimum: "1 A St",
  },
  other: {
    typical: "",
    long: "Preferred Platinum Rewards account with purchase protection",
    minimum: "Basic",
  },
};

// ── Dates (UTC calendar days, no clock) ──────────────────────────────────────

interface Day {
  y: number;
  m: number; // 1–12
  d: number;
}

function parseDay(today: string): Day {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!match) throw new Error(`today must be a date like 2026-10-04, got "${today}"`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(day: Day, days: number): string {
  return iso(Date.UTC(day.y, day.m - 1, day.d + days));
}

/** The next `month`/`date` on or after `day`. */
function nextOnOrAfter(day: Day, month: number, date: number): string {
  const thisYear = Date.UTC(day.y, month - 1, date);
  return iso(thisYear >= Date.UTC(day.y, day.m - 1, day.d) ? thisYear : Date.UTC(day.y + 1, month - 1, date));
}
