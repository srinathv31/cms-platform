import { describe, expect, it } from "vitest";
import { linkRuns } from "./links";

const links = (text: string) => linkRuns(text).filter((r) => r.link).map((r) => r.text);

describe("linkRuns", () => {
  it("finds addresses with and without a scheme, and keeps every character", () => {
    const text = "Pay at coral.example/pay or https://coral.example/help?x=1 today.";
    expect(links(text)).toEqual(["coral.example/pay", "https://coral.example/help?x=1"]);
    expect(linkRuns(text).map((r) => r.text).join("")).toBe(text);
  });

  it("leaves a trailing full stop or bracket out of the link", () => {
    expect(links("Visit coral.example/pay.")).toEqual(["coral.example/pay"]);
    expect(links("(see coral.example)")).toEqual(["coral.example"]);
  });

  it("doesn't take amounts, abbreviations or an email's domain for links", () => {
    expect(links("Your payment of $35.00 is due Oct. 14, e.g. today.")).toEqual([]);
    expect(links("Write to help@coral.example")).toEqual([]);
  });

  it("returns one plain run for text without links, and none for empty text", () => {
    expect(linkRuns("Reply STOP to opt out")).toEqual([{ text: "Reply STOP to opt out", link: false }]);
    expect(linkRuns("")).toEqual([]);
  });
});
