import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TEAM_ICONS } from "@/domain/platform-config";
import { TeamIcon, teamIconLabel } from "./team-icon";

// A team's icon from its stored Lucide key, and the name the icon picker reads out.

const svgClass = (name: string) => /<svg[^>]*class="([^"]*)"/.exec(renderToStaticMarkup(<TeamIcon name={name} />))?.[1] ?? "";

describe("TeamIcon", () => {
  it("draws every key a team can pick as its own icon, decorative", () => {
    const drawn = TEAM_ICONS.map(svgClass);
    expect(new Set(drawn).size).toBe(TEAM_ICONS.length);
    const svg = renderToStaticMarkup(<TeamIcon name="piggy-bank" className="size-4" />);
    expect(svg).toContain('aria-hidden="true"');
    expect(svgClass("piggy-bank")).toContain("lucide-piggy-bank");
    expect(svg).toMatch(/class="[^"]*size-4/);
  });

  it("still draws the keys older rows may hold", () => {
    expect(svgClass("gift")).toContain("lucide-gift");
    expect(svgClass("layers")).toContain("lucide-layers");
    expect(svgClass("bank")).toBe(svgClass("landmark"));
  });

  it("draws a building for a key it doesn't know, the object prototype's names included", () => {
    const building = svgClass("building-2");
    expect(svgClass("no-such-icon")).toBe(building);
    expect(svgClass("constructor")).toBe(building);
    expect(svgClass("toString")).toBe(building);
  });
});

describe("teamIconLabel", () => {
  it("names every key a team can pick in words", () => {
    for (const key of TEAM_ICONS) {
      expect(teamIconLabel(key)).toMatch(/^[A-Z][a-z]+( [a-z]+)?$/);
    }
    expect(teamIconLabel("piggy-bank")).toBe("Piggy bank");
    expect(teamIconLabel("landmark")).toBe("Bank");
  });

  it("reads an unknown key as itself", () => {
    expect(teamIconLabel("no-such-icon")).toBe("no-such-icon");
    expect(teamIconLabel("constructor")).toBe("constructor");
  });
});
