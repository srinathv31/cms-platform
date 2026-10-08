// Pure TypeScript helpers for typed variables. No React, no TipTap runtime.
// Canonical sample/value strings (see `Variable` in ./types; decimals keep the digits as sent):
//   text "Maya" · currency "1000" · percent "21.99" · date "2027-03-04" · number "20000" · us_state "NJ"

import type { VariableType, VariableValue } from "./types";

/** Icon keys map to lucide icons in the React layer (components/type-icon.tsx). */
export type VariableIconKey = "type" | "dollar-sign" | "percent" | "calendar" | "hash" | "map-pin";

export interface VariableTypeMeta {
  label: string;
  icon: VariableIconKey;
  /** A typical key for this type (from the build plan). */
  exampleKey: string;
  /** Canonical example value. `formatValue(type, example)` gives the display form. */
  example: string;
}

export const TYPE_META: Record<VariableType, VariableTypeMeta> = {
  text: { label: "Text", icon: "type", exampleKey: "first_name", example: "Maya" },
  currency: { label: "Currency", icon: "dollar-sign", exampleKey: "annual_fee", example: "1000" },
  percent: { label: "Percent", icon: "percent", exampleKey: "purchase_apr", example: "21.99" },
  date: { label: "Date", icon: "calendar", exampleKey: "offer_end_date", example: "2027-03-04" },
  number: { label: "Number", icon: "hash", exampleKey: "bonus_points", example: "20000" },
  us_state: { label: "US state", icon: "map-pin", exampleKey: "home_state", example: "NJ" },
};

/** The 50 states plus DC, keyed by USPS code. */
export const US_STATES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida",
  GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
};

const MAX_KEY_LENGTH = 64;

/**
 * Generates a snake_case key from a label: "Offer end date" → "offer_end_date",
 * "Purchase APR (%)" → "purchase_apr". Keys never start with a digit.
 */
export function toKey(label: string): string {
  const key = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2") // camelCase → camel_Case
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/g, "");
  if (!key) return "";
  return /^[0-9]/.test(key) ? `v_${key}` : key;
}

/** Words a label keeps in capitals (keys are lowercase, so "purchase_apr" would otherwise read "Purchase apr"). */
const ACRONYMS = new Set(["apr", "apy", "fdic", "id", "url", "atm", "ach", "ssn"]);

/** A readable label for a key: "first_name" → "First name", "purchase_apr" → "Purchase APR". */
export function labelFromKey(key: string): string {
  const words = key
    .split(/_+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word));
  if (words.length === 0) return key;
  const label = words.join(" ");
  return label[0].toUpperCase() + label.slice(1);
}

/** A valid key: lowercase snake_case, starts with a letter. */
export function isValidKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LENGTH && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key);
}

// ── Values: the one formatting module ───────────────────────────
//
// The editor's fields and chips, the preview, the API's validation and every channel read values
// through `validateValue` and `formatValue` (docs/render-spec.md, "Values"). variables.test.ts pins
// the behaviour in the table a Java port copies.
//
// Decimal values (currency, percent, number) are exact strings, never JS numbers: no Number,
// parseFloat or Intl touches them. Canonical = the digits as sent, with the allowed decoration
// removed. Display = canonical plus the type's symbol and thousands commas. Nothing is rounded, cut,
// padded or rewritten: "21.90" stays 21.90, "1.999999" stays 1.999999, "95" is $95.
//
// A JS number given here (an internal caller; the render route reads JSON numbers as their source
// text) is read as its JSON text, `String(n)`: 95 is "95", and 1e21 is "1e+21", which is refused.

export type ValidationResult = { ok: true; value: string } | { ok: false; message: string };

/**
 * Checks a value for a type and returns its canonical string form:
 *   currency  "1000", "$1,000.50", "-$5"      → "1000", "1000.50", "-5"   (a leading -, then an optional $)
 *   percent   "21.90", "21.90%", "21.90 %"    → "21.90"                   (a trailing %, one space allowed before it)
 *   number    "1,234.567"                     → "1234.567"
 *   date      "2027-3-4", "3/4/2027" (M/D/YYYY), "March 4, 2027", "Mar 4 2027" → "2027-03-04"
 *   us_state  "nj", "New Jersey"              → "NJ"
 *   text      as given
 * The decimal digits are ASCII: no leading zeros ("0.5" and "0" are fine), commas only between groups
 * of three in the whole part, a point only between digits, no + sign, no exponent, no negative zero.
 * Surrounding whitespace is ignored; blank is no value. A refusal carries a short message for the field.
 */
