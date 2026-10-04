// Pure TypeScript helpers for typed variables. No React, no TipTap runtime.
// Canonical sample/value strings (see `Variable` in ./types):
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

/** A valid key: lowercase snake_case, starts with a letter. */
export function isValidKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LENGTH && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key);
}

export type ValidationResult = { ok: true; value: string } | { ok: false; message: string };

/**
 * Checks a value for a type and returns its canonical string form.
 * Accepts friendly input ("$1,000", "21.99%", "3/4/2027", "new jersey").
 */
export function validateValue(type: VariableType, value: VariableValue): ValidationResult {
  const raw = String(value).trim();
  if (raw === "") return { ok: false, message: "Enter a value" };

  switch (type) {
    case "text":
      return { ok: true, value: String(value) };
    case "currency": {
      const n = parseNumber(raw.replace(/^(-?)\$/, "$1"));
      return n === null ? { ok: false, message: "Enter an amount, like 1000.00" } : { ok: true, value: String(n) };
    }
    case "percent": {
      const n = parseNumber(raw.replace(/%$/, ""));
      return n === null ? { ok: false, message: "Enter a percentage, like 21.99" } : { ok: true, value: String(n) };
    }
    case "number": {
      const n = parseNumber(raw);
      return n === null ? { ok: false, message: "Enter a number, like 20000" } : { ok: true, value: String(n) };
    }
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

const currencyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percentWhole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percentFraction = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Formats a value for display. Invalid input is returned as given, so a
 * renderer never throws on bad sample data.
 *   currency $1,000.00 · percent 21.99% · date March 4, 2027 · number 20,000 · us_state New Jersey
 */
export function formatValue(type: VariableType, value: VariableValue): string {
  if (type === "text") return String(value);
  const checked = validateValue(type, value);
  if (!checked.ok) return String(value);
  const v = checked.value;

  switch (type) {
    case "currency":
      return currencyFormat.format(Number(v));
    case "percent": {
      const n = Number(v);
      return `${Number.isInteger(n) ? percentWhole.format(n) : percentFraction.format(n)}%`;
    }
    case "number":
      return numberFormat.format(Number(v));
    case "date": {
      const [y, m, d] = v.split("-").map(Number);
      return dateFormat.format(new Date(Date.UTC(y, m - 1, d)));
    }
    case "us_state":
      return US_STATES[v] ?? v;
  }
}

// ── parsing helpers ─────────────────────────────────────────────

function parseNumber(input: string): number | null {
  const cleaned = input.replace(/,/g, "").trim();
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function parseDate(input: string): string | null {
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;

  if ((match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = input.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i))) {
    const word = match[1].toLowerCase();
    const month = word.length >= 3 ? MONTHS.findIndex((name) => name.startsWith(word)) : -1;
    if (month < 0) return null;
    [m, d, y] = [month + 1, Number(match[2]), Number(match[3])];
  } else {
    return null;
  }

  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseState(input: string): string | null {
  const upper = input.toUpperCase();
  if (upper in US_STATES) return upper;
  const lower = input.toLowerCase().replace(/\s+/g, " ");
  const found = Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === lower);
  return found ? found[0] : null;
}
