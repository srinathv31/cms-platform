import { describe, expect, it, vi } from "vitest";
import type { NumberedRound } from "@/domain/rounds";

// The Content tab's "Open review" row leads to the round in review on its review screen, naming the round
// (`?round=`) exactly when its label does (`reviewPath`). The reads behind the tab are replaced.

const header = vi.hoisted(() => ({ inReview: null as NumberedRound | null }));

vi.mock("@/server/clock", () => ({ now: vi.fn(async () => new Date("2026-10-09T15:00:00.000Z")) }));
vi.mock("@/server/queries/review-shared", () => ({
  getPeople: vi.fn(async () => new Map()),
  personOf: vi.fn((_people: unknown, id: string) => ({ id, name: id, initials: "MC", hue: 0 })),
  requireTemplate: vi.fn(async () => ({ space: { viewer: { userId: "maya" } } })),
}));
vi.mock("@/server/queries/workspace", () => ({
  getWorkspaceDocument: vi.fn(async () => ({ templateId: "UC-ABC123", versionId: "ver_3", editable: false, can: { comment: { ok: true } } })),
  getWorkspaceHeader: vi.fn(async () => ({ inReview: header.inReview })),
}));
vi.mock("./content-workspace", () => ({ ContentWorkspace: () => null }));

const { WorkspaceContent } = await import("./workspace-content");

async function reviewHref(inReview: NumberedRound | null) {
  header.inReview = inReview;
  const element = await WorkspaceContent({ params: Promise.resolve({ team: "coral-offers", templateId: "UC-ABC123" }) });
  return (element.props as { reviewHref: string | null }).reviewHref;
}

describe("WorkspaceContent: the Open review link", () => {
  it("names the round in review once its number was sent back", async () => {
    expect(await reviewHref({ number: 3, round: 2, state: "in_review" })).toBe("/coral-offers/review/UC-ABC123/3?round=2");
  });

  it("is the bare review URL on a first round, and absent with nothing in review", async () => {
    expect(await reviewHref({ number: 3, round: 1, state: "in_review" })).toBe("/coral-offers/review/UC-ABC123/3");
    expect(await reviewHref(null)).toBeNull();
  });
});