export function validateValue(type: VariableType, value: VariableValue): ValidationResult {
  const given = String(value);
  const raw = given.trim();
  if (raw === "") return { ok: false, message: "Enter a value" };

  switch (type) {
    case "text":
      return { ok: true, value: given };
    case "currency":
    case "percent":
    case "number":
      return readDecimal(type, raw);
    case "date": {
      const iso = parseDate(raw);
      return iso === null ? { ok: false, message: "Enter a date, like 2027-03-04" } : { ok: true, value: iso };
    }
    case "us_state": {
      const code = parseState(raw);
      return code === null ? { ok: false, message: "Enter a US state, like NJ" } : { ok: true, value: code };
    }
  }
}

/**
 * Formats a value for display, the same everywhere. Invalid input is returned as given, so a
 * renderer never throws on bad sample data.
 *   currency $95 · $1,000.5 · -$1,234.50   percent 21.90% · -5%   number 1,234.567
 *   date March 4, 2027   us_state New Jersey
 *   text: ends trimmed, and each line break (with the whitespace around it) becomes one space
 */
export function formatValue(type: VariableType, value: VariableValue): string {
  if (type === "text") return displayText(String(value));
  const checked = validateValue(type, value);
  if (!checked.ok) return String(value);
  const v = checked.value;

  switch (type) {
    case "currency":
      // The sign goes before the symbol: -$5.
      return v.startsWith("-") ? `-$${groupThousands(v.slice(1))}` : `$${groupThousands(v)}`;
    case "percent":
      return `${groupThousands(v)}%`;
    case "number":
      return groupThousands(v);
    case "date":
      return displayDate(v);
    case "us_state":
      return US_STATES[v] ?? v;
  }
}

// ── Decimals (currency, percent, number) ────────────────────────

type DecimalType = "currency" | "percent" | "number";

const DECIMAL_MESSAGES: Readonly<Record<DecimalType, string>> = {
  currency: "Enter an amount, like 1000 or 1000.50",
  percent: "Enter a percentage, like 21.99",
  number: "Enter a number, like 20000",
};

/**
 * A decimal's digits once the sign and symbol are off: a whole part without leading zeros (commas
 * allowed only between groups of three) and an optional point followed by digits.
 */
const DECIMAL_DIGITS = /^(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+)(?:\.[0-9]+)?$/;

function readDecimal(type: DecimalType, raw: string): ValidationResult {
  let rest = raw;
  if (type === "percent") rest = rest.replace(/ ?%$/, "");
  const negative = rest.startsWith("-");
  if (negative) rest = rest.slice(1);
  const dollar = type === "currency" && rest.startsWith("$");
  if (dollar) rest = rest.slice(1);

  if (!DECIMAL_DIGITS.test(rest)) return { ok: false, message: decimalProblem(type, rest, dollar) };
  const digits = rest.replace(/,/g, "");
  if (negative && /^[0.]+$/.test(digits)) return { ok: false, message: "Zero can't be negative" };
  return { ok: true, value: negative ? `-${digits}` : digits };
}

/** What to say about digits DECIMAL_DIGITS refused: the common slip when it's one, else the type's example. */
function decimalProblem(type: DecimalType, rest: string, dollar: boolean): string {
  if (dollar && rest.startsWith("-")) return "Put the minus sign before the $, like -$5";
  if (rest.startsWith("+")) return "Leave out the + sign";
  if (/^[0-9.,]*[0-9][eE][+-]?[0-9]+$/.test(rest)) return "Write the number out in full, like 1000";
  if (/^\.[0-9]+$/.test(rest)) return "Add a 0 before the decimal point, like 0.5";
  if (/^[0-9,]+\.$/.test(rest)) return "Add digits after the decimal point, or leave it out";
  if (/^[0-9,]+(?:\.[0-9]+)?$/.test(rest)) {
    if (/^0[0-9,]/.test(rest)) return "Leave out the leading zeros";
    if (rest.includes(",")) return "Put commas only between groups of three digits, like 1,000,000";
  }
  return DECIMAL_MESSAGES[type];
}

