import { describe, expect, it } from "vitest";
import { VARIABLE_TYPES } from "./types";
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

describe("formatValue", () => {
  it("formats every type like the build plan", () => {
    expect(formatValue("text", "Maya")).toBe("Maya");
    expect(formatValue("currency", "1000")).toBe("$1,000.00");
    expect(formatValue("percent", "21.99")).toBe("21.99%");
    expect(formatValue("date", "2027-03-04")).toBe("March 4, 2027");
    expect(formatValue("number", "20000")).toBe("20,000");
    expect(formatValue("us_state", "NJ")).toBe("New Jersey");
  });

  it("accepts numbers and friendly input", () => {
    expect(formatValue("currency", 95)).toBe("$95.00");
    expect(formatValue("currency", "$1,234.5")).toBe("$1,234.50");
    expect(formatValue("currency", "-$20")).toBe("-$20.00");
    expect(formatValue("percent", "0")).toBe("0%");
    expect(formatValue("percent", "5.5%")).toBe("5.50%");
    expect(formatValue("number", "1234567.891")).toBe("1,234,567.89");
    expect(formatValue("date", "3/4/2027")).toBe("March 4, 2027");
    expect(formatValue("date", "Mar 4, 2027")).toBe("March 4, 2027");
    expect(formatValue("us_state", "new jersey")).toBe("New Jersey");
    expect(formatValue("us_state", "dc")).toBe("District of Columbia");
  });

  it("keeps text exactly as given", () => {
    expect(formatValue("text", "  spaced  ")).toBe("  spaced  ");
  });

  it("returns invalid input unchanged instead of throwing", () => {
    expect(formatValue("currency", "lots")).toBe("lots");
    expect(formatValue("date", "2027-02-30")).toBe("2027-02-30");
    expect(formatValue("us_state", "ZZ")).toBe("ZZ");
  });

  it("is timezone-proof for dates", () => {
    expect(formatValue("date", "2027-01-01")).toBe("January 1, 2027");
    expect(formatValue("date", "2026-12-31")).toBe("December 31, 2026");
  });
});

describe("validateValue", () => {
  it("returns the canonical form", () => {
    expect(validateValue("currency", "$1,000.00")).toEqual({ ok: true, value: "1000" });
    expect(validateValue("percent", "21.99%")).toEqual({ ok: true, value: "21.99" });
    expect(validateValue("number", "20,000")).toEqual({ ok: true, value: "20000" });
    expect(validateValue("date", "March 4, 2027")).toEqual({ ok: true, value: "2027-03-04" });
    expect(validateValue("us_state", "new jersey")).toEqual({ ok: true, value: "NJ" });
    expect(validateValue("text", "Maya")).toEqual({ ok: true, value: "Maya" });
  });

  it("rejects bad input with a short message", () => {
    for (const [type, value] of [
      ["currency", "1.2.3"],
      ["percent", "abc"],
      ["number", "12a"],
      ["date", "2027-13-01"],
      ["date", "2027-02-29"],
      ["us_state", "Atlantis"],
    ] as const) {
      const result = validateValue(type, value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("treats empty input as missing", () => {
    expect(validateValue("text", "  ").ok).toBe(false);
    expect(validateValue("currency", "").ok).toBe(false);
  });

  it("accepts leap days", () => {
    expect(validateValue("date", "2028-02-29")).toEqual({ ok: true, value: "2028-02-29" });
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

  it("lists the 50 states and DC", () => {
    expect(Object.keys(US_STATES)).toHaveLength(51);
    expect(US_STATES.NJ).toBe("New Jersey");
  });
});
