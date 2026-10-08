// THE NORMATIVE EXAMPLE TABLE for variable values (docs/render-spec.md, "Values"). Every row is a
// spec example: input → canonical (what validation stores and the API passes on) → display (what the
// editor, the preview and every channel print). A Java port copies these rows as its own test; change
// a row only together with the spec.
//
// Rules the rows pin (render-parity brief, rules 14–19):
//   - Decimals (currency, percent, number) are exact strings: never rounded, cut, padded or rewritten.
//     Canonical = the digits as sent minus the allowed decoration; display adds only the type's symbol
//     and thousands commas (currency -$1,234.5, percent 21.90%, number 1,234.567). Trailing zeros stay.
//   - Decimal input: optional leading -, ASCII digits, optional . + digits. Allowed and stripped: a $
//     after the optional - (currency), a trailing % with at most one space before it (percent), commas
//     only between groups of three in the whole part. Refused: bad grouping, ".5", "5.", "+5", leading
//     zeros ("007"; "0" and "0.5" are fine), negative zero, exponents, anything else.
//   - Dates: canonical YYYY-MM-DD (a real Gregorian day, years 0001–9999); display "March 4, 2027"
//     (English month, day without a leading zero, 4-digit year), from a fixed table, no time zone.
//   - us_state: a USPS code or the full name, any case → the code; display the full name.
//   - text: canonical as given; display trims the ends, and each line break (CR LF, CR or LF, with the
//     whitespace around it) becomes one space. Runs of spaces stay.
//   - Surrounding whitespace is ignored for every type but text; a blank value is no value. Whitespace
//     here is JavaScript's (String.prototype.trim and \s): Unicode spaces including NBSP, tab, line
//     terminators and U+FEFF. A Java port must use the same set, not Character.isWhitespace.
//   - JSON numbers sent to the API are read from their source text and then follow these same rows.

import { describe, expect, it } from "vitest";
import { VARIABLE_TYPES, type VariableType } from "./types";
import { TYPE_META, US_STATES, formatValue, isValidKey, labelFromKey, toKey, validateValue } from "./variables";

describe("toKey", () => {
  it.each([
    ["Offer end date", "offer_end_date"],
    ["Purchase APR (%)", "purchase_apr"],
    ["  First   name ", "first_name"],
    ["Home-state", "home_state"],
    ["bonusPoints", "bonus_points"],
    ["Café owner", "cafe_owner"],
    ["Terms & conditions", "terms_and_conditions"],
    ["2nd payment", "v_2nd_payment"],
    ["!!!", ""],
  ])("%s → %s", (label, key) => {
    expect(toKey(label)).toBe(key);
  });

  it("produces valid keys", () => {
    for (const label of ["Offer end date", "Purchase APR (%)", "2nd payment", "A".repeat(100)]) {
      expect(isValidKey(toKey(label))).toBe(true);
    }
  });
});

describe("labelFromKey", () => {
  it.each([
    ["first_name", "First name"],
    ["purchase_apr", "Purchase APR"],
    ["apy", "APY"],
    ["card_id", "Card ID"],
    ["fdic_notice_url", "FDIC notice URL"],
    ["identity", "Identity"], // only whole words are acronyms
    ["", ""],
  ])("%s → %s", (key, label) => {
    expect(labelFromKey(key)).toBe(label);
  });
});

describe("isValidKey", () => {
  it("accepts snake_case that starts with a letter", () => {
    expect(isValidKey("first_name")).toBe(true);
    expect(isValidKey("apr2")).toBe(true);
  });
  it("rejects everything else", () => {
    for (const key of ["", "First_name", "first name", "_first", "first__name", "1st", "first-name", "first_"]) {
      expect(isValidKey(key)).toBe(false);
    }
  });
});

// ── Values: the example table ───────────────────────────────────────────────