/** "-1234567.891" → "-1,234,567.891": commas into the whole part, by position. The digits are untouched. */
function groupThousands(decimal: string): string {
  const sign = decimal.startsWith("-") ? "-" : "";
  const unsigned = sign ? decimal.slice(1) : decimal;
  const point = unsigned.indexOf(".");
  const whole = point < 0 ? unsigned : unsigned.slice(0, point);
  const fraction = point < 0 ? "" : unsigned.slice(point);
  let grouped = "";
  for (let end = whole.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3);
    grouped = `${start > 0 ? "," : ""}${whole.slice(start, end)}${grouped}`;
  }
  return `${sign}${grouped}${fraction}`;
}

// ── Dates (a fixed English table: no Intl, no time zone) ────────

/** The display names, January first. */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** A string of 1–4 ASCII digits as an integer (exact; the date parts only). */
function digitsValue(digits: string): number {
  let n = 0;
  for (let i = 0; i < digits.length; i++) n = n * 10 + (digits.charCodeAt(i) - 48);
  return n;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * "YYYY-M-D", "M/D/YYYY" (US order), or a month name (3+ letters, an optional point) with the day
 * and year ("March 4, 2027", "Sept 30 2027") → "YYYY-MM-DD". A real Gregorian day, years 0001–9999.
 */
function parseDate(input: string): string | null {
  let y: string, m: string, d: string;
  let match: RegExpMatchArray | null;

  if ((match = input.match(/^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/))) {
    [, y, m, d] = match;
  } else if ((match = input.match(/^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})$/))) {
    [, m, d, y] = match;
  } else if ((match = input.match(/^([a-z]+)\.?\s+([0-9]{1,2}),?\s+([0-9]{4})$/i))) {
    const word = match[1].toLowerCase();
    const month = word.length >= 3 ? MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(word)) : -1;
    if (month < 0) return null;
    [m, d, y] = [String(month + 1), match[2], match[3]];
  } else {
    return null;
  }

  const [year, month, day] = [digitsValue(y), digitsValue(m), digitsValue(d)];
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  if (day > (month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1])) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** "2027-03-04" → "March 4, 2027": the English month, the day without a leading zero, the 4-digit year. */
function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${MONTH_NAMES[digitsValue(m) - 1]} ${d.replace(/^0/, "")}, ${y}`;
}

// ── States and text ─────────────────────────────────────────────

/** A USPS code or a full name, any case (runs of spaces in a name count as one) → the code. */
function parseState(input: string): string | null {
  const upper = input.toUpperCase();
  if (Object.hasOwn(US_STATES, upper)) return upper;
  const lower = input.toLowerCase().replace(/\s+/g, " ");
  const found = Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === lower);
  return found ? found[0] : null;
}

/** A text value as it reads inline: each line break (with the whitespace around it) one space, the ends trimmed. */
function displayText(text: string): string {
  return text.replace(/\s*(?:\r\n|\r|\n)\s*/g, " ").trim();
}

// ── Lists ───────────────────────────────────────────────────────

/**
 * `base`, or `base_2`, `base_3`… when it's taken. Stays within the key length limit.
 * An empty base stays empty (the caller asks for a label first).
 */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!base || !taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, MAX_KEY_LENGTH - suffix.length).replace(/_+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Filters a variable list by a free-text query (the `{{` picker), best matches first:
 * label starts with the query, then a label word does, then the key does, then either contains it.
 * Spaces are allowed ("end date"); they match underscores in keys. List order breaks ties.
 */
export function filterVariables<V extends { key: string; label: string }>(variables: readonly V[], query: string): V[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [...variables];
  const qKey = q.replace(/ /g, "_");

  const scored: { variable: V; score: number; index: number }[] = [];
  variables.forEach((variable, index) => {
    const label = variable.label.toLowerCase();
    const key = variable.key.toLowerCase();
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (label.includes(` ${q}`)) score = 1;
    else if (key.startsWith(qKey)) score = 2;
    else if (label.includes(q) || key.includes(qKey)) score = 3;
    if (score >= 0) scored.push({ variable, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.variable);
}
