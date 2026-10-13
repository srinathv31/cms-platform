import { describe, expect, it } from "vitest";
import type { PersonaFacts } from "@/server/services/demo";
import { personaSummaries } from "./personas";

// The switcher's one-line summaries, worded from the demo service's facts (`demo.personas`). What the facts are is
// the contract suite's (src/server/services/contract/demo.ts).

const persona = (overrides: Partial<PersonaFacts>): PersonaFacts => ({
  id: "maya",
  name: "Maya Chen",
  initials: "MC",
  hue: 210,
  platformRole: null,
  teams: [],
  ...overrides,
});

describe("personaSummaries", () => {
  it("names each team with its roles, least authority first", () => {
    expect(
      personaSummaries([
        persona({
          teams: [
            {
              teamId: "t_coral",
              teamName: "Coral Offers",
              roles: ["approver", "team_admin"],
            },
          ],
        }),
      ]),
    ).toEqual([
      {
        id: "maya",
        name: "Maya Chen",
        initials: "MC",
        hue: 210,
        summary: "Coral Offers · Approver & Team Admin",
      },
    ]);
  });

  it("puts a platform role first, then each team in the order given", () => {
    const [summary] = personaSummaries([
      persona({
        platformRole: "platform_admin",
        teams: [
          { teamId: "t_coral", teamName: "Coral Offers", roles: ["author"] },
          { teamId: "t_deposits", teamName: "Deposits", roles: ["viewer"] },
        ],
      }),
    ]);
    expect(summary!.summary).toBe(
      "Platform Admin, Coral Offers · Author, Deposits · Viewer",
    );
  });

  it("says when a persona has no team yet, and keeps the personas' order", () => {
    expect(
      personaSummaries([
        persona({ id: "morgan" }),
        persona({ id: "taylor", platformRole: "auditor" }),
      ]).map((p) => [p.id, p.summary]),
    ).toEqual([
      ["morgan", "No team yet"],
      ["taylor", "Auditor"],
    ]);
  });
});
