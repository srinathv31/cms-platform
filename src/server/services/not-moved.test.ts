import { describe, expect, it } from "vitest";
import { notMovedArea, partlyMovedArea } from "./not-moved";

// The placeholders for the methods whose area hasn't moved behind the seam: they fail loudly by name rather than
// answer something made up.

interface Thing {
  moved(): Promise<string>;
  later(): Promise<string>;
}

describe("notMovedArea", () => {
  it("rejects every method with its name", async () => {
    const area = notMovedArea<Thing>("things");
    await expect(area.later()).rejects.toThrow(/things\.later hasn't moved/);
  });
});

describe("partlyMovedArea", () => {
  const area = partlyMovedArea<Thing>("things", {
    moved: async () => "answered",
  });

  it("answers the methods that moved", async () => {
    await expect(area.moved()).resolves.toBe("answered");
  });

  it("rejects the others with their names", async () => {
    await expect(area.later()).rejects.toThrow(/things\.later hasn't moved/);
  });
});
