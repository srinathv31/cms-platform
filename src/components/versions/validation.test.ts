import { describe, expect, it } from "vitest";
import { addDays, codeSegments, formatLong, formatSunset, fromYmd, renderCount, toYmd, ymdOfIso } from "./format";
import { REVOKE_REASON_MAX, defaultSunsetDate, validateRevokeReason, validateSunsetDate } from "./validation";

describe("validateSunsetDate", () => {
  const today = "2026-10-05";

  it("accepts a date after today", () => {
    expect(validateSunsetDate("2026-10-06", today)).toBeNull();
    expect(validateSunsetDate("2027-03-01", today)).toBeNull();
  });

  it("refuses today and the past, in words that name the date", () => {
    expect(validateSunsetDate("2026-10-05", today)).toBe("Pick a date after October 5, 2026.");
    expect(validateSunsetDate("2026-09-30", today)).toBe("Pick a date after October 5, 2026.");
  });

  it("refuses nothing-picked, malformed and impossible dates", () => {
    expect(validateSunsetDate(null, today)).toBe("Pick a date.");
    expect(validateSunsetDate("", today)).toBe("Pick a date.");
    expect(validateSunsetDate("03/01/2027", today)).toBe("Pick a date.");
    expect(validateSunsetDate("2027-02-30", today)).toBe("Pick a date.");
  });
});

describe("defaultSunsetDate", () => {
  it("starts on the sunset already set, while it is still ahead", () => {
    expect(defaultSunsetDate("2026-11-01", "2026-10-05")).toBe("2026-11-01");
  });

  it("otherwise starts 30 days out, and that is always a valid date", () => {
    const fresh = defaultSunsetDate(null, "2026-10-05");
    expect(fresh).toBe("2026-11-04");
    expect(validateSunsetDate(fresh, "2026-10-05")).toBeNull();
    expect(defaultSunsetDate("2026-09-01", "2026-10-05")).toBe("2026-11-04");
  });
});

describe("validateRevokeReason", () => {
  it("needs a reason: empty and blank are refused", () => {
    expect(validateRevokeReason("")).toBe("Say why this version is being revoked.");
    expect(validateRevokeReason("  \n ")).toBe("Say why this version is being revoked.");
  });

  it("accepts a reason, and refuses one the server would", () => {
    expect(validateRevokeReason("Wrong APR in the legal notices.")).toBeNull();
    expect(validateRevokeReason("x".repeat(REVOKE_REASON_MAX))).toBeNull();
    expect(validateRevokeReason("x".repeat(REVOKE_REASON_MAX + 1))).toBe("Keep the reason under 2,000 characters.");
  });
});

describe("calendar dates", () => {
  it("round-trips a YYYY-MM-DD through a Date", () => {
    expect(toYmd(fromYmd("2027-03-01")!)).toBe("2027-03-01");
    expect(fromYmd("2027-13-01")).toBeNull();
  });

  it("adds days across a month and a year", () => {
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(formatLong("2027-03-01")).toBe("March 1, 2027");
  });

  it("reads a stored sunset as its UTC day, whatever the time zone", () => {
    // Midnight UTC is the evening before in the Americas: the day is still the 17th.
    expect(ymdOfIso("2026-10-17T00:00:00.000Z")).toBe("2026-10-17");
    expect(formatSunset("2026-10-17T00:00:00.000Z", new Date("2026-10-04T12:00:00.000Z"))).toBe("Oct 17");
    expect(formatSunset("2027-03-01T00:00:00.000Z", new Date("2026-10-04T12:00:00.000Z"))).toBe("Mar 1, 2027");
    // The year check is on the UTC calendar too: the last evening of the year, in the Americas, is already next year.
    expect(formatSunset("2027-01-01T00:00:00.000Z", new Date("2026-12-31T23:30:00.000Z"))).toBe("Jan 1, 2027");
  });
});

describe("sentences", () => {
  it("splits a contract line on its code spans", () => {
    expect(codeSegments("v2 adds required `annual_fee` (Currency).")).toEqual([
      { text: "v2 adds required ", code: false },
      { text: "annual_fee", code: true },
      { text: " (Currency).", code: false },
    ]);
    expect(codeSegments("Nothing special.")).toEqual([{ text: "Nothing special.", code: false }]);
  });

  it("counts renders with the right number", () => {
    expect(renderCount(1)).toBe("1 render");
    expect(renderCount(1023)).toBe("1,023 renders");
    expect(renderCount(0)).toBe("0 renders");
  });
});