/** [type, input, canonical, display] */
const ACCEPTED: readonly (readonly [VariableType, string, string, string])[] = [
  // currency
  ["currency", "6.875", "6.875", "$6.875"],
  ["currency", "1.999999", "1.999999", "$1.999999"],
  ["currency", "21.90", "21.90", "$21.90"],
  ["currency", "0.1", "0.1", "$0.1"],
  ["currency", "0.10", "0.10", "$0.10"],
  ["currency", "95", "95", "$95"],
  ["currency", "95.5", "95.5", "$95.5"],
  ["currency", "95.555", "95.555", "$95.555"],
  ["currency", "-5", "-5", "-$5"],
  ["currency", "-0.005", "-0.005", "-$0.005"],
  ["currency", "-0.001", "-0.001", "-$0.001"],
  ["currency", "1000000", "1000000", "$1,000,000"],
  ["currency", "1,000", "1000", "$1,000"],
  ["currency", "$1,000.50", "1000.50", "$1,000.50"],
  ["currency", "-$5", "-5", "-$5"],
  ["currency", "12345678901234567.89", "12345678901234567.89", "$12,345,678,901,234,567.89"],
  ["currency", "1000000000000000000000", "1000000000000000000000", "$1,000,000,000,000,000,000,000"],
  ["currency", "0.0000001", "0.0000001", "$0.0000001"],
  ["currency", " 42 ", "42", "$42"],
  ["currency", "\u00a042\t", "42", "$42"],
  ["currency", "39.995", "39.995", "$39.995"],
  ["currency", "0.125", "0.125", "$0.125"],
  ["currency", "1.005", "1.005", "$1.005"],
  ["currency", "2.675", "2.675", "$2.675"],
  ["currency", "6.865", "6.865", "$6.865"],
  ["currency", "1000", "1000", "$1,000"],
  ["currency", "99999999.995", "99999999.995", "$99,999,999.995"],
  ["currency", "1000.5", "1000.5", "$1,000.5"],
  ["currency", "-$1,234.5", "-1234.5", "-$1,234.5"],
  ["currency", "-1234.50", "-1234.50", "-$1,234.50"],
  ["currency", "0", "0", "$0"],
  ["currency", "0.00", "0.00", "$0.00"],
  ["currency", "$0", "0", "$0"],
  ["currency", "$1,000,000.00", "1000000.00", "$1,000,000.00"],
  ["currency", "1,234,567.891", "1234567.891", "$1,234,567.891"],
  // percent
  ["percent", "6.875", "6.875", "6.875%"],
  ["percent", "1.999999", "1.999999", "1.999999%"],
  ["percent", "21.90", "21.90", "21.90%"],
  ["percent", "0.1", "0.1", "0.1%"],
  ["percent", "0.10", "0.10", "0.10%"],
  ["percent", "95", "95", "95%"],
  ["percent", "95.5", "95.5", "95.5%"],
  ["percent", "95.555", "95.555", "95.555%"],
  ["percent", "-5", "-5", "-5%"],
  ["percent", "-0.005", "-0.005", "-0.005%"],
  ["percent", "-0.001", "-0.001", "-0.001%"],
  ["percent", "1000000", "1000000", "1,000,000%"],
  ["percent", "1,000", "1000", "1,000%"],
  ["percent", "12345678901234567.89", "12345678901234567.89", "12,345,678,901,234,567.89%"],
  ["percent", "1000000000000000000000", "1000000000000000000000", "1,000,000,000,000,000,000,000%"],
  ["percent", "0.0000001", "0.0000001", "0.0000001%"],
  ["percent", "21.99%", "21.99", "21.99%"],
  ["percent", "21.99 %", "21.99", "21.99%"],
  ["percent", " 42 ", "42", "42%"],
  ["percent", "39.995", "39.995", "39.995%"],
  ["percent", "0.125", "0.125", "0.125%"],
  ["percent", "1.005", "1.005", "1.005%"],
  ["percent", "2.675", "2.675", "2.675%"],
  ["percent", "6.865", "6.865", "6.865%"],
  ["percent", "1000", "1000", "1,000%"],
  ["percent", "99999999.995", "99999999.995", "99,999,999.995%"],
  ["percent", "21.99", "21.99", "21.99%"],
  ["percent", "-5%", "-5", "-5%"],
  ["percent", "100%", "100", "100%"],
  ["percent", "0%", "0", "0%"],
  ["percent", "1,000.5%", "1000.5", "1,000.5%"],
  // number
  ["number", "6.875", "6.875", "6.875"],
  ["number", "1.999999", "1.999999", "1.999999"],
  ["number", "21.90", "21.90", "21.90"],
  ["number", "0.1", "0.1", "0.1"],
  ["number", "0.10", "0.10", "0.10"],
  ["number", "95", "95", "95"],
  ["number", "95.5", "95.5", "95.5"],
  ["number", "95.555", "95.555", "95.555"],
  ["number", "-5", "-5", "-5"],
  ["number", "-0.005", "-0.005", "-0.005"],
  ["number", "-0.001", "-0.001", "-0.001"],
  ["number", "1000000", "1000000", "1,000,000"],
  ["number", "1,000", "1000", "1,000"],
  ["number", "12345678901234567.89", "12345678901234567.89", "12,345,678,901,234,567.89"],
  ["number", "1000000000000000000000", "1000000000000000000000", "1,000,000,000,000,000,000,000"],
  ["number", "0.0000001", "0.0000001", "0.0000001"],
  ["number", " 42 ", "42", "42"],
  ["number", "39.995", "39.995", "39.995"],
  ["number", "0.125", "0.125", "0.125"],
  ["number", "1.005", "1.005", "1.005"],
  ["number", "2.675", "2.675", "2.675"],
  ["number", "6.865", "6.865", "6.865"],
  ["number", "1000", "1000", "1,000"],
  ["number", "99999999.995", "99999999.995", "99,999,999.995"],
  ["number", "20000", "20000", "20,000"],
  ["number", "1,234,567.891", "1234567.891", "1,234,567.891"],
  ["number", "-1,234.5", "-1234.5", "-1,234.5"],
  ["number", "1234567890123456789012345678901234567890", "1234567890123456789012345678901234567890", "1,234,567,890,123,456,789,012,345,678,901,234,567,890"],
  ["number", "0.000000000000000000001", "0.000000000000000000001", "0.000000000000000000001"],
  // date
  ["date", "2027-03-04", "2027-03-04", "March 4, 2027"],
  ["date", "2027-3-4", "2027-03-04", "March 4, 2027"],
  ["date", "3/4/2027", "2027-03-04", "March 4, 2027"],
  ["date", "03/04/2027", "2027-03-04", "March 4, 2027"],
  ["date", "March 4, 2027", "2027-03-04", "March 4, 2027"],
  ["date", "mar 4 2027", "2027-03-04", "March 4, 2027"],
  ["date", "Sept 30, 2027", "2027-09-30", "September 30, 2027"],
  ["date", "2028-02-29", "2028-02-29", "February 29, 2028"],
  ["date", "0050-01-01", "0050-01-01", "January 1, 0050"],
  ["date", "0100-01-01", "0100-01-01", "January 1, 0100"],
  ["date", "4/3/2027", "2027-04-03", "April 3, 2027"],
  ["date", "2000-02-29", "2000-02-29", "February 29, 2000"],
  ["date", "0001-01-01", "0001-01-01", "January 1, 0001"],
  ["date", "9999-12-31", "9999-12-31", "December 31, 9999"],
  ["date", "12/31/9999", "9999-12-31", "December 31, 9999"],
  ["date", "Mar. 4, 2027", "2027-03-04", "March 4, 2027"],
  ["date", "Sep 30 2027", "2027-09-30", "September 30, 2027"],
  ["date", " 2027-03-04 ", "2027-03-04", "March 4, 2027"],
  ["date", "December 31, 2026", "2026-12-31", "December 31, 2026"],
  ["date", "2027-01-01", "2027-01-01", "January 1, 2027"],
  // us_state
  ["us_state", "nj", "NJ", "New Jersey"],
  ["us_state", "NJ", "NJ", "New Jersey"],
  ["us_state", "New Jersey", "NJ", "New Jersey"],
  ["us_state", "new  jersey", "NJ", "New Jersey"],
  ["us_state", " NJ ", "NJ", "New Jersey"],
  ["us_state", "dc", "DC", "District of Columbia"],
  ["us_state", "District of Columbia", "DC", "District of Columbia"],
  ["us_state", "WY", "WY", "Wyoming"],
  ["us_state", "north carolina", "NC", "North Carolina"],
  // text
  ["text", "Maya", "Maya", "Maya"],
  ["text", "  Maya  ", "  Maya  ", "Maya"],
  ["text", "Maya\nChen", "Maya\nChen", "Maya Chen"],
  ["text", "a   b", "a   b", "a   b"],
  ["text", "21.90", "21.90", "21.90"],
  ["text", "<b>&", "<b>&", "<b>&"],
  ["text", "1e21", "1e21", "1e21"],
  ["text", "Maya\r\nChen", "Maya\r\nChen", "Maya Chen"],
  ["text", "a \n\n b", "a \n\n b", "a b"],
  ["text", "Line\rbreak", "Line\rbreak", "Line break"],
  ["text", "\u00a0Maya\u00a0\n\u00a0Chen", "\u00a0Maya\u00a0\n\u00a0Chen", "Maya Chen"],
];

