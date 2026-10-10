import { describe, expect, it } from "vitest";
import { shortDate } from "./dates";

describe("shortDate", () => {
  it("shortens the day and month names, and leaves the rest", () => {
    expect(shortDate("Friday, October 9")).toBe("Fri, Oct 9");
    expect(shortDate("Tuesday, May 12")).toBe("Tue, May 12");
    expect(shortDate("Mardi 9 octobre")).toBe("Mardi 9 octobre");
  });
});
