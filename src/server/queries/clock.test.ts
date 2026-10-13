import { describe, expect, it } from "vitest";
import { formatStamp } from "@/domain/dates";
import { clockReadout } from "./clock";

// The Demo pill's readout, worded from the demo service's clock (`demo.clockReadout`): the backend's instant, never
// the BFF's own.

describe("clockReadout", () => {
  it("words the backend's instant and keeps its offset", () => {
    const asOf = "2026-10-19T15:42:00.000Z";
    expect(clockReadout({ asOf, offsetDays: 15 })).toEqual({
      label: formatStamp(new Date(asOf)),
      offsetDays: 15,
    });
  });
});