/** [type, input, the editor's message]. A refused value is displayed exactly as given. */
const REFUSED: readonly (readonly [VariableType, string, string])[] = [
  // currency
  ["currency", "-0", "Zero can't be negative"],
  ["currency", "1e3", "Write the number out in full, like 1000"],
  ["currency", "1,00", "Put commas only between groups of three digits, like 1,000,000"],
  ["currency", "1,0,0", "Put commas only between groups of three digits, like 1,000,000"],
  ["currency", "$-5", "Put the minus sign before the $, like -$5"],
  ["currency", "+5", "Leave out the + sign"],
  ["currency", "007", "Leave out the leading zeros"],
  ["currency", "5.", "Add digits after the decimal point, or leave it out"],
  ["currency", ".5", "Add a 0 before the decimal point, like 0.5"],
  ["currency", "21.99%", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "21.99 %", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "abc", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "1.2.3", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "１２", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "-$0", "Zero can't be negative"],
  ["currency", "-0.00", "Zero can't be negative"],
  ["currency", "1000,000", "Put commas only between groups of three digits, like 1,000,000"],
  ["currency", "1,000,00", "Put commas only between groups of three digits, like 1,000,000"],
  ["currency", "00", "Leave out the leading zeros"],
  ["currency", "0,100", "Leave out the leading zeros"],
  ["currency", "-.5", "Add a 0 before the decimal point, like 0.5"],
  ["currency", "$", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "-", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "- $5", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "--5", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "1 000", "Enter an amount, like 1000 or 1000.50"],
  ["currency", "1E3", "Write the number out in full, like 1000"],
  ["currency", "1.5e-7", "Write the number out in full, like 1000"],
  // percent
  ["percent", "-0", "Zero can't be negative"],
  ["percent", "1e3", "Write the number out in full, like 1000"],
  ["percent", "1,00", "Put commas only between groups of three digits, like 1,000,000"],
  ["percent", "1,0,0", "Put commas only between groups of three digits, like 1,000,000"],
  ["percent", "$1,000.50", "Enter a percentage, like 21.99"],
  ["percent", "-$5", "Enter a percentage, like 21.99"],
  ["percent", "$-5", "Enter a percentage, like 21.99"],
  ["percent", "+5", "Leave out the + sign"],
  ["percent", "007", "Leave out the leading zeros"],
  ["percent", "5.", "Add digits after the decimal point, or leave it out"],
  ["percent", ".5", "Add a 0 before the decimal point, like 0.5"],
  ["percent", "abc", "Enter a percentage, like 21.99"],
  ["percent", "1.2.3", "Enter a percentage, like 21.99"],
  ["percent", "１２", "Enter a percentage, like 21.99"],
  ["percent", "21.99%%", "Enter a percentage, like 21.99"],
  ["percent", "21.99  %", "Enter a percentage, like 21.99"],
  ["percent", "% 21.99", "Enter a percentage, like 21.99"],
  // number
  ["number", "-0", "Zero can't be negative"],
  ["number", "1e3", "Write the number out in full, like 1000"],
  ["number", "1,00", "Put commas only between groups of three digits, like 1,000,000"],
  ["number", "1,0,0", "Put commas only between groups of three digits, like 1,000,000"],
  ["number", "$1,000.50", "Enter a number, like 20000"],
  ["number", "-$5", "Enter a number, like 20000"],
  ["number", "$-5", "Enter a number, like 20000"],
  ["number", "+5", "Leave out the + sign"],
  ["number", "007", "Leave out the leading zeros"],
  ["number", "5.", "Add digits after the decimal point, or leave it out"],
  ["number", ".5", "Add a 0 before the decimal point, like 0.5"],
  ["number", "21.99%", "Enter a number, like 20000"],
  ["number", "21.99 %", "Enter a number, like 20000"],
  ["number", "abc", "Enter a number, like 20000"],
  ["number", "1.2.3", "Enter a number, like 20000"],
  ["number", "１２", "Enter a number, like 20000"],
  // date
  ["date", "2027-02-29", "Enter a date, like 2027-03-04"],
  ["date", "2027-03-04T00:00:00Z", "Enter a date, like 2027-03-04"],
  ["date", "20270304", "Enter a date, like 2027-03-04"],
  ["date", "2100-02-29", "Enter a date, like 2027-03-04"],
  ["date", "0000-01-01", "Enter a date, like 2027-03-04"],
  ["date", "Ju 1, 2027", "Enter a date, like 2027-03-04"],
  ["date", "June 1st, 2027", "Enter a date, like 2027-03-04"],
  ["date", "1/1/27", "Enter a date, like 2027-03-04"],
  ["date", "2027-13-01", "Enter a date, like 2027-03-04"],
  ["date", "2027-02-30", "Enter a date, like 2027-03-04"],
  ["date", "2027-00-10", "Enter a date, like 2027-03-04"],
  ["date", "4 March 2027", "Enter a date, like 2027-03-04"],
  // us_state
  ["us_state", "N.J.", "Enter a US state, like NJ"],
  ["us_state", "PR", "Enter a US state, like NJ"],
  ["us_state", "Jersey", "Enter a US state, like NJ"],
  ["us_state", "ZZ", "Enter a US state, like NJ"],
];

