import { describe, expect, it } from "vitest";
import type { SimLinkSummary } from "@/simulator/types";
import { dayLabel, linkStatus } from "./format";

// Coral's display helpers. A sunset is shown by the day Stencil sends (`sunsetDay`, in its business time
// zone), never by the UTC date of its instant: the two are different days for a zone ahead of UTC.

const link = (over: Partial<SimLinkSummary>): SimLinkSummary => ({
  templateId: "UC-TEST01",
  templateName: "Spring Travel Rewards — Terms",
  pinnedVersion: 2,
  pinnedState: "superseded",
  sunsetDay: null,
  sunsetPassed: false,
  revokedAt: null,
  renders: true,
  channels: ["pdf"],
  linkedAt: "2026-10-05T12:00:00.000Z",
  ...over,
});

describe("dayLabel", () => {
  it("names an instant's UTC date", () => {
    expect(dayLabel("2027-03-04T23:30:00.000Z")).toBe("Mar 4, 2027");
  });

  it("names a calendar day as it is, whatever the viewer's zone", () => {
    expect(dayLabel("2027-03-01")).toBe("Mar 1, 2027");
    expect(dayLabel("2027-12-31")).toBe("Dec 31, 2027");
  });
});

describe("linkStatus", () => {
  it("dates a sunset by its day, not by the UTC date of its instant", () => {
    // 00:00 on March 1 in Kolkata is 18:30Z on February 28; the day Stencil sends is March 1.
    const status = linkStatus(link({ sunsetDay: "2027-03-01" }));
    expect(status).toEqual({
      tone: "warn",
      label: "Superseded · sunset Mar 1, 2027",
      failing: false,
    });
    expect(dayLabel("2027-02-28T18:30:00.000Z")).toBe("Feb 28, 2027");
  });

  it("says Superseded alone when no sunset is set, and Sunset passed once it has", () => {
    expect(linkStatus(link({})).label).toBe("Superseded");
    expect(
      linkStatus(
        link({ sunsetDay: "2027-03-01", sunsetPassed: true, renders: false }),
      ),
    ).toEqual({ tone: "bad", label: "Sunset passed", failing: true });
  });
});