describe("values: accepted (input → canonical → display)", () => {
  it.each(ACCEPTED)("%s %j → %j → %j", (type, input, canonical, display) => {
    expect(validateValue(type, input)).toEqual({ ok: true, value: canonical });
    expect(formatValue(type, input)).toBe(display);
    // The canonical form is a fixed point and displays the same.
    expect(validateValue(type, canonical)).toEqual({ ok: true, value: canonical });
    expect(formatValue(type, canonical)).toBe(display);
  });
});

describe("values: refused", () => {
  it.each(REFUSED)("%s %j: %s", (type, input, message) => {
    expect(validateValue(type, input)).toEqual({ ok: false, message });
    expect(formatValue(type, input)).toBe(input);
  });

  it("blank is no value, for every type", () => {
    for (const type of VARIABLE_TYPES) {
      for (const blank of ["", "  ", "\n"]) expect(validateValue(type, blank)).toEqual({ ok: false, message: "Enter a value" });
    }
  });
});

describe("values: a JS number from an internal caller is read as its JSON text", () => {
  it("95 is \"95\"; an exponent form is refused, never rewritten", () => {
    expect(validateValue("currency", 95)).toEqual({ ok: true, value: "95" });
    expect(formatValue("currency", 95)).toBe("$95");
    expect(formatValue("percent", 21.9)).toBe("21.9%");
    expect(validateValue("text", 7)).toEqual({ ok: true, value: "7" });
    expect(validateValue("number", 1e21).ok).toBe(false);
    expect(validateValue("number", 1e-7).ok).toBe(false);
    expect(validateValue("number", -0)).toEqual({ ok: true, value: "0" });
    expect(validateValue("number", Number.NaN).ok).toBe(false);
    expect(validateValue("number", Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});

describe("TYPE_META and US_STATES", () => {
  it("covers every type, and every example is valid and formats", () => {
    for (const type of VARIABLE_TYPES) {
      const meta = TYPE_META[type];
      expect(meta.label).toBeTruthy();
      expect(isValidKey(meta.exampleKey)).toBe(true);
      expect(validateValue(type, meta.example).ok).toBe(true);
    }
  });

  it("lists the 50 states and DC; each code and name reads as the code and displays as the name", () => {
    expect(Object.keys(US_STATES)).toHaveLength(51);
    expect(US_STATES.NJ).toBe("New Jersey");
    for (const [code, name] of Object.entries(US_STATES)) {
      for (const input of [code, code.toLowerCase(), name, name.toUpperCase()]) {
        expect(validateValue("us_state", input)).toEqual({ ok: true, value: code });
      }
      expect(formatValue("us_state", code)).toBe(name);
    }
  });
});
